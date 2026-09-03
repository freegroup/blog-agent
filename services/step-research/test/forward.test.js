import { test } from "node:test";
import assert from "node:assert/strict";
import { deliver } from "../handler.js";

/**
 * Install a fake `globalThis.fetch` — the global that `fetchWithRetry` calls —
 * that records the request and returns a canned response. Restored via `t.after`.
 * A `202`/`400` is not transient, so fetchWithRetry passes it straight through.
 */
function stubFetch(t, status, body) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return { status, json: async () => body };
  };
  t.after(() => {
    globalThis.fetch = real;
  });
  return calls;
}

test("deliver forwards the envelope to the next hop and mirrors its answer", async (t) => {
  const calls = stubFetch(t, 202, { id: "abc" });
  const envelope = { id: "abc", text: "hallo", context: { target_url: null, reference_urls: [] } };

  const { status, body } = await deliver("http://127.0.0.1:5080/pitches", envelope);

  assert.equal(status, 202);
  assert.deepEqual(body, { id: "abc" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://127.0.0.1:5080/pitches");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), envelope, "the enriched envelope is forwarded verbatim");
});

test("deliver mirrors a downstream rejection rather than swallowing it", async (t) => {
  stubFetch(t, 400, { errors: ["text or media must be filled"] });
  const { status, body } = await deliver("http://127.0.0.1:5080/pitches", { id: "x" });
  assert.equal(status, 400);
  assert.deepEqual(body.errors, ["text or media must be filled"]);
});
