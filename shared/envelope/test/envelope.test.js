import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnvelope, validateEnvelope } from "../index.js";

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

test("validateEnvelope rejects a non-object doc and a non-array review", () => {
  const base = makeEnvelope({ source: "github", source_ref: "pr:1", text: "x" });
  assert.match(validateEnvelope({ ...base, doc: "nope" }).join(" "), /doc must be an object/);
  assert.match(validateEnvelope({ ...base, review: "nope" }).join(" "), /review must be an array/);
});
