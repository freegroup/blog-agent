import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnvelope, validateEnvelope, forwardEnvelope } from "../index.js";

/**
 * A fresh pitch leaves the revision fields empty; a revision fills them with the
 * document read back from the published article and the comment history.
 */

test("makeEnvelope defaults doc to null and review to an empty array", () => {
  const env = makeEnvelope({ source: "telegram", source_ref: "chat:1/msg:2", text: "hi" });
  assert.equal(env.doc, null);
  assert.deepEqual(env.review, []);
  assert.equal(validateEnvelope(env).length, 0);
});

test("makeEnvelope carries a revision's doc and review", () => {
  const env = makeEnvelope({
    source: "github",
    source_ref: "pr:23",
    text: "kürzer bitte",
    revises: "github:o/r#23",
    doc: { slug: "s", plot: "P", image_names: ["foto-1.webp"] },
    review: [{ author: "chef", body: "kürzer", at: "2026-08-30T00:00:00Z" }],
  });
  assert.equal(env.doc.slug, "s");
  assert.equal(env.review[0].author, "chef");
  assert.equal(validateEnvelope(env).length, 0);
});

test("validateEnvelope accepts media without a mime field — the mime lives in the data URI", () => {
  const env = makeEnvelope({
    source: "telegram",
    source_ref: "chat:1",
    text: "",
    media: [{ kind: "image", data: "data:image/jpeg;base64,VVNFUg==", source: "user" }],
  });
  assert.deepEqual(validateEnvelope(env), [], "a self-describing data URI needs no separate mime");
});

test("validateEnvelope rejects a non-object doc and a non-array review", () => {
  const base = makeEnvelope({ source: "github", source_ref: "pr:1", text: "x" });
  assert.match(validateEnvelope({ ...base, doc: "nope" }).join(" "), /doc must be an object/);
  assert.match(validateEnvelope({ ...base, review: "nope" }).join(" "), /review must be an array/);
});

test("forwardEnvelope posts the envelope to the target and returns the assigned id", async () => {
  const env = makeEnvelope({ source: "telegram", source_ref: "chat:1/msg:2", text: "hi" });
  const seen = {};
  const { fetch: real } = globalThis;
  globalThis.fetch = async (url, opts) => {
    seen.url = url;
    seen.body = JSON.parse(opts.body);
    seen.method = opts.method;
    return { ok: true, json: async () => ({ id: "pitch-7" }) };
  };
  try {
    const id = await forwardEnvelope(env, "http://newsroom/pitches");
    assert.equal(id, "pitch-7");
    assert.equal(seen.url, "http://newsroom/pitches");
    assert.equal(seen.method, "POST");
    assert.equal(seen.body.text, "hi");
  } finally {
    globalThis.fetch = real;
  }
});

test("forwardEnvelope throws the newsroom's errors on a non-2xx", async () => {
  const { fetch: real } = globalThis;
  globalThis.fetch = async () => ({ ok: false, statusText: "Bad Request", json: async () => ({ errors: ["text or media must be filled"] }) });
  try {
    await assert.rejects(
      () => forwardEnvelope(makeEnvelope({ source: "telegram", source_ref: "chat:1", text: "x" }), "http://newsroom/pitches"),
      /text or media must be filled/,
    );
  } finally {
    globalThis.fetch = real;
  }
});

test("forwardEnvelope falls back to the status text when the body has no errors", async () => {
  const { fetch: real } = globalThis;
  globalThis.fetch = async () => ({ ok: false, statusText: "Service Unavailable", json: async () => { throw new Error("not json"); } });
  try {
    await assert.rejects(
      () => forwardEnvelope(makeEnvelope({ source: "telegram", source_ref: "chat:1", text: "x" }), "http://newsroom/pitches"),
      /Service Unavailable/,
    );
  } finally {
    globalThis.fetch = real;
  }
});

test("forwardEnvelope refuses a malformed envelope and never touches the network", async () => {
  const { fetch: real } = globalThis;
  let called = false;
  globalThis.fetch = async () => { called = true; return { ok: true, json: async () => ({}) }; };
  try {
    // No text and no media — validateEnvelope rejects it; the POST must not happen.
    const bad = makeEnvelope({ source: "telegram", source_ref: "chat:1", text: "" });
    await assert.rejects(() => forwardEnvelope(bad, "http://newsroom/pitches"), /text or media must be filled/);
    assert.equal(called, false, "fetch must not be called for an invalid envelope");
  } finally {
    globalThis.fetch = real;
  }
});
