#!/usr/bin/env node
import http from "node:http";
import sharp from "sharp";
import { loadSettings, section } from "@blogagent/config";
import { authUrl, exchangeCode, toLongLived, refreshLongLived, getUserId, createContainer, waitForContainerReady, publishContainer, REFRESH_THRESHOLD_S } from "./instagram.js";
import { uploadAsset, DEFAULT_BRANCH } from "./github-assets.js";
import { upsertEnvVar } from "./token-store.js";

/**
 * Sink that publishes a finished article to Instagram as a photo post.
 *
 * Uses the "Instagram API with Instagram Login" (the current, Facebook-page-free
 * flavor). Same `POST /publish` contract as the other sinks — a briefing names it
 * as a target-sink and the newsroom posts the finished article here. The post
 * carries the article title + description as the caption and its first image,
 * uploaded to the `instagram-assets` branch of the configured GitHub repo so
 * Instagram can fetch it via a public URL (Instagram does not accept inline base64).
 *
 * Two ways to authorize:
 *   1. Quick start (no app secret): generate an access token in the Instagram app
 *      dashboard and put it in INSTAGRAM_ACCESS_TOKEN. The sink resolves the user id
 *      from it and posts. It refreshes the token on its own (no secret needed).
 *   2. Full OAuth bootstrap (Instagram Login authorization code flow):
 *        GET /oauth/start     → redirects to Instagram's consent screen
 *        GET /oauth/callback  → catches the code, trades it for a long-lived token
 *                               (60d), resolves the user id, writes everything to .env
 *      This needs the *Instagram* app id/secret (shown under the Instagram use case,
 *      not the Meta app's basic settings).
 *
 * At runtime the long-lived token is refreshed automatically while still valid.
 * A fully expired token requires a fresh token (dashboard) or one more /oauth/start.
 *
 * Requirement: the GitHub repo must be PUBLIC so Instagram can reach the raw URL.
 */
const cfg = section(loadSettings(), "sink-instagram");
const PORT = cfg.num("port");
const API_URL = cfg.str("api_url", "https://graph.instagram.com");
const GITHUB_REPO = cfg.str("github_repo");
const GITHUB_BRANCH = cfg.str("github_branch", DEFAULT_BRANCH);
// Appended to the caption when the pitch carries no target_url (Instagram links are not clickable).
const DEFAULT_LINK = cfg.str("default_link", "");
const GITHUB_API = "https://api.github.com";
const SCOPES = ["instagram_business_basic", "instagram_business_content_publish"];
const REDIRECT_URI = cfg.str("redirect_uri", `http://localhost:${PORT}/oauth/callback`);
const ENV_PATH = ".env";

// App id/secret are only needed for the full OAuth bootstrap; the quick-start path
// (a hand-generated token in INSTAGRAM_ACCESS_TOKEN) needs neither.
const APP_ID = process.env.INSTAGRAM_APP_ID ?? "";
const APP_SECRET = process.env.INSTAGRAM_APP_SECRET ?? "";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? "";

// In-memory state. Seeded from the environment on startup; updated by the OAuth
// flow and subsequent refreshes — upsertEnvVar keeps .env in sync. The token may be
// hand-generated (quick start) or OAuth-obtained; the user id is resolved from the
// token when absent.
let accessToken = process.env.INSTAGRAM_ACCESS_TOKEN ?? "";
let tokenExpiresAt = Number(process.env.INSTAGRAM_TOKEN_EXPIRES_AT ?? 0); // Unix seconds, 0 = unknown
let userId = process.env.INSTAGRAM_USER_ID ?? "";

function isAuthorized() {
  // A valid token is enough to post — the user id is derived from it if not set.
  return !!accessToken;
}

/**
 * Persist a fresh token (and optionally a new userId) to memory and .env.
 * @param {{access_token:string, expires_in?:number}} tokens
 * @param {string} [igUserId]
 */
function adoptTokens(tokens, igUserId) {
  accessToken = tokens.access_token;
  tokenExpiresAt = Math.floor(Date.now() / 1000) + (tokens.expires_in ?? 5184000); // default 60 days
  try {
    upsertEnvVar(ENV_PATH, "INSTAGRAM_ACCESS_TOKEN", accessToken);
    upsertEnvVar(ENV_PATH, "INSTAGRAM_TOKEN_EXPIRES_AT", String(tokenExpiresAt));
    console.log("[sink-instagram] access token written to .env");
  } catch (err) {
    console.error(`[sink-instagram] could not write token to .env: ${err.message}`);
  }
  if (igUserId && igUserId !== userId) {
    userId = igUserId;
    try {
      upsertEnvVar(ENV_PATH, "INSTAGRAM_USER_ID", userId);
      console.log(`[sink-instagram] Instagram User ID written to .env: ${userId}`);
    } catch (err) {
      console.error(`[sink-instagram] could not write user ID to .env: ${err.message}`);
    }
  }
}

/**
 * Return a valid access token, refreshing it if it expires within 7 days.
 * Throws if the token is absent or fully expired (needs a fresh token / OAuth run).
 */
async function validToken() {
  if (!accessToken) throw new Error(`not authorized yet — set INSTAGRAM_ACCESS_TOKEN or open http://localhost:${PORT}/oauth/start once`);
  // Unknown expiry (a hand-generated token without INSTAGRAM_TOKEN_EXPIRES_AT):
  // use it as-is; if it has expired the API surfaces a 401 to the caller.
  if (!tokenExpiresAt) return accessToken;
  const nowS = Math.floor(Date.now() / 1000);
  const needsRefresh = tokenExpiresAt - nowS < REFRESH_THRESHOLD_S;
  if (!needsRefresh) return accessToken;
  if (nowS >= tokenExpiresAt) throw new Error(`token expired — generate a new token or open http://localhost:${PORT}/oauth/start`);
  console.log("[sink-instagram] refreshing long-lived token");
  adoptTokens(await refreshLongLived({ apiUrl: API_URL, token: accessToken }));
  return accessToken;
}

/** The Instagram user id, resolved from the token and persisted on first use. */
async function ensureUserId(token) {
  if (userId) return userId;
  const resolved = await getUserId({ apiUrl: API_URL, token });
  userId = resolved;
  try {
    upsertEnvVar(ENV_PATH, "INSTAGRAM_USER_ID", userId);
    console.log(`[sink-instagram] Instagram User ID written to .env: ${userId}`);
  } catch (err) {
    console.error(`[sink-instagram] could not write user ID to .env: ${err.message}`);
  }
  return userId;
}

/** Convert WebP (base64) to JPEG Buffer — Instagram expects JPEG/PNG. */
async function toJpegBuffer(webpBase64) {
  return sharp(Buffer.from(webpBase64, "base64")).jpeg({ quality: 85 }).toBuffer();
}

function buildCaption(title, description, link) {
  const parts = [title?.trim(), description?.trim(), link?.trim()].filter(Boolean);
  return parts.join("\n\n") || "";
}

async function publish(payload) {
  const { slug, title, description, images = [], meta } = payload ?? {};

  const image = images[0];
  if (!image) return { status: 400, body: { errors: ["an Instagram post needs an image — none in this article"] } };

  // The URL the research filter resolved, or the configured fallback (never empty in practice).
  const link = meta?.context?.target_url || DEFAULT_LINK;
  const caption = buildCaption(title, description, link);

  if (!isAuthorized()) {
    console.log(`[sink-instagram] DRY RUN — would post:`);
    console.log(`  slug:    ${slug ?? "(none)"}`);
    console.log(`  caption: ${caption.slice(0, 120)}${caption.length > 120 ? "…" : ""}`);
    console.log(`  images:  ${images.map((i) => i.name ?? "?").join(", ")}`);
    return { status: 201, body: { publication_ref: "instagram:dry-run", dry_run: true } };
  }

  const token = await validToken();
  const igUserId = await ensureUserId(token);
  const jpegBuffer = await toJpegBuffer(image.data);
  const filename = (image.name ?? "foto-1").replace(/\.[^.]+$/, "") + ".jpg";

  const imageUrl = await uploadAsset({
    apiUrl: GITHUB_API,
    repo: GITHUB_REPO,
    token: GITHUB_TOKEN,
    slug: slug ?? `post-${Date.now()}`,
    filename,
    branch: GITHUB_BRANCH,
    jpegBuffer,
  });

  const creationId = await createContainer({ apiUrl: API_URL, userId: igUserId, token, imageUrl, caption });
  await waitForContainerReady({ apiUrl: API_URL, containerId: creationId, token });
  const mediaId = await publishContainer({ apiUrl: API_URL, userId: igUserId, token, creationId });

  console.log(`[sink-instagram] posted ${slug ?? "(no slug)"} → media ${mediaId}`);
  return { status: 201, body: { publication_ref: `instagram:${mediaId}` } };
}

const server = http.createServer(async (req, res) => {
  const reply = (status, body, type = "application/json") => {
    res.writeHead(status, { "content-type": type });
    res.end(type === "application/json" ? JSON.stringify(body) : body);
  };

  if (req.method === "GET" && req.url.startsWith("/oauth/start")) {
    res.writeHead(302, { location: authUrl({ appId: APP_ID, redirectUri: REDIRECT_URI, scopes: SCOPES }) });
    return res.end();
  }

  if (req.method === "GET" && req.url.startsWith("/oauth/callback")) {
    const code = new URL(req.url, `http://localhost:${PORT}`).searchParams.get("code");
    if (!code) return reply(400, "Kein code in der Antwort von Instagram.", "text/plain; charset=utf-8");
    try {
      const short = await exchangeCode({ appId: APP_ID, appSecret: APP_SECRET, code, redirectUri: REDIRECT_URI });
      const long = await toLongLived({ apiUrl: API_URL, appSecret: APP_SECRET, shortToken: short.access_token });
      // Instagram Login returns the user_id with the short token; fall back to /me.
      const igUserId = short.user_id ? String(short.user_id) : await getUserId({ apiUrl: API_URL, token: long.access_token });
      adoptTokens(long, igUserId);
      return reply(
        200,
        `✅ Instagram verbunden (User ID: ${igUserId}). Token und User ID wurden in .env gespeichert — dieses Fenster kann geschlossen werden.`,
        "text/html; charset=utf-8",
      );
    } catch (err) {
      console.error("[sink-instagram] oauth exchange failed:", err);
      return reply(502, `OAuth fehlgeschlagen: ${err.message}`, "text/plain; charset=utf-8");
    }
  }

  if (req.method === "POST" && req.url === "/publish") {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const { status, body } = await publish(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      return reply(status, body);
    } catch (err) {
      console.error("[sink-instagram]", err);
      return reply(500, { errors: [err.message] });
    }
  }

  return reply(404, { errors: ["POST /publish, GET /oauth/start, GET /oauth/callback"] });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[sink-instagram] :${PORT}`);
  if (!isAuthorized()) {
    console.log(`[sink-instagram] DRY RUN — not authorized, posts will be logged to console only.`);
    console.log(`[sink-instagram] quick start: set INSTAGRAM_ACCESS_TOKEN to a token generated in the Instagram app dashboard (no secret needed).`);
    console.log(`[sink-instagram] full setup: set INSTAGRAM_APP_ID/APP_SECRET (the Instagram app's), then open http://localhost:${PORT}/oauth/start once.`);
    console.log(`[sink-instagram] register this exact redirect URI in the Instagram app: ${REDIRECT_URI}`);
    console.log(`[sink-instagram] required permissions: ${SCOPES.join(", ")}`);
    console.log(`[sink-instagram] note: the GitHub repo ${GITHUB_REPO} must be PUBLIC for Instagram to fetch images.`);
  }
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
