#!/usr/bin/env node
import http from "node:http";
import { loadSettings, section } from "@blogagent/config";
import { validateEnvelope } from "@blogagent/envelope";
import { fetchWithRetry, whyFetchFailed } from "@blogagent/http";
import { enrich } from "./context.js";

/**
 * Research — a filter in front of the newsroom, same REST shape on both ends.
 *
 * IN  · `POST /pitches` (an envelope) — exactly what the newsroom accepts.
 * OUT · `POST` the enriched envelope to `research.out` (its next hop, required).
 *
 * That symmetry is the point: filters chain. A source may pitch here, here to the
 * newsroom, or a third filter could sit between — nobody downstream needs to know.
 * Research owns no durable state; the newsroom keeps the queue. If the hop is down
 * the forward fails and the source (which retries) tries the whole thing again, so
 * backpressure lives at the head of the chain, not in a second queue here.
 */

/**
 * Forward an (already enriched) envelope to the next hop and read its answer.
 * Returns `{ status, body }`; throws only when the hop is unreachable. `fetch`
 * is injectable so this is testable without a network.
 */
export async function deliver(out, envelope, { fetch = fetchWithRetry } = {}) {
  const response = await fetch(out, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(envelope),
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

/** Builds the request handler bound to one next hop. */
export function makeHandler(out) {
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

        // Gather the facts, then hand the enriched envelope straight on. We mirror
        // the next hop's status so the source sees the newsroom's own 202/4xx —
        // research is transparent, not a second acceptance point.
        const enriched = await enrich(envelope);
        const { status, body } = await deliver(out, enriched);
        console.log(
          `[research] ${envelope.id?.slice(0, 8)} → ${out} ${status}` +
            (enriched.context?.target_url ? ` · target=${enriched.context.target_url}` : ""),
        );
        return reply(status, body);
      } catch (err) {
        // A JSON parse error is the client's fault (400); an unreachable next hop is
        // ours to report as a bad gateway so the source retries rather than drops.
        const badBody = err instanceof SyntaxError;
        return reply(badBody ? 400 : 502, { errors: [badBody ? err.message : `next hop ${out}: ${whyFetchFailed(err)}`] });
      }
    }

    reply(404, { errors: ["POST /pitches"] });
  };
}

// Only stand up the server when run as a process — importing this module (tests)
// must not read settings.yaml or bind a port.
if (process.argv[1]?.endsWith("index.js")) {
  const cfg = section(loadSettings(), "research");
  const PORT = cfg.num("port", 5085);
  // Required — a research with nowhere to deliver is a dead end, not a default.
  const OUT = cfg.str("out");

  const server = http.createServer(makeHandler(OUT));
  // Localhost only, like every other hop — the chain never leaves the machine.
  server.listen(PORT, "127.0.0.1", () => console.log(`[research] :${PORT} → ${OUT}`));

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
}
