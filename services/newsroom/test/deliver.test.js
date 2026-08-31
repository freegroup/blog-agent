import { test } from "node:test";
import assert from "node:assert/strict";
import { deliver } from "../deliver.js";

/**
 * A channel's target-sink is authoritative; its logging-sink is a best-effort
 * debug copy. These pin the fan-out: the target's response is what comes back,
 * the target's failure propagates, and a logging failure never does.
 */

const PAYLOAD = { slug: "x", title: "T", markdown: "m", images: [] };

// A fake fetch keyed by URL. Each entry is either a response spec or "throws".
function fakeFetch(routes) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const r = routes[url];
    if (r === "throws") throw new Error("ECONNREFUSED");
    return { ok: r.ok ?? true, status: r.status ?? 200, json: async () => r.body ?? {} };
  };
  return { fetch, calls };
}

const quietLog = { error() {} };

test("returns the target sink's body and posts only there when no logging sink", async () => {
  const { fetch, calls } = fakeFetch({ "http://target/publish": { body: { publication_ref: "pr:1", url: "u" } } });
  const result = await deliver({ targetSink: "http://target/publish", loggingSink: null }, PAYLOAD, { fetch, log: quietLog });
  assert.deepEqual(result, { publication_ref: "pr:1", url: "u" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://target/publish");
});

test("writes the logging copy first, then returns the target's body", async () => {
  const { fetch, calls } = fakeFetch({
    "http://log/publish": { body: { publication_ref: "file:x" } },
    "http://target/publish": { body: { publication_ref: "pr:1", url: "u" } },
  });
  const result = await deliver({ targetSink: "http://target/publish", loggingSink: "http://log/publish" }, PAYLOAD, { fetch, log: quietLog });
  assert.deepEqual(result, { publication_ref: "pr:1", url: "u" });
  assert.deepEqual(calls.map((c) => c.url), ["http://log/publish", "http://target/publish"]);
  assert.deepEqual(calls[0].body, calls[1].body, "both sinks get the same payload");
});

test("a failing logging sink is non-fatal — the target still publishes", async () => {
  const errors = [];
  const { fetch } = fakeFetch({
    "http://log/publish": "throws",
    "http://target/publish": { body: { publication_ref: "pr:1", url: "u" } },
  });
  const result = await deliver(
    { targetSink: "http://target/publish", loggingSink: "http://log/publish" },
    PAYLOAD,
    { fetch, log: { error: (m) => errors.push(m) } },
  );
  assert.deepEqual(result, { publication_ref: "pr:1", url: "u" });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /logging-sink .*non-fatal/);
});

test("a failing target sink propagates so the job retries", async () => {
  const { fetch } = fakeFetch({ "http://target/publish": { ok: false, status: 502, body: { errors: ["boom"] } } });
  await assert.rejects(
    () => deliver({ targetSink: "http://target/publish", loggingSink: null }, PAYLOAD, { fetch, log: quietLog }),
    /Sink 502 from http:\/\/target\/publish: boom/,
  );
});

test("an unreachable target sink propagates with a clear message", async () => {
  const { fetch } = fakeFetch({ "http://target/publish": "throws" });
  await assert.rejects(
    () => deliver({ targetSink: "http://target/publish", loggingSink: null }, PAYLOAD, { fetch, log: quietLog }),
    /Sink unreachable at http:\/\/target\/publish/,
  );
});
