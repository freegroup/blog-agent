import { mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, statSync } from "node:fs";
import path from "node:path";
import { parse, stringify } from "yaml";

/**
 * A thin store over the SAME directory the newsroom queue uses (`var/queue`). The
 * status is the key, not the folder:
 *
 *   - an open clarification is a `<envelope.id>.yaml` entry with
 *     `status: "awaiting-reply"` and NO `jobs` array, so the newsroom ignores it
 *     (restore()/cleanup() skip it) and step-dialog finds it by scanning for that
 *     status;
 *   - a finished posting the newsroom kept is `status: "published"` WITH its jobs
 *     (envelope, media, and the finished doc) — the lookup source for "the last
 *     posting". step-dialog only reads those.
 *
 * We deliberately do NOT import the newsroom's Queue class: what is shared is the
 * DATA contract (directory + YAML shape + status field), not the code.
 *
 * The hand-off of a NORMAL clarification back to the newsroom is free — a forwarded
 * request keeps its original envelope.id, so accept() overwrites the parked file.
 * A reactivation is different (the repost is a NEW pitch with a NEW id), so its
 * awaiting-reply entry is explicitly discarded once the user answers.
 *
 * @typedef {{source_id:string, target:string}} Reactivation
 * @typedef {{id:string, envelope:object, status:'awaiting-reply', question:string,
 *            created_at:string, reactivation?:Reactivation}} Parked
 */
const SUFFIX = ".yaml";

/** The chat id an envelope belongs to, from `chat:<id>/msg:<n>`. null if absent. */
export function chatIdOf(envelope) {
  const m = /^chat:([^/]+)\/msg:/.exec(envelope?.source_ref ?? "");
  return m ? m[1] : null;
}

/** Atomic write: beside, then rename — a torn write must never be visible. */
function writeEntry(dir, entry) {
  mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `${entry.id}${SUFFIX}`);
  const tmp = `${target}.${process.pid}.tmp`;
  // lineWidth folds long prose to readable multiline; base64 in envelope.media has
  // no spaces to fold at, so it round-trips losslessly on its own line.
  writeFileSync(tmp, stringify(entry, { lineWidth: 80 }));
  renameSync(tmp, target);
}

/** Parse one entry by id, or null if it is missing or unreadable. */
export function read(dir, id) {
  try {
    return parse(readFileSync(path.join(dir, `${id}${SUFFIX}`), "utf8"));
  } catch {
    return null;
  }
}

/**
 * Park a request whose clarification is still open. Writes the WHOLE envelope (so
 * the media — base64 the chat history does not carry — is preserved) under its own
 * id. Called again for follow-up rounds; it overwrites the same file. A
 * `reactivation` marker turns the parked entry into a repost confirmation: the next
 * message from that chat is the user's yes/no.
 */
export function park(dir, envelope, question, { reactivation } = {}) {
  const entry = {
    id: envelope.id,
    envelope,
    status: "awaiting-reply",
    question,
    created_at: new Date().toISOString(),
  };
  if (reactivation) entry.reactivation = reactivation;
  writeEntry(dir, entry);
}

/** Drop a parked entry. Used after a repost confirmation is resolved (its repost is
 *  a new pitch with a new id, so nothing overwrites the parked file for us). */
export function discard(dir, id) {
  try {
    unlinkSync(path.join(dir, `${id}${SUFFIX}`));
  } catch {
    // already gone — nothing to do
  }
}

/**
 * The open clarification for a chat, or null. Scans the directory for an
 * `awaiting-reply` entry whose envelope belongs to `chatId`. There is at most one
 * open clarification per chat (park overwrites), so the first match is it. A broken
 * or foreign .yaml must not throw — we skip anything that does not parse or lacks
 * the status.
 */
export function pendingForChat(dir, chatId) {
  for (const entry of entries(dir)) {
    if (entry?.status !== "awaiting-reply") continue;
    if (chatIdOf(entry.envelope) === chatId) return entry;
  }
  return null;
}

/**
 * The most recently published posting, or null. "The last posting" is deterministic
 * — the newest `published` entry by file mtime (publish() rewrites the file, so its
 * mtime is the publish time). This is what "poste das letzte …" / "zeige mir das
 * letzte …" resolve against.
 */
export function lastPublished(dir) {
  let best = null;
  let bestAt = -Infinity;
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(SUFFIX));
  } catch {
    return null;
  }
  for (const file of files) {
    const full = path.join(dir, file);
    let pitch;
    try {
      pitch = parse(readFileSync(full, "utf8"));
    } catch {
      continue;
    }
    if (pitch?.status !== "published") continue;
    const at = statSync(full).mtimeMs;
    if (at > bestAt) {
      bestAt = at;
      best = pitch;
    }
  }
  return best;
}

/** The headline of a published pitch, with a sensible fallback for the message. */
export function titleOf(pitch) {
  const job = (pitch?.jobs ?? []).find((j) => j?.doc?.title);
  return job?.doc?.title || (pitch?.envelope?.text ?? "").trim().slice(0, 60) || "das letzte Posting";
}

/** A one-line description of a published posting for a "show me the last one" reply. */
export function describePosting(pitch) {
  const title = titleOf(pitch);
  const urls = (pitch?.jobs ?? []).map((j) => j?.url).filter(Boolean);
  return urls.length
    ? `Das letzte Posting war „${title}“: ${urls.join(", ")}`
    : `Das letzte Posting war „${title}“.`;
}

/** All parseable entries in the directory (skips anything that does not parse). */
function* entries(dir) {
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(SUFFIX));
  } catch {
    return; // directory not there yet — nothing parked
  }
  for (const file of files) {
    try {
      yield parse(readFileSync(path.join(dir, file), "utf8"));
    } catch {
      // broken or half-written — skip
    }
  }
}
