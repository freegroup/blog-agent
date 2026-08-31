import { appendFileSync, readFileSync, mkdirSync } from "node:fs";
import path from "node:path";

/**
 * The hub's persistence: one JSON line per message, append-only. Pure over a
 * file path so it is testable without a server. It stamps `ts` and otherwise
 * stores whatever it is given — it never interprets a message.
 */
export function makeStore(file) {
  return {
    /** Append an entry (ts is added) and return the exact line written. */
    append(entry) {
      const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
      mkdirSync(path.dirname(file), { recursive: true });
      appendFileSync(file, line + "\n");
      return line;
    },

    /** The last `limit` entries, oldest-first. Empty if there is nothing yet. */
    recent(limit) {
      let raw;
      try {
        raw = readFileSync(file, "utf8");
      } catch {
        return [];
      }
      return raw
        .split("\n")
        .filter(Boolean)
        .slice(-limit)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    },
  };
}
