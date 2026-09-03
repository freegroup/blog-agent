#!/usr/bin/env node
import http from "node:http";
import sharp from "sharp";
import { config } from "./config.js";
import { authUrl, exchangeCode, refreshAccess, createPin } from "./pinterest.js";
import { upsertEnvVar } from "./token-store.js";

/**
 * Sink that publishes a finished article to Pinterest as a Pin.
 *
 * Same `POST /publish` contract as the other sinks — a briefing names it as a sink
 * and the newsroom posts the finished article here. The Pin links back to the URL
 * step-research extracted (payload.meta.context.target_url), carries the
 * article's title/description, and shows its image (the pipeline's WebP converted
 * to JPEG, sent inline as base64 — Pinterest needs an image for every Pin).
 *
 * It owns the whole Pinterest relationship, including the one-time OAuth bootstrap:
 *   GET /oauth/start     → redirects to Pinterest's consent screen
 *   GET /oauth/callback  → catches the code, trades it for tokens, and writes the
 *                          refresh token back into .env
 * At runtime it only refreshes the access token (server-to-server, no browser) and
 * persists any rotated refresh token back into .env, so it keeps working unattended
 * and across restarts.
 *
 * All configuration — settings.yaml values, secrets, and the static scopes/.env
 * constants — comes from config.js. This file reads neither process.env nor settings.
 */

// In-memory token state. The refresh token seeds from config's INITIAL value (written
// by a previous OAuth run); the access token is fetched on demand and cached until it
// nears expiry.
let refreshToken = config.initialRefreshToken;
let accessToken = null;
let accessExpiresAt = 0;

function isAuthorized() {
  // Either a directly supplied token, or the full OAuth setup that can mint one.
  return !!(config.directToken || (config.appId && config.appSecret && refreshToken));
}

/**
 * Adopt a fresh token pair from Pinterest: cache the access token, and if the
 * refresh token changed, persist it back into .env so the next start — and a later
 * rotation — keeps working. The running process uses the in-memory value regardless
 * of whether the file write succeeds.
 */
function adoptTokens(tokens) {
  accessToken = tokens.access_token;
  // Refresh a minute early to avoid racing the expiry (default 30 days).
  accessExpiresAt = Date.now() + ((tokens.expires_in ?? 2592000) * 1000 - 60_000);
  if (tokens.refresh_token && tokens.refresh_token !== refreshToken) {
    refreshToken = tokens.refresh_token;
    try {
      upsertEnvVar(config.ENV_PATH, "PINTEREST_REFRESH_TOKEN", refreshToken);
      console.log("[sink-pinterest] refresh token written to .env");
    } catch (err) {
      console.error(`[sink-pinterest] could not write refresh token to .env: ${err.message}`);
    }
  }
}

/** A valid access token, refreshing it if the cached one is gone or near expiry. */
async function validAccessToken() {
  // A hand-generated token wins and is used as-is — no refresh path (no app secret).
  // If it has expired, createPin surfaces Pinterest's 401 to the caller.
  if (config.directToken) return config.directToken;
  if (accessToken && Date.now() < accessExpiresAt) return accessToken;
  if (!refreshToken) throw new Error(`not authorized yet — open http://localhost:${config.port}/oauth/start once`);
  adoptTokens(await refreshAccess({ apiUrl: config.apiUrl, appId: config.appId, appSecret: config.appSecret, refreshToken }));
  return accessToken;
}

/** Convert one WebP (base64) to JPEG (base64) — Pinterest expects JPEG/PNG. */
async function toJpegBase64(webpBase64) {
  const buffer = await sharp(Buffer.from(webpBase64, "base64")).jpeg({ quality: 85 }).toBuffer();
  return buffer.toString("base64");
}

async function publish(payload) {
  const { slug, title, description, images = [], meta } = payload ?? {};

  const image = images[0];
  if (!image) return { status: 400, body: { errors: ["a Pin needs an image — none in this article"] } };

  const link = meta?.context?.target_url ?? null;

  if (!isAuthorized()) {
    console.log(`[sink-pinterest] DRY RUN — would pin:`);
    console.log(`  slug:        ${slug ?? "(none)"}`);
    console.log(`  title:       ${title ?? "(none)"}`);
    console.log(`  description: ${String(description ?? "").slice(0, 120)}${String(description ?? "").length > 120 ? "…" : ""}`);
    console.log(`  link:        ${link ?? "(none)"}`);
    console.log(`  images:      ${images.map((i) => i.name ?? "?").join(", ")}`);
    return { status: 201, body: { publication_ref: "pinterest:dry-run", dry_run: true } };
  }

  // Link back to the URL step-research resolved (may be absent → no link).
  const imageBase64 = await toJpegBase64(image.data);
  const token = await validAccessToken();

  const id = await createPin({
    apiUrl: config.apiUrl,
    accessToken: token,
    boardId: config.boardId,
    title,
    description,
    link,
    imageBase64,
    altText: title,
  });

  console.log(`[sink-pinterest] pinned ${slug ?? "(no slug)"} → ${id}${link ? ` (→ ${link})` : ""}`);
  return { status: 201, body: { publication_ref: `pinterest:${id}`, url: `https://www.pinterest.com/pin/${id}/` } };
}

const server = http.createServer(async (req, res) => {
  const reply = (status, body, type = "application/json") => {
    res.writeHead(status, { "content-type": type });
    res.end(type === "application/json" ? JSON.stringify(body) : body);
  };

  // One-time OAuth bootstrap: open this in a browser to grant access.
  if (req.method === "GET" && req.url.startsWith("/oauth/start")) {
    res.writeHead(302, { location: authUrl({ appId: config.appId, redirectUri: config.redirectUri, scopes: config.SCOPES }) });
    return res.end();
  }

  if (req.method === "GET" && req.url.startsWith("/oauth/callback")) {
    const code = new URL(req.url, `http://localhost:${config.port}`).searchParams.get("code");
    if (!code) return reply(400, "Kein code in der Antwort von Pinterest.", "text/plain; charset=utf-8");
    try {
      adoptTokens(await exchangeCode({ apiUrl: config.apiUrl, appId: config.appId, appSecret: config.appSecret, code, redirectUri: config.redirectUri }));
      return reply(
        200,
        "✅ Pinterest verbunden. Der Refresh-Token wurde in .env gespeichert — dieses Fenster kann geschlossen werden.",
        "text/html; charset=utf-8",
      );
    } catch (err) {
      console.error("[sink-pinterest] oauth exchange failed:", err);
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
      console.error("[sink-pinterest]", err);
      return reply(500, { errors: [err.message] });
    }
  }

  return reply(404, { errors: ["POST /publish, GET /oauth/start, GET /oauth/callback"] });
});

server.listen(config.port, "127.0.0.1", () => {
  console.log(`[sink-pinterest] :${config.port}`);
  if (!isAuthorized()) {
    console.log(`[sink-pinterest] DRY RUN — not authorized, pins will be logged to console only.`);
    console.log(`[sink-pinterest] quick start: set PINTEREST_ACCESS_TOKEN to a token generated in the app dashboard (no secret needed).`);
    console.log(`[sink-pinterest] full setup: set PINTEREST_APP_ID/APP_SECRET, then open http://localhost:${config.port}/oauth/start once.`);
    console.log(`[sink-pinterest] register this exact redirect URI in the Pinterest app: ${config.redirectUri}`);
  }
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
