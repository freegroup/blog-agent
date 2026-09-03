/**
 * The filter verdict protocol + the one-shot LLM call the filters share.
 *
 * A filter looks at one request and returns exactly one verdict. The set is small
 * and fixed with the user:
 *
 *   ACK          — this filter is satisfied, nothing to do.
 *   USER-REQUEST — something is missing / needs confirming; `response` is the
 *                  question, and the request is parked until the user replies.
 *   DECLINE      — the request violates a hard rule; `response` is the reason.
 *   ANSWER       — the filter already fulfilled a read-only request (e.g. "show me
 *                  the last posting"); `response` is the answer. Nothing forwards.
 *   REACTIVATE   — repost a past posting: `envelope` is a fresh pitch (new id, built
 *                  from the retained one) to forward down the normal chain.
 *
 * A meaning-based filter hands the model a single terminal tool and reads back a
 * structured answer (`askStructured`). This is the `askTool` idea from the
 * newsroom's converse.js, deliberately rebuilt small and dependency-free here
 * rather than imported: converse.js throws newsroom-internal StageErrors and lives
 * behind the pipeline's stage context. A filter needs one turn and one structured
 * reply, nothing more.
 *
 * Works against the LLM's `.complete` interface alone (same contract tidy uses),
 * so any provider fits and a fake one makes every filter testable without a
 * network.
 */

/** The verdict types a filter can return. */
export const ACK = "ACK";
export const USER_REQUEST = "USER-REQUEST";
export const DECLINE = "DECLINE";
export const ANSWER = "ANSWER";
export const REACTIVATE = "REACTIVATE";

/** A filter is satisfied and has nothing to say. */
export const ack = () => ({ type: ACK, response: null });

/**
 * Ask the model one structured question through a single terminal tool and return
 * its input object. If the model makes no (matching) tool call, returns `{}` — the
 * caller reads the fields defensively so a malformed reply degrades to "no intent"
 * rather than hanging the request.
 *
 * @param {{complete: Function}} llm
 * @param {{system: string, instruction: string, tool: {name:string, inputSchema:object, description?:string}}} opts
 * @returns {Promise<object>}
 */
export async function askStructured(llm, { system, instruction, tool }) {
  const reply = await llm.complete({
    system,
    messages: [{ role: "user", content: [{ type: "text", text: instruction }] }],
    tools: [tool],
  });

  const call = (reply.toolCalls ?? []).find((c) => c.name === tool.name);
  return call?.input ?? {};
}
