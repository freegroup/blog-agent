import { mergeSentences as defaultMerge } from "@blogagent/tidy";
import { filters as defaultFilters } from "./filters/index.js";
import { ACK, USER_REQUEST, DECLINE, ANSWER, REACTIVATE } from "./filters/verdict.js";

/**
 * Run every filter over one request and fold their verdicts into a single decision,
 * by PRECEDENCE — not by order:
 *
 *   1. any DECLINE    → "decline":  tell the user, park nothing, forward nothing.
 *   2. any REACTIVATE → "reactivate": forward the fresh pitch the filter built.
 *   3. any ANSWER     → "answer":   the filter already fulfilled the request; reply.
 *   4. any USER-REQUEST → "ask":    ask the user; the request is parked. A
 *      `reactivation` marker (repost confirmation) is carried through for parking.
 *   5. else (all ACK) → "forward":  the request is complete, hand it on.
 *
 * Every text we send back to the user is merged the same way: one message passes
 * through verbatim, several are folded into one natural sentence (mergeSentences) so
 * the user gets a single message, not a burst — for DECLINE, ANSWER and USER-REQUEST
 * alike.
 *
 * Every filter runs, and a filter that throws counts as ACK: a broken judgement must
 * never hang a request — the worst it may do is let one through. `filters` and
 * `mergeSentences` are injected so the aggregation is testable with fakes.
 *
 * @param {{envelope:object, pending?:object, llm:{complete:Function}, store?:object, queueDir?:string}} ctx
 * @returns {Promise<{decision:'decline'|'reactivate'|'answer'|'ask'|'forward', message?:string, envelope?:object, reactivation?:object}>}
 */
export async function runFilters(ctx, { filters = defaultFilters, mergeSentences = defaultMerge } = {}) {
  const verdicts = await Promise.all(
    filters.map(async (filter) => {
      try {
        return await filter(ctx);
      } catch (err) {
        console.error(`[step-dialog] filter '${filter.name || "anonymous"}' failed, treating as ACK: ${err.message}`);
        return { type: ACK, response: null };
      }
    }),
  );

  const of = (type) => verdicts.filter((v) => v?.type === type);
  const messagesOf = (type) => of(type).map((v) => (v.response ?? "").trim()).filter(Boolean);
  // One outgoing message, "wie immer": verbatim if single, merged into one sentence
  // if several.
  const one = async (list) => (list.length <= 1 ? (list[0] ?? "") : await mergeSentences(list, ctx.llm));

  if (of(DECLINE).length) return { decision: "decline", message: await one(messagesOf(DECLINE)) };

  const reactivate = of(REACTIVATE).find((v) => v.envelope);
  if (reactivate) return { decision: "reactivate", envelope: reactivate.envelope };

  if (of(ANSWER).length) return { decision: "answer", message: await one(messagesOf(ANSWER)) };

  const requests = of(USER_REQUEST);
  if (requests.length) {
    return {
      decision: "ask",
      message: await one(messagesOf(USER_REQUEST)),
      reactivation: requests.find((v) => v.reactivation)?.reactivation,
    };
  }

  return { decision: "forward" };
}
