#!/usr/bin/env node
import http from "node:http";
import sharp from "sharp";
import { getImageData } from "@blogagent/image";
import { config } from "./config.js";
import { authUrl, exchangeCode, toLongLived, refreshLongLived, getUserId, createContainer, waitForContainerReady, publishContainer } from "./instagram.js";
import { uploadAsset } from "./github-assets.js";
import { upsertEnvVar } from "./token-store.js";

/**
 * Sink that publishes a finished article to Instagram as a photo post.
 *
 * Uses the "Instagram API with Instagram Login" (the current, Facebook-page-free
 * flavor). Same `POST /publish` contract as the other sinks — a briefing names it
 * as a target-sink and the newsroom posts the finished article here. The post
 * carries the article title + description as the caption and its image(s) — one photo,
 * or a swipeable carousel when the article brings more than one — each uploaded to the
 * `instagram-assets` branch of the configured GitHub repo so Instagram can fetch it via
 * a public URL (Instagram does not accept inline base64).
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
 *
 * All configuration — settings.yaml values, secrets, and the static OAuth/format
 * constants — comes from config.js. This file reads neither process.env nor settings.
 */

// In-memory token state, one entry per Instagram account. The account is named by
// the briefing (`payload.briefing.account`); a briefing with no account is the
// DEFAULT account, which uses the original unsuffixed INSTAGRAM_* variables so an
// existing single-account setup keeps working. Named accounts use suffixed variables
// (INSTAGRAM_<ACCOUNT>_ACCESS_TOKEN, …), resolved by convention — no account list is
// declared anywhere. Entries are seeded lazily from the boot env snapshot and updated
// by the OAuth flow and refreshes; upsertEnvVar keeps .env in sync.
const accounts = new Map();

const label = (account) => account ?? "default";

/** The .env variable names holding one account's token state. */
function envKeys(account) {
  const prefix = account ? `INSTAGRAM_${account.toUpperCase()}_` : "INSTAGRAM_";
  return { token: `${prefix}ACCESS_TOKEN`, expires: `${prefix}TOKEN_EXPIRES_AT`, userId: `${prefix}USER_ID` };
}

/** The mutable token state for an account, seeded from the env snapshot on first use. */
function state(account) {
  const key = account ?? "";
  if (!accounts.has(key)) {
    const k = envKeys(account);
    accounts.set(key, {
      accessToken: config.igEnv[k.token] ?? "",
      tokenExpiresAt: Number(config.igEnv[k.expires] ?? 0), // Unix seconds, 0 = unknown
      userId: config.igEnv[k.userId] ?? "",
    });
  }
  return accounts.get(key);
}

function isAuthorized(account) {
  // A valid token is enough to post — the user id is derived from it if not set.
  return !!state(account).accessToken;
}

/**
 * Persist a fresh token (and optionally a new userId) for an account to memory and .env.
 * @param {string|null} account
 * @param {{access_token:string, expires_in?:number}} tokens
 * @param {string} [igUserId]
 */
function adoptTokens(account, tokens, igUserId) {
  const st = state(account);
  const k = envKeys(account);
  st.accessToken = tokens.access_token;
  st.tokenExpiresAt = Math.floor(Date.now() / 1000) + (tokens.expires_in ?? 5184000); // default 60 days
  try {
    upsertEnvVar(config.ENV_PATH, k.token, st.accessToken);
    upsertEnvVar(config.ENV_PATH, k.expires, String(st.tokenExpiresAt));
    console.log(`[sink-instagram] access token written to .env (account ${label(account)})`);
  } catch (err) {
    console.error(`[sink-instagram] could not write token to .env: ${err.message}`);
  }
  if (igUserId && igUserId !== st.userId) {
    st.userId = igUserId;
    try {
      upsertEnvVar(config.ENV_PATH, k.userId, st.userId);
      console.log(`[sink-instagram] Instagram User ID written to .env: ${st.userId} (account ${label(account)})`);
    } catch (err) {
      console.error(`[sink-instagram] could not write user ID to .env: ${err.message}`);
    }
  }
}

/**
 * Return a valid access token for an account, refreshing it if it expires within 7 days.
 * Throws if the token is absent or fully expired (needs a fresh token / OAuth run).
 */
async function validToken(account) {
  const st = state(account);
  const { token: tokenVar } = envKeys(account);
  if (!st.accessToken) throw new Error(`account '${label(account)}' not authorized yet — set ${tokenVar} or open http://localhost:${config.port}/oauth/start?account=${account ?? ""} once`);
  // Unknown expiry (a hand-generated token without the *_TOKEN_EXPIRES_AT var):
  // use it as-is; if it has expired the API surfaces a 401 to the caller.
  if (!st.tokenExpiresAt) return st.accessToken;
  const nowS = Math.floor(Date.now() / 1000);
  const needsRefresh = st.tokenExpiresAt - nowS < config.REFRESH_THRESHOLD_S;
  if (!needsRefresh) return st.accessToken;
  if (nowS >= st.tokenExpiresAt) throw new Error(`account '${label(account)}' token expired — generate a new token or open http://localhost:${config.port}/oauth/start?account=${account ?? ""}`);
  console.log(`[sink-instagram] refreshing long-lived token (account ${label(account)})`);
  adoptTokens(account, await refreshLongLived({ apiUrl: config.apiUrl, token: st.accessToken }));
  return st.accessToken;
}

/** The Instagram user id for an account, resolved from the token and persisted on first use. */
async function ensureUserId(account, token) {
  const st = state(account);
  if (st.userId) return st.userId;
  st.userId = await getUserId({ apiUrl: config.apiUrl, token });
  try {
    upsertEnvVar(config.ENV_PATH, envKeys(account).userId, st.userId);
    console.log(`[sink-instagram] Instagram User ID written to .env: ${st.userId} (account ${label(account)})`);
  } catch (err) {
    console.error(`[sink-instagram] could not write user ID to .env: ${err.message}`);
  }
  return st.userId;
}

/** Convert WebP (base64) to JPEG Buffer — Instagram expects JPEG/PNG. */
async function toJpegBuffer(webpBase64) {
  return sharp(Buffer.from(webpBase64, "base64")).jpeg({ quality: 85 }).toBuffer();
}

function buildCaption(title, description, cta) {
  const parts = [title?.trim(), description?.trim(), cta?.trim()].filter(Boolean);
  return parts.join("\n\n") || "";
}

async function publish(payload) {
  const { slug, title, description, images = [], briefing } = payload ?? {};
  // Which Instagram profile: named by the briefing, else the default account.
  const account = briefing?.account || null;

  if (!images.length) return { status: 400, body: { errors: ["an Instagram post needs an image — none in this article"] } };
  // One image posts as a single photo; two or more become a swipeable carousel. The
  // briefings keep the editorial count to 1–2; this is the platform-limit safety net.
  const chosen = images.slice(0, config.CAROUSEL_MAX);

  // Feed captions can't carry a clickable link — end with a "link in bio" CTA instead.
  const caption = buildCaption(title, description, config.captionCta);

  if (!isAuthorized(account)) {
    console.log(`[sink-instagram] DRY RUN (account ${label(account)}) — would post:`);
    console.log(`  slug:    ${slug ?? "(none)"}`);
    console.log(`  caption: ${caption.slice(0, 120)}${caption.length > 120 ? "…" : ""}`);
    console.log(`  images:  ${chosen.map((i) => i.name ?? "?").join(", ")}${chosen.length > 1 ? " (carousel)" : ""}`);
    return { status: 201, body: { publication_ref: "instagram:dry-run", dry_run: true } };
  }

  const token = await validToken(account);
  const igUserId = await ensureUserId(account, token);

  // Every image goes to the public asset repo first — Instagram fetches them by URL.
  const imageUrls = [];
  for (const [i, image] of chosen.entries()) {
    const jpegBuffer = await toJpegBuffer(getImageData(image));
    const filename = (image.name ?? `foto-${i + 1}`).replace(/\.[^.]+$/, "") + ".jpg";
    imageUrls.push(
      await uploadAsset({
        apiUrl: config.GITHUB_API,
        repo: config.githubRepo,
        token: config.githubToken,
        slug: slug ?? `post-${Date.now()}`,
        filename,
        branch: config.githubBranch,
        jpegBuffer,
      }),
    );
  }

  const ig = { apiUrl: config.apiUrl, userId: igUserId, token };
  let creationId;
  if (imageUrls.length === 1) {
    // Single image: one container carries the caption directly.
    creationId = await createContainer({ ...ig, imageUrl: imageUrls[0], caption, captionMax: config.CAPTION_MAX });
    await waitForContainerReady({ apiUrl: config.apiUrl, containerId: creationId, token });
  } else {
    // Carousel: an item container per slide (no caption), then a parent that carries it.
    const childIds = [];
    for (const imageUrl of imageUrls) {
      const itemId = await createContainer({ ...ig, imageUrl, isCarouselItem: true });
      await waitForContainerReady({ apiUrl: config.apiUrl, containerId: itemId, token });
      childIds.push(itemId);
    }
    creationId = await createContainer({ ...ig, caption, captionMax: config.CAPTION_MAX, children: childIds });
    await waitForContainerReady({ apiUrl: config.apiUrl, containerId: creationId, token });
  }
  const mediaId = await publishContainer({ ...ig, creationId });

  console.log(`[sink-instagram] posted ${slug ?? "(no slug)"} → media ${mediaId} (${chosen.length} image(s), account ${label(account)})`);
  return { status: 201, body: { publication_ref: `instagram:${mediaId}` } };
}

const server = http.createServer(async (req, res) => {
  const reply = (status, body, type = "application/json") => {
    res.writeHead(status, { "content-type": type });
    res.end(type === "application/json" ? JSON.stringify(body) : body);
  };

  if (req.method === "GET" && req.url.startsWith("/oauth/start")) {
    // ?account=<name> flows through OAuth's `state` so the callback stores the token
    // under the right account; absent → the default account.
    const account = new URL(req.url, `http://localhost:${config.port}`).searchParams.get("account") || null;
    res.writeHead(302, {
      location: authUrl({ authorizeUrl: config.OAUTH_AUTHORIZE, appId: config.appId, redirectUri: config.redirectUri, scopes: config.SCOPES, state: account ?? "" }),
    });
    return res.end();
  }

  if (req.method === "GET" && req.url.startsWith("/oauth/callback")) {
    const params = new URL(req.url, `http://localhost:${config.port}`).searchParams;
    const code = params.get("code");
    const account = params.get("state") || null; // which account this consent was for
    if (!code) return reply(400, "Kein code in der Antwort von Instagram.", "text/plain; charset=utf-8");
    try {
      const short = await exchangeCode({ tokenUrl: config.OAUTH_TOKEN, appId: config.appId, appSecret: config.appSecret, code, redirectUri: config.redirectUri });
      const long = await toLongLived({ apiUrl: config.apiUrl, appSecret: config.appSecret, shortToken: short.access_token });
      // Instagram Login returns the user_id with the short token; fall back to /me.
      const igUserId = short.user_id ? String(short.user_id) : await getUserId({ apiUrl: config.apiUrl, token: long.access_token });
      adoptTokens(account, long, igUserId);
      return reply(
        200,
        `✅ Instagram verbunden (Konto ${label(account)}, User ID: ${igUserId}). Token und User ID wurden in .env gespeichert — dieses Fenster kann geschlossen werden.`,
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

server.listen(config.port, "127.0.0.1", () => {
  console.log(`[sink-instagram] :${config.port}`);
  if (!isAuthorized()) {
    console.log(`[sink-instagram] DRY RUN — not authorized, posts will be logged to console only.`);
    console.log(`[sink-instagram] quick start: set INSTAGRAM_ACCESS_TOKEN to a token generated in the Instagram app dashboard (no secret needed).`);
    console.log(`[sink-instagram] full setup: set INSTAGRAM_APP_ID/APP_SECRET (the Instagram app's), then open http://localhost:${config.port}/oauth/start once.`);
    console.log(`[sink-instagram] register this exact redirect URI in the Instagram app: ${config.redirectUri}`);
    console.log(`[sink-instagram] required permissions: ${config.SCOPES.join(", ")}`);
    console.log(`[sink-instagram] note: the GitHub repo ${config.githubRepo} must be PUBLIC for Instagram to fetch images.`);
  }
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
