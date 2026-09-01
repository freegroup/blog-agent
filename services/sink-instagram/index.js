#!/usr/bin/env node
import http from "node:http";
import sharp from "sharp";
import { loadSettings, section, secret } from "@blogagent/config";
import { authUrl, exchangeCode, toLongLived, refreshLongLived, getUserId, createContainer, publishContainer, REFRESH_THRESHOLD_S } from "./instagram.js";
import { uploadAsset, DEFAULT_BRANCH } from "./github-assets.js";
import { upsertEnvVar } from "./token-store.js";

/**
 * Sink that publishes a finished article to Instagram as a photo post.
 *
 * Same `POST /publish` contract as the other sinks — a briefing names it as a
 * target-sink and the newsroom posts the finished article here. The post carries
 * the article title + description as the caption and its first image, uploaded to
 * the `instagram-assets` branch of the configured GitHub repo so Instagram can
 * fetch it via a public URL (Instagram does not accept inline base64).
 *
 * One-time OAuth bootstrap (Meta's authorization code flow):
 *   GET /oauth/start     → redirects to Facebook's consent screen
 *   GET /oauth/callback  → catches the code, trades it for a long-lived token (60d),
 *                          resolves the Instagram User ID, and writes everything into .env
 *
 * At runtime the long-lived token is refreshed automatically while still valid.
 * A fully expired token requires one more visit to /oauth/start.
 *
 * Requirement: the GitHub repo must be PUBLIC so Instagram can reach the raw URL.
 */
const cfg = section(loadSettings(), "sink-instagram");
const PORT = cfg.num("port");
const API_URL = cfg.str("api_url", "https://graph.facebook.com/v21.0");
const GITHUB_REPO = cfg.str("github_repo");
const GITHUB_BRANCH = cfg.str("github_branch", DEFAULT_BRANCH);
const GITHUB_API = "https://api.github.com";
const SCOPES = ["instagram_basic", "instagram_content_publish", "pages_show_list", "pages_read_engagement"];
const REDIRECT_URI = cfg.str("redirect_uri", `http://localhost:${PORT}/oauth/callback`);
const ENV_PATH = ".env";

const APP_ID = secret("INSTAGRAM_APP_ID");
const APP_SECRET = secret("INSTAGRAM_APP_SECRET");
const GITHUB_TOKEN = secret("GITHUB_TOKEN");

// In-memory state. Seeded from the environment on startup; updated by the OAuth
// flow and subsequent refreshes — upsertEnvVar keeps .env in sync.
let accessToken = process.env.INSTAGRAM_ACCESS_TOKEN ?? "";
let tokenExpiresAt = Number(process.env.INSTAGRAM_TOKEN_EXPIRES_AT ?? 0); // Unix seconds
let userId = process.env.INSTAGRAM_USER_ID ?? "";

function isAuthorized() {
  return !!(accessToken && userId);
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
 * Throws if the token is absent or fully expired (triggers a new OAuth run).
 */
async function validToken() {
  if (!accessToken) throw new Error(`not authorized yet — open http://localhost:${PORT}/oauth/start once`);
  const nowS = Math.floor(Date.now() / 1000);
  const needsRefresh = tokenExpiresAt - nowS < REFRESH_THRESHOLD_S;
  if (!needsRefresh) return accessToken;
  if (nowS >= tokenExpiresAt) throw new Error(`token expired — open http://localhost:${PORT}/oauth/start to reauthorize`);
  console.log("[sink-instagram] refreshing long-lived token");
  adoptTokens(await refreshLongLived({ apiUrl: API_URL, appId: APP_ID, appSecret: APP_SECRET, token: accessToken }));
  return accessToken;
}

/** Convert WebP (base64) to JPEG Buffer — Instagram expects JPEG/PNG. */
async function toJpegBuffer(webpBase64) {
  return sharp(Buffer.from(webpBase64, "base64")).jpeg({ quality: 85 }).toBuffer();
}

function buildCaption(title, description) {
  const parts = [title?.trim(), description?.trim()].filter(Boolean);
  return parts.join("\n\n") || "";
}

async function publish(payload) {
  const { slug, title, description, images = [] } = payload ?? {};

  const image = images[0];
  if (!image) return { status: 400, body: { errors: ["an Instagram post needs an image — none in this article"] } };

  const token = await validToken();
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

  const caption = buildCaption(title, description);
  const creationId = await createContainer({ apiUrl: API_URL, userId, token, imageUrl, caption });
  const mediaId = await publishContainer({ apiUrl: API_URL, userId, token, creationId });

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
    if (!code) return reply(400, "Kein code in der Antwort von Meta.", "text/plain; charset=utf-8");
    try {
      const short = await exchangeCode({ apiUrl: API_URL, appId: APP_ID, appSecret: APP_SECRET, code, redirectUri: REDIRECT_URI });
      const long = await toLongLived({ apiUrl: API_URL, appId: APP_ID, appSecret: APP_SECRET, shortToken: short.access_token });
      const igUserId = await getUserId({ apiUrl: API_URL, token: long.access_token });
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
    console.log(`[sink-instagram] not authorized yet — open http://localhost:${PORT}/oauth/start in a browser once.`);
    console.log(`[sink-instagram] register this exact redirect URI in the Meta app: ${REDIRECT_URI}`);
    console.log(`[sink-instagram] required permissions: ${SCOPES.join(", ")}`);
    console.log(`[sink-instagram] note: the GitHub repo ${GITHUB_REPO} must be PUBLIC for Instagram to fetch images.`);
  }
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
