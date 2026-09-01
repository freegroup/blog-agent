import { fetchWithRetry } from "@blogagent/http";

/**
 * Thin client for the Instagram Graph API — just the things the sink needs:
 * one-time consent URL, code → short-lived token, short → long-lived token,
 * token refresh, Instagram User ID lookup, and the two-step media publish.
 *
 * Publishing is two steps: POST /{ig-user-id}/media (create container, returns
 * creation_id) → POST /{ig-user-id}/media_publish (publish it, returns media_id).
 * The image must be at a publicly accessible URL — the sink uploads it to GitHub
 * (instagram-assets branch) before calling createContainer.
 *
 * Long-lived tokens last 60 days. The sink refreshes automatically while the token
 * is still valid; if it expires a new OAuth run is needed.
 */

const AUTH_BASE = "https://www.facebook.com/v21.0/dialog/oauth";

// Instagram caption limit (chars visible before the "more" fold at ~125 chars).
export const CAPTION_MAX = 2200;

// Refresh when fewer than this many seconds remain (7 days).
export const REFRESH_THRESHOLD_S = 7 * 24 * 3600;

/**
 * Build the Facebook OAuth consent URL. Scopes needed for content publishing:
 * instagram_basic, instagram_content_publish, pages_show_list, pages_read_engagement.
 */
export function authUrl({ appId, redirectUri, scopes, state = "blogagent" }) {
  const query = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    scope: scopes.join(","),
    response_type: "code",
    state,
  });
  return `${AUTH_BASE}?${query}`;
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
  const res = await fetchWithRetry(
    `${apiUrl}${path}`,
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    },
    { label: `Instagram POST ${path.split("?")[0].split("/").at(-1)}` },
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Instagram POST ${path.split("?")[0]} ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

/** Exchange the authorization code from the redirect for a short-lived token. */
export async function exchangeCode({ apiUrl, appId, appSecret, code, redirectUri }) {
  const url = `${apiUrl}/oauth/access_token?` +
    new URLSearchParams({ client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code });
  const res = await fetchWithRetry(url, {}, { label: "Instagram exchangeCode" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Instagram exchangeCode ${res.status}: ${JSON.stringify(json)}`);
  return json; // { access_token, token_type }
}

/** Exchange a short-lived token for a long-lived one (60 days). */
export async function toLongLived({ apiUrl, appId, appSecret, shortToken }) {
  const url = `${apiUrl}/oauth/access_token?` +
    new URLSearchParams({ grant_type: "fb_exchange_token", client_id: appId, client_secret: appSecret, fb_exchange_token: shortToken });
  const res = await fetchWithRetry(url, {}, { label: "Instagram toLongLived" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Instagram toLongLived ${res.status}: ${JSON.stringify(json)}`);
  return json; // { access_token, token_type, expires_in }
}

/**
 * Refresh a long-lived token (same endpoint, same mechanism — only works while
 * the token is still valid; a fully expired token requires a new OAuth run).
 */
export async function refreshLongLived({ apiUrl, appId, appSecret, token }) {
  return toLongLived({ apiUrl, appId, appSecret, shortToken: token });
}

/**
 * Resolve the Instagram Business/Creator account ID from the user's Facebook Pages.
 * Requires `instagram_basic` and `pages_show_list` permissions.
 * Throws if no connected Instagram account is found.
 */
export async function getUserId({ apiUrl, token }) {
  const pages = await graphGet(apiUrl, "/me/accounts", token);
  for (const page of pages.data ?? []) {
    const ig = await graphGet(apiUrl, `/${page.id}?fields=instagram_business_account`, token);
    if (ig.instagram_business_account?.id) return ig.instagram_business_account.id;
  }
  throw new Error(
    "no Instagram Business/Creator account found — connect your Instagram account to a Facebook Page first",
  );
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
 * Step 2: publish the container. Returns the published media_id.
 * Call this after createContainer succeeds.
 */
export async function publishContainer({ apiUrl, userId, token, creationId }) {
  const json = await graphPost(apiUrl, `/${userId}/media_publish`, token, { creation_id: creationId });
  return json.id; // media_id
}
