import { whyFetchFailed } from "@blogagent/http";

/**
 * Ships a finished article to a channel's sinks.
 *
 * A channel has one authoritative `targetSink` (the real publication) and an
 * optional `loggingSink` (a best-effort debug copy, e.g. the file sink). The
 * logging copy is written FIRST and never fatal — so the artifact exists even
 * when the real publish then fails and the job goes on to retry/dead-letter.
 * Only the target's response counts: it is what the queue records as the
 * publication ref, and only its failure propagates.
 *
 * `fetch` and `log` are injectable so this is testable without a network.
 */
export async function deliver({ targetSink, loggingSink }, payload, { fetch = globalThis.fetch, log = console } = {}) {
  if (loggingSink) {
    await postSink(fetch, loggingSink, payload).catch((err) =>
      log.error(`[newsroom] logging-sink ${loggingSink} failed (non-fatal): ${err.message}`),
    );
  }
  return postSink(fetch, targetSink, payload);
}

/** POST the payload to one sink; throw on unreachable host or non-2xx. */
async function postSink(fetch, url, payload) {
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    throw new Error(`Sink unreachable at ${url}: ${whyFetchFailed(err)}`);
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Sink ${response.status} from ${url}: ${(body.errors ?? [response.statusText]).join("; ")}`);
  }
  return body;
}
