/**
 * The reason behind a bare `TypeError: fetch failed`.
 *
 * Node hides it in `cause`, and for a hostname like `localhost` — which resolves
 * to both ::1 and 127.0.0.1 — `cause` is an AggregateError whose own message is
 * the empty string. Reading only `cause.message` therefore yields nothing at all
 * in exactly the most common local setup, which is how a stopped Ollama once
 * showed up as "fetch failed:" with nothing after the colon.
 *
 * Lives in shared/ because three unrelated callers need it — the LLM adapter,
 * the STT adapter and the newsroom's sink call — and copies of this would drift.
 */
export function whyFetchFailed(err) {
  const cause = err?.cause;
  return (
    cause?.errors?.map((e) => e.message).filter(Boolean).join("; ") ||
    cause?.message ||
    cause?.code ||
    err?.message ||
    "unknown reason"
  );
}

/**
 * Statuses that mean "not your fault, come back later": request timeout, rate
 * limit, and the 5xx family a busy upstream returns (Gemini's pro models answer
 * 503 "high demand" under load). A 4xx other than 408/429 is a real client error
 * and is never retried.
 */
const TRANSIENT_STATUS = new Set([408, 429, 500, 502, 503, 504]);

const isAbort = (err) => err?.name === "AbortError" || err?.name === "TimeoutError";

/**
 * `fetch` with automatic retry on transient failures — the normal case for any
 * external API call. A dropped connection, a per-attempt timeout, or a transient
 * status waits with exponential backoff and tries again; anything else (a 4xx, or
 * a status still transient after the last attempt) is returned/thrown for the
 * caller to handle exactly as it would a plain `fetch`. Drop-in: same arguments,
 * same return.
 *
 * The timeout is the important half: Node's `fetch` never gives up on its own on
 * a connection that stays open but never answers, so a hung upstream would wedge
 * a pipeline stage indefinitely. Each attempt gets a fresh `AbortSignal.timeout`;
 * an abort is treated as a network error and retried like any other.
 *
 * `sleep` is injectable so tests do not actually wait.
 *
 * @param {string} url
 * @param {RequestInit} [init]
 * @param {{retries?:number, backoffMs?:number, timeoutMs?:number, sleep?:(ms:number)=>Promise<void>, label?:string}} [opts]
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, init = {}, opts = {}) {
  const { retries = 2, backoffMs = 1000, timeoutMs = 120000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), label } = opts;
  const name = label ?? url;

  for (let attempt = 0; ; attempt++) {
    let response;
    let netErr;
    // A fresh signal per attempt — AbortSignal.timeout fires once. Respect a
    // signal the caller already set instead of overriding it.
    const signal = init.signal ?? (timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined);
    try {
      response = await fetch(url, signal ? { ...init, signal } : init);
    } catch (err) {
      netErr = isAbort(err) ? new Error(`timed out after ${timeoutMs} ms`) : err;
    }

    const transient = netErr != null || TRANSIENT_STATUS.has(response.status);
    if (!transient || attempt >= retries) {
      if (netErr) throw netErr; // exhausted retries on a network error / timeout — surface it
      return response; // success, or a status the caller must decide about
    }

    // Free the socket before retrying; the body is unread and would otherwise leak.
    if (response) await response.body?.cancel?.().catch(() => {});
    const wait = backoffMs * 2 ** attempt;
    const why = netErr ? whyFetchFailed(netErr) : `HTTP ${response.status}`;
    console.error(`[http] ${name}: ${why} — retry in ${wait / 1000}s (attempt ${attempt + 2}/${retries + 1})`);
    await sleep(wait);
  }
}
