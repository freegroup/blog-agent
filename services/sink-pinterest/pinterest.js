import { fetchWithRetry } from "@blogagent/http";

/**
 * Thin client for the Pinterest API v5 — just the three things the sink needs:
 * build the one-time authorization URL, trade a code or a refresh token for an
 * access token, and create a Pin.
 *
 * The running sink never touches the authorization URL again; it only refreshes
 * (server-to-server, no browser). Endpoints and shapes verified against Pinterest's
 * v5 docs: token at POST /v5/oauth/token (HTTP Basic app_id:app_secret,
 * x-www-form-urlencoded), pins at POST /v5/pins with a base64 media_source.
 */

// The user-facing authorization page lives on the main site, not the API host.
const AUTH_BASE = "https://www.pinterest.com/oauth/";

// Pinterest's own caps, applied defensively so an overlong article never gets the
// whole Pin rejected.
const TITLE_MAX = 100;
const DESCRIPTION_MAX = 800;
const ALT_TEXT_MAX = 500;

/**
 * The URL the user opens once to grant access. `scopes` is an array, joined with
 * commas as Pinterest expects.
 * @param {{appId:string, redirectUri:string, scopes:string[], state?:string}} arg
 */
export function authUrl({ appId, redirectUri, scopes, state = "blogagent" }) {
  const query = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes.join(","),
    state,
  });
  return `${AUTH_BASE}?${query}`;
}

async function requestToken({ apiUrl, appId, appSecret, form }) {
  const basic = Buffer.from(`${appId}:${appSecret}`).toString("base64");
  const response = await fetchWithRetry(
    `${apiUrl}/v5/oauth/token`,
    {
      method: "POST",
      headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    },
    { label: "Pinterest oauth/token" },
  );
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Pinterest oauth/token ${response.status}: ${JSON.stringify(json)}`);
  return json; // { access_token, refresh_token?, expires_in, ... }
}

/** Exchange the authorization code from the redirect for a token pair. */
export function exchangeCode({ apiUrl, appId, appSecret, code, redirectUri }) {
  return requestToken({
    apiUrl,
    appId,
    appSecret,
    // refresh_on opts into everlasting refresh, so the refresh token stays valid
    // instead of expiring after 60 days.
    form: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, refresh_on: "true" }),
  });
}

/** Trade the stored refresh token for a fresh access token. */
export function refreshAccess({ apiUrl, appId, appSecret, refreshToken }) {
  return requestToken({
    apiUrl,
    appId,
    appSecret,
    form: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, refresh_on: "true" }),
  });
}

/**
 * Build the POST /v5/pins request body. Pure, so the mapping is testable without a
 * network. The image is sent inline as base64 — no publicly reachable URL needed.
 * @param {{boardId:string, title?:string, description?:string, link?:string|null,
 *          imageBase64:string, contentType?:string, altText?:string}} arg
 */
export function pinBody({ boardId, title, description, link, imageBase64, contentType = "image/jpeg", altText }) {
  const body = {
    board_id: boardId,
    media_source: { source_type: "image_base64", content_type: contentType, data: imageBase64 },
  };
  if (title?.trim()) body.title = title.trim().slice(0, TITLE_MAX);
  if (description?.trim()) body.description = description.trim().slice(0, DESCRIPTION_MAX);
  if (link) body.link = link;
  if (altText?.trim()) body.alt_text = altText.trim().slice(0, ALT_TEXT_MAX);
  return body;
}

/** Create a Pin and return its id. */
export async function createPin({ apiUrl, accessToken, ...fields }) {
  const response = await fetchWithRetry(
    `${apiUrl}/v5/pins`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify(pinBody(fields)),
    },
    { label: "Pinterest pins" },
  );
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Pinterest pins ${response.status}: ${JSON.stringify(json)}`);
  return json.id;
}
