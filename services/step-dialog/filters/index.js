import { referenceRepost } from "./reference-repost.js";
import { referenceShow } from "./reference-show.js";

/**
 * The filter list. Order is irrelevant to the outcome — the aggregation in
 * pipeline.js decides by precedence, not position. This is the same "a list you
 * extend or trim" shape as `newsroom.pipeline`: add a filter = add a file here.
 *
 * A filter is `async (ctx) => verdict` where
 *   ctx = { envelope, pending, llm, store, queueDir }
 * and the verdict is one of the shapes in verdict.js (ACK / USER-REQUEST / DECLINE
 * / ANSWER / REACTIVATE). A filter that is not responsible returns `ack()`.
 *
 * v1 ships exactly two, both about "the last posting":
 *   - reference-repost: "poste das letzte noch mal auf xyz" (confirm, then repost)
 *   - reference-show:   "zeige mir das letzte Posting"      (answer directly)
 */
export const filters = [referenceRepost, referenceShow];
