import { appendFileSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import path from "node:path";

/**
 * Dual-write store for the chat-history hub.
 *
 * Every message is written to two places:
 *   1. {dir}/{YYYY-MM-DD}.jsonl — the full daily log, append-only, never pruned.
 *   2. {dir}/current.jsonl      — a rolling window of the last `maxContext` entries,
 *                                  rewritten in full on every append.
 *
 * current.jsonl is the slice that consumers (research, etc.) use as context. Its
 * size is bounded so a long-running instance never inflates the context window.
 * The in-memory buffer mirrors it, so `recent()` never reads from disk at call time.
 */
export function makeStore(dir, maxContext) {
  mkdirSync(dir, { recursive: true });

  const currentFile = path.join(dir, "current.jsonl");

  // Seed the in-memory buffer from current.jsonl so a restart picks up where it left off.
  let buffer = [];
  try {
    buffer = readFileSync(currentFile, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean)
      .slice(-maxContext);
  } catch {
    /* first start — no current.jsonl yet */
  }

  function todayFile() {
    return path.join(dir, new Date().toISOString().slice(0, 10) + ".jsonl");
  }

  function flushCurrent() {
    writeFileSync(currentFile, buffer.map((e) => JSON.stringify(e)).join("\n") + (buffer.length ? "\n" : ""));
  }

  return {
    /** Append an entry, write to today's daily file and rewrite current.jsonl. */
    append(entry) {
      const stamped = { ts: new Date().toISOString(), ...entry };
      const line = JSON.stringify(stamped);

      // 1. Permanent daily log.
      appendFileSync(todayFile(), line + "\n");

      // 2. Rolling context window.
      buffer.push(stamped);
      if (buffer.length > maxContext) buffer = buffer.slice(-maxContext);
      flushCurrent();

      return line;
    },

    /** The last `limit` entries from the in-memory buffer, oldest-first. */
    recent(limit) {
      return buffer.slice(-limit);
    },
  };
}
