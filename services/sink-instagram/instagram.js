import { fetchWithRetry } from "@blogagent/http";

/**
 * Thin client for the "Instagram API with Instagram Login" (the current, Facebook-
 * page-free flavor) — just the things the sink needs: one-time consent URL,
 * code → short-lived token, short → long-lived token, token refresh, Instagram
 * User ID lookup, and the two-step media publish.
 *
 * Auth flow (Instagram Login, not Facebook Login):
 *   authorize  → https://www.instagram.com/oauth/authorize   (consent screen)
 *   code→token → https://api.instagram.com/oauth/access_token (short-lived token + user_id)
 *   long-lived → GET {graph}/access_token?grant_type=ig_exchange_token   (60 days, needs secret)
 *   refresh    → GET {graph}/refresh_access_token?grant_type=ig_refresh_token (no secret)
 * where {graph} is https://graph.instagram.com.
 *
 * Publishing is two steps on the graph host: POST /{ig-user-id}/media (create
 * container, returns creation_id) → POST /{ig-user-id}/media_publish (publish it,
 * returns media_id). The image must be at a publicly accessible URL — the sink
 * uploads it to GitHub (instagram-assets branch) before calling createContainer.
 *
 * Long-lived tokens last 60 days. The sink refreshes automatically while the token
 * is still valid; a fully expired token requires a new OAuth run (or a freshly
 * generated token pasted into .env).
 */

// Fixed OAuth hosts for Instagram Login — not configurable (no sandbox for Instagram).
const OAUTH_AUTHORIZE = "https://www.instagram.com/oauth/authorize";
const OAUTH_TOKEN = "https://api.instagram.com/oauth/access_token";

// Instagram caption limit (chars visible before the "more" fold at ~125 chars).
export const CAPTION_MAX = 2200;

// Refresh when fewer than this many seconds remain (7 days).
export const REFRESH_THRESHOLD_S = 7 * 24 * 3600;

/**
 * Build the Instagram Login consent URL. Scopes for content publishing:
 * instagram_business_basic, instagram_business_content_publish.
 */
export function authUrl({ appId, redirectUri, scopes, state = "blogagent" }) {
  const query = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    scope: scopes.join(","),
    response_type: "code",
    state,
  });
  return `${OAUTH_AUTHORIZE}?${query}`;
}

function appendToken(url, token) {
  return `${url}${url.includes("?") ? "&" : "?"}access_token=${token}`;
}

async function graphGet(apiUrl, path, token) {
  const url = appendToken(`${apiUrl}${path}`, token);
  const res = await fetchWithRetry(url, {}, { label: `Instagram GET ${path.split("?")[0]}` });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Instagram GET ${path.split("?")[0]} ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

async function graphPost(apiUrl, path, token, body) {
  // Instagram's graph host takes the access token as a query param; the body is JSON.
  const res = await fetchWithRetry(
    appendToken(`${apiUrl}${path}`, token),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    { label: `Instagram POST ${path.split("?")[0].split("/").at(-1)}` },
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Instagram POST ${path.split("?")[0]} ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

/**
 * Exchange the authorization code from the redirect for a short-lived token.
 * Instagram Login uses a form-encoded POST and returns the user_id alongside the token.
 */
export async function exchangeCode({ appId, appSecret, code, redirectUri }) {
  const res = await fetchWithRetry(
    OAUTH_TOKEN,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code,
      }).toString(),
    },
    { label: "Instagram exchangeCode" },
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Instagram exchangeCode ${res.status}: ${JSON.stringify(json)}`);
  return json; // { access_token, user_id, permissions }
}

/** Exchange a short-lived token for a long-lived one (60 days). Needs the app secret. */
export async function toLongLived({ apiUrl, appSecret, shortToken }) {
  const url = `${apiUrl}/access_token?` +
    new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: appSecret, access_token: shortToken });
  const res = await fetchWithRetry(url, {}, { label: "Instagram toLongLived" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Instagram toLongLived ${res.status}: ${JSON.stringify(json)}`);
  return json; // { access_token, token_type, expires_in }
}

/**
 * Refresh a long-lived token. Unlike Facebook Login, this needs NO app secret —
 * only the still-valid token. A fully expired token requires a new OAuth run.
 */
export async function refreshLongLived({ apiUrl, token }) {
  const url = `${apiUrl}/refresh_access_token?` +
    new URLSearchParams({ grant_type: "ig_refresh_token", access_token: token });
  const res = await fetchWithRetry(url, {}, { label: "Instagram refreshLongLived" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Instagram refreshLongLived ${res.status}: ${JSON.stringify(json)}`);
  return json; // { access_token, token_type, expires_in }
}

/**
 * Resolve the Instagram professional account ID for the token holder.
 * Instagram Login exposes it directly on /me — no Facebook Page lookup.
 */
export async function getUserId({ apiUrl, token }) {
  const me = await graphGet(apiUrl, "/me?fields=user_id", token);
  const id = me.user_id ?? me.id;
  if (!id) throw new Error(`could not resolve Instagram user id: ${JSON.stringify(me)}`);
  return String(id);
}

/**
 * Step 1: create a media container for the image. Returns the creation_id.
 * The image must be at a publicly accessible URL.
 */
export async function createContainer({ apiUrl, userId, token, imageUrl, caption }) {
  const body = { image_url: imageUrl };
  if (caption?.trim()) body.caption = caption.trim().slice(0, CAPTION_MAX);
  const json = await graphPost(apiUrl, `/${userId}/media`, token, body);
  return json.id; // creation_id
}

/**
 * Between create and publish: Instagram fetches and processes the image
 * asynchronously, so publishing immediately fails with code 9007 ("Media ID is not
 * available"). Poll the container's status_code until it is FINISHED. Throws on
 * ERROR/EXPIRED or if it is still not ready after the given number of tries.
 */
export async function waitForContainerReady({ apiUrl, containerId, token, tries = 15, delayMs = 2000 }) {
  for (let i = 0; i < tries; i++) {
    const { status_code } = await graphGet(apiUrl, `/${containerId}?fields=status_code`, token);
    if (status_code === "FINISHED") return;
    if (status_code === "ERROR" || status_code === "EXPIRED") {
      throw new Error(`Instagram media container ${status_code} (id ${containerId})`);
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`Instagram media container still not ready after ${tries} checks (id ${containerId})`);
}

/**
 * Step 2: publish the container. Returns the published media_id.
 * Call this after createContainer succeeds and waitForContainerReady resolves.
 */
export async function publishContainer({ apiUrl, userId, token, creationId }) {
  const json = await graphPost(apiUrl, `/${userId}/media_publish`, token, { creation_id: creationId });
  return json.id; // media_id
}
