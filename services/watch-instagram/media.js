import { fetchWithRetry } from "@blogagent/http";

/**
 * Instagram media reading — the network call kept apart from the pure shaping and
 * dedup so the latter is testable without the network (mirrors watch-rss/feed.js).
 *
 * Uses the "Instagram API with Instagram Login" media edge `GET /me/media`, where
 * `me` resolves from the access token — so this monitor needs only the token, not
 * the numeric user id. Read-only: it never creates or publishes anything.
 */

/** Fetch the most recent media for the token's account. Network. */
export async function fetchMedia({ apiUrl, token, limit }) {
  const url = `${apiUrl}/me/media?fields=id,permalink,caption,timestamp&limit=${limit}&access_token=${token}`;
  const res = await fetchWithRetry(url, {}, { label: "watch-instagram media" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`media ${res.status}: ${JSON.stringify(json)}`);
  return parseMedia(json);
}

/** Shape the API payload into the fields we report. Pure. */
export function parseMedia(json) {
  return (json?.data ?? [])
    .filter((m) => m && m.id)
    .map((m) => ({
      id: String(m.id),
      permalink: m.permalink ?? "",
      caption: m.caption ?? "",
      timestamp: m.timestamp ?? "",
    }));
}

/** Media whose id is not in `seen`, in the order the API lists them (newest-first). */
export function freshMedia(items, seen) {
  return items.filter((m) => !seen.has(m.id));
}

/**
 * Every Instagram account with a token in a .env file, discovered by convention:
 * `INSTAGRAM_ACCESS_TOKEN` is the "default" account, `INSTAGRAM_<NAME>_ACCESS_TOKEN`
 * a named one. Agnostic — no account list is configured; the watcher reports whatever
 * tokens exist. Deduped by token value (a named account sharing the default's token
 * mid-migration is watched once), preferring the named label. Pure.
 * @returns {{label:string, token:string}[]}
 */
export function discoverAccounts(envText) {
  const byToken = new Map(); // token value -> label
  for (const m of envText.matchAll(/^[ \t]*INSTAGRAM_(?:(\w+?)_)?ACCESS_TOKEN=(.*)$/gm)) {
    const token = m[2].trim();
    if (!token) continue;
    const label = m[1] ? m[1].toLowerCase() : "default";
    if (!byToken.has(token) || byToken.get(token) === "default") byToken.set(token, label);
  }
  return [...byToken].map(([token, label]) => ({ label, token }));
}

/** The caption's first non-empty line — the article title, since the sink puts it first. */
export function firstLine(caption) {
  const line = (caption ?? "")
    .split("\n")
    .map((s) => s.trim())
    .find(Boolean);
  return line || "(ohne Text)";
}
