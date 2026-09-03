import { validateEnvelope } from "@blogagent/envelope";
import { fetchWithRetry, whyFetchFailed } from "@blogagent/http";
import * as defaultStore from "./store.js";
import { chatIdOf } from "./store.js";
import { runFilters } from "./pipeline.js";

/**
 * step-dialog — the reception desk in front of step-research.
 *
 * IN  · `POST /pitches` (an envelope) — same shape every hop speaks.
 * OUT · a completed request is `POST`ed on to `step-dialog.out` (step-research).
 *
 * Its job is to look at a request before any expensive work starts and decide, via
 * the filter pipeline, whether to forward it, ask the user something first, answer a
 * read-only request itself, or repost a past posting. It only ever SENDS on Telegram
 * (the clarifying question / the answer) — it never polls, so it never fights the
 * source's poller for the token.
 *
 * State lives on disk (var/queue), not in the process: a parked clarification is a
 * `status: awaiting-reply` entry the newsroom ignores. All request handling lives
 * here so it is import-testable; index.js is bootstrap only.
 */

/**
 * Forward an envelope to the next hop and read its answer. Returns `{status, body}`;
 * throws only when the hop is unreachable. Tests mock the global `fetch` that
 * `fetchWithRetry` calls — no injected parameter.
 */
export async function deliver(out, envelope) {
  const response = await fetchWithRetry(out, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(envelope),
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

/**
 * Builds the request handler.
 *
 * @param {{out:string, queueDir:string, telegram:{call:Function}, llm:{complete:Function},
 *          store?:object, filters?:Function[]}} deps
 */
export function makeHandler({ out, queueDir, telegram, llm, store = defaultStore, filters }) {
  // Sending a message must never take the request down: a failed courtesy is logged,
  // and for an "ask" the parked entry stays so the user can simply write again.
  const notify = async (text) => {
    try {
      await telegram.call("send_message", { text });
    } catch (err) {
      console.error(`[step-dialog] telegram send failed: ${err.message}`);
    }
  };

  return async (req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (req.method === "POST" && req.url === "/pitches") {
      try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const envelope = JSON.parse(Buffer.concat(chunks).toString("utf8"));

        const errors = validateEnvelope(envelope);
        if (errors.length) return reply(400, { errors });

        // Is a clarification open for this chat? Then this message may be its reply.
        const chatId = chatIdOf(envelope);
        const pending = chatId ? store.pendingForChat(queueDir, chatId) : null;

        const r = await runFilters({ envelope, pending, llm, store, queueDir }, filters ? { filters } : {});
        const short = envelope.id?.slice(0, 8);

        switch (r.decision) {
          case "decline":
            await notify(r.message);
            if (pending) store.discard(queueDir, pending.id);
            console.log(`[step-dialog] ${short} declined`);
            return reply(202, { status: "declined" });

          case "answer":
            await notify(r.message);
            if (pending) store.discard(queueDir, pending.id);
            console.log(`[step-dialog] ${short} answered`);
            return reply(202, { status: "answered" });

          case "ask":
            // Park BEFORE sending: if the send fails the entry is already there, so a
            // resend by the user is still recognised as the reply.
            store.park(queueDir, envelope, r.message, { reactivation: r.reactivation });
            await notify(r.message);
            console.log(`[step-dialog] ${short} clarifying${r.reactivation ? " (repost)" : ""}`);
            return reply(202, { status: "clarifying" });

          case "reactivate": {
            const { status, body } = await deliver(out, r.envelope);
            if (pending) store.discard(queueDir, pending.id);
            console.log(`[step-dialog] ${short} reactivated → ${r.envelope.id.slice(0, 8)} ${status}`);
            return reply(status, body);
          }

          default: {
            // forward: the request is complete. It keeps its original id, so the
            // newsroom's accept() later overwrites any parked entry for it — no delete
            // needed here. A parked reactivation for this chat that we did NOT answer
            // is stale, so drop it.
            const { status, body } = await deliver(out, envelope);
            if (pending) store.discard(queueDir, pending.id);
            console.log(`[step-dialog] ${short} → ${out} ${status}`);
            return reply(status, body);
          }
        }
      } catch (err) {
        // A JSON parse error is the client's fault (400); an unreachable next hop is
        // ours to report as a bad gateway so the source retries rather than drops.
        const badBody = err instanceof SyntaxError;
        return reply(badBody ? 400 : 502, {
          errors: [badBody ? err.message : `next hop ${out}: ${whyFetchFailed(err)}`],
        });
      }
    }

    reply(404, { errors: ["POST /pitches"] });
  };
}
