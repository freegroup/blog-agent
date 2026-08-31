import { test } from "node:test";
import assert from "node:assert/strict";
import { deliver } from "../index.js";

/** A fake fetch that records the request and returns a canned response. */
function fakeFetch(status, body) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return { status, json: async () => body };
  };
  return { fetch, calls };
}

test("deliver forwards the envelope to the next hop and mirrors its answer", async () => {
  const { fetch, calls } = fakeFetch(202, { id: "abc" });
  const envelope = { id: "abc", text: "hallo", context: { target_url: null, reference_urls: [] } };

  const { status, body } = await deliver("http://127.0.0.1:5080/pitches", envelope, { fetch });

  assert.equal(status, 202);
  assert.deepEqual(body, { id: "abc" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://127.0.0.1:5080/pitches");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), envelope, "the enriched envelope is forwarded verbatim");
});

test("deliver mirrors a downstream rejection rather than swallowing it", async () => {
  const { fetch } = fakeFetch(400, { errors: ["text or media must be filled"] });
  const { status, body } = await deliver("http://127.0.0.1:5080/pitches", { id: "x" }, { fetch });
  assert.equal(status, 400);
  assert.deepEqual(body.errors, ["text or media must be filled"]);
});
