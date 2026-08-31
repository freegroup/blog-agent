import { stringify } from "yaml";

/**
 * Renders a permanently-failed pitch as a file — in the exact same shape and
 * with the same serializer as a queue file, so a dead letter can be copied
 * straight back into the queue directory to reprocess it (delete `state`/`ref`/
 * `url` to say "run again" — see queue.js). The queue folds long prose to
 * `lineWidth: 80`; we match it so the two are byte-for-byte interchangeable.
 *
 * Kept pure (no fs) so it is testable without a server or the Telegram MCP —
 * the caller does the writing.
 *
 * @param {{id:string, envelope:object, jobs:object[], created_at:string}} pitch
 * @returns {{filename:string, content:string}}
 */
export function deadletterRecord(pitch) {
  return {
    filename: `${pitch.id}.yaml`,
    content: stringify(pitch, { lineWidth: 80 }),
  };
}
