import { history } from "@blogagent/chat";

/**
 * Research — fact-gathering as a filter in front of the newsroom.
 *
 * It establishes the shared facts a pitch needs before any ressort writes, and
 * every ressort then makes of them what it wants. Facts are facts. The output
 * lives in `envelope.context` and is the same for every briefing of the pitch.
 *
 * First (and so far only) resolver: the target URL — the link a pin, a caption,
 * or a cross-reference points at. It comes either explicitly from the text
 * ("pin https://…") or, when the user refers back ("mach aus der letzten URL
 * einen Pin"), from the chat history, where `watch-rss` recorded every blog that
 * went live. That is why the hub exists.
 *
 * @typedef {{ target_url: string|null, reference_urls: string[] }} Context
 */

const URL_RE = /(https?:\/\/[^\s)"'<>]+)/i;
// The user pointing back at "the last one" rather than pasting a URL.
const BACKREF = /\b(letzte[ns]?|last|obige[nr]?|davon|daf[üu]r|dazu|diese[rs]?\s+(url|link|blog|seite))\b/i;

/** The first URL in the text, trailing punctuation stripped, or null. */
export function extractUrl(text) {
  const m = (text ?? "").match(URL_RE);
  return m ? m[1].replace(/[.,;:!?]+$/, "") : null;
}

/** The most recent URL in the conversation: a live blog (structured) wins, else any URL. */
export function lastUrl(recent) {
  for (let i = recent.length - 1; i >= 0; i--) {
    const url = recent[i]?.meta?.kind === "blog-live" ? recent[i].meta.url : null;
    if (url) return url;
  }
  for (let i = recent.length - 1; i >= 0; i--) {
    const url = extractUrl(recent[i]?.text);
    if (url) return url;
  }
  return null;
}

/**
 * Pure: build the context from the pitch text and the recent conversation.
 * An explicit URL always wins; a back-reference falls back to the last URL seen.
 *
 * @param {{ text?: string, recent?: object[] }} arg
 * @returns {Context}
 */
export function buildContext({ text = "", recent = [] }) {
  const explicit = extractUrl(text);
  const target_url = explicit ?? (BACKREF.test(text) ? lastUrl(recent) : null);
  return { target_url, reference_urls: [] };
}

/**
 * Gather the facts for a pitch text. Reads the chat history for back-references;
 * a hub that is down just yields no history, so an explicit URL still resolves.
 *
 * @param {{ text?: string }} pitch  the pitch's text
 * @param {{ getRecent?: () => Promise<object[]> }} [deps]  injectable for tests
 * @returns {Promise<Context>}
 */
export async function gather({ text = "" }, { getRecent = () => history({ limit: 100 }) } = {}) {
  const recent = await getRecent().catch(() => []);
  return buildContext({ text, recent });
}

/**
 * Enrich an envelope with `context`, the shape the newsroom reads back.
 *
 * A revision already carries its facts in `doc` (the article's blogagent.yaml),
 * so we never recompute — recomputing could clobber a good target URL with null
 * when a review comment happens to mention no link. A fresh pitch gets fresh facts.
 *
 * @param {object} envelope
 * @param {{ getRecent?: () => Promise<object[]> }} [deps]
 * @returns {Promise<object>}  a new envelope with `context` set
 */
export async function enrich(envelope, deps = {}) {
  if (envelope.doc) return envelope;
  const context = await gather({ text: envelope.text ?? "" }, deps);
  return { ...envelope, context };
}
