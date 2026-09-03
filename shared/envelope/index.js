import { randomUUID } from "node:crypto";

/**
 * The envelope is the only form in which an impulse reaches the newsroom.
 * Every source normalises to this — Telegram, GitHub, whatever comes next.
 *
 * A revision carries two extra things the source read back from the published
 * article: `doc` — the persisted pipeline document (the article's own truth:
 * plot, markdown, title, slug, image_names, …) — and `review`, the comment
 * history driving the change. Every pipeline stage sees both and decides, on its
 * own fields, whether to pass through, adjust, or redo. A fresh pitch leaves both
 * empty (`doc: null`, `review: []`).
 *
 * `context` is the shared facts a hop enriches the envelope with before it
 * reaches the newsroom (the `step-research` service: target URL, references). It rides
 * along the envelope so the chain stays composable — a source may point straight
 * at the newsroom and then `context` is simply absent (`null`).
 *
 * @typedef {{kind:'image', mime:string, data:string}} Medium   data = base64
 * @typedef {{author?:string, body:string, at?:string}} Comment
 * @typedef {{target_url:string|null, reference_urls:string[]}} Context
 * @typedef {{
 *   id:string, source:string, source_ref:string, received_at:string,
 *   text:string, media:Medium[], revises:string|null,
 *   doc:object|null, review:Comment[], context:Context|null
 * }} Envelope
 */

/** `github:<owner>/<repo>#<nr>` — derivable, so sources can build it themselves. */
const REVISES = /^github:[\w.-]+\/[\w.-]+#\d+$/;

export function makeEnvelope({ source, source_ref, text, media = [], revises = null, doc = null, review = [], context = null }) {
  return {
    id: randomUUID(),
    source,
    source_ref,
    received_at: new Date().toISOString(),
    text,
    media,
    revises,
    doc,
    review,
    context,
  };
}

/**
 * Posts an envelope to the newsroom and returns the pitch id it assigned.
 * Every source normalises to an envelope and then hands it on through here —
 * the one place the source→newsroom transport lives. Validates first, so a
 * malformed envelope fails fast at the source instead of after a wasted round-trip
 * (the receiver still validates too — this is a guard, not the authority). Throws a
 * legible error on a non-2xx (the newsroom's `errors`, else the status text) so the
 * caller decides whether to retry or drop.
 */
export async function forwardEnvelope(envelope, targetUrl) {
  const invalid = validateEnvelope(envelope);
  if (invalid.length) throw new Error(invalid.join("; "));
  const response = await fetch(targetUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(envelope),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body.errors ?? [response.statusText]).join("; "));
  return body.id;
}

/**
 * Validates an incoming envelope. Returns a list of errors —
 * empty means valid. Does not throw, so the caller can respond with 400.
 */
export function validateEnvelope(env) {
  const errors = [];
  const str = (key) => typeof env?.[key] === "string" && env[key].length > 0;

  if (!str("id")) errors.push("id missing");
  if (!str("source")) errors.push("source missing");
  if (!str("source_ref")) errors.push("source_ref missing");
  if (!str("received_at")) errors.push("received_at missing");

  const hasText = typeof env?.text === "string" && env.text.trim().length > 0;
  const media = Array.isArray(env?.media) ? env.media : null;
  if (!media) errors.push("media must be an array");
  if (!hasText && !(media?.length > 0)) errors.push("text or media must be filled");

  for (const [i, m] of (media ?? []).entries()) {
    if (m?.kind !== "image") errors.push(`media[${i}].kind must be 'image'`);
    if (typeof m?.mime !== "string") errors.push(`media[${i}].mime missing`);
    if (typeof m?.data !== "string") errors.push(`media[${i}].data missing`);
  }

  if (env?.revises !== null && env?.revises !== undefined && !REVISES.test(env.revises)) {
    errors.push("revises must be github:owner/repo#nr");
  }

  if (env?.doc !== undefined && env.doc !== null && typeof env.doc !== "object") {
    errors.push("doc must be an object or null");
  }
  if (env?.review !== undefined && !Array.isArray(env.review)) {
    errors.push("review must be an array");
  }
  if (env?.context !== undefined && env.context !== null && typeof env.context !== "object") {
    errors.push("context must be an object or null");
  }

  return errors;
}

/** Parses a publication_ref. Returns null if it does not match. */
export function parseRef(ref) {
  const m = /^github:([\w.-]+)\/([\w.-]+)#(\d+)$/.exec(ref ?? "");
  return m ? { owner: m[1], repo: m[2], number: Number(m[3]) } : null;
}

export function formatRef(owner, repo, number) {
  return `github:${owner}/${repo}#${number}`;
}
