import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchWithRetry } from "../index.js";

/**
 * fetchWithRetry is the house policy for external calls: transient failures
 * (dropped connection, 429, 5xx) are retried with backoff; a real 4xx is not,
 * and a still-transient status after the last attempt is handed back unchanged.
 * `sleep` is injected so these run instantly.
 */

const noSleep = async () => {};

// A fetch stub that yields the given outcomes in order. Each is a status number
// (→ a Response), "throw" (→ a network error), or "timeout" (→ an abort, as
// AbortSignal.timeout raises when an attempt runs too long).
function stubFetch(outcomes) {
  let i = 0;
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    const o = outcomes[Math.min(i++, outcomes.length - 1)];
    if (o === "throw") throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
    if (o === "timeout") throw Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" });
    return new Response(o === 200 ? "ok" : "err", { status: o });
  };
  return { fetch, calls };
}

function withFetch(fake, fn) {
  const { fetch: real } = globalThis;
  globalThis.fetch = fake;
  return Promise.resolve(fn()).finally(() => {
    globalThis.fetch = real;
  });
}

test("returns immediately on success without retrying", async () => {
  const { fetch, calls } = stubFetch([200]);
  const res = await withFetch(fetch, () => fetchWithRetry("http://x", {}, { sleep: noSleep }));
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
});

test("retries a transient 503 and then succeeds", async () => {
  const { fetch, calls } = stubFetch([503, 503, 200]);
  const res = await withFetch(fetch, () => fetchWithRetry("http://x", {}, { retries: 2, sleep: noSleep }));
  assert.equal(res.status, 200);
  assert.equal(calls.length, 3, "two failures then a success");
});

test("does not retry a 4xx — a client error is final", async () => {
  const { fetch, calls } = stubFetch([400, 200]);
  const res = await withFetch(fetch, () => fetchWithRetry("http://x", {}, { retries: 3, sleep: noSleep }));
  assert.equal(res.status, 400);
  assert.equal(calls.length, 1, "no retry on 400");
});

test("gives up after the retry budget and returns the last transient response", async () => {
  const { fetch, calls } = stubFetch([503, 503, 503, 503]);
  const res = await withFetch(fetch, () => fetchWithRetry("http://x", {}, { retries: 2, sleep: noSleep }));
  assert.equal(res.status, 503, "the final bad response is handed back for the caller to throw on");
  assert.equal(calls.length, 3, "1 + 2 retries");
});

test("retries a network error and rethrows it once the budget is spent", async () => {
  const { fetch, calls } = stubFetch(["throw"]);
  await withFetch(fetch, () =>
    assert.rejects(() => fetchWithRetry("http://x", {}, { retries: 2, sleep: noSleep }), /fetch failed/),
  );
  assert.equal(calls.length, 3, "1 + 2 retries before giving up");
});

test("a network error that recovers returns the eventual response", async () => {
  const { fetch, calls } = stubFetch(["throw", 200]);
  const res = await withFetch(fetch, () => fetchWithRetry("http://x", {}, { retries: 2, sleep: noSleep }));
  assert.equal(res.status, 200);
  assert.equal(calls.length, 2);
});

test("a hung request that times out is retried, then recovers", async () => {
  const { fetch, calls } = stubFetch(["timeout", 200]);
  const res = await withFetch(fetch, () => fetchWithRetry("http://x", {}, { retries: 2, timeoutMs: 50, sleep: noSleep }));
  assert.equal(res.status, 200);
  assert.equal(calls.length, 2, "the timeout was retried");
});

test("a persistent timeout is surfaced as a legible 'timed out' error", async () => {
  const { fetch, calls } = stubFetch(["timeout"]);
  await withFetch(fetch, () =>
    assert.rejects(() => fetchWithRetry("http://x", {}, { retries: 1, timeoutMs: 50, sleep: noSleep }), /timed out after 50 ms/),
  );
  assert.equal(calls.length, 2, "1 + 1 retry before giving up");
});
