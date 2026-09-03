import { test } from "node:test";
import assert from "node:assert/strict";
import { runFilters } from "../pipeline.js";
import { referenceRepost } from "../filters/reference-repost.js";
import { referenceShow } from "../filters/reference-show.js";
import { ACK, USER_REQUEST, DECLINE, ANSWER, REACTIVATE } from "../filters/verdict.js";

/** A fake llm whose one tool call echoes `input` back under whatever tool was asked. */
const llmReturning = (input) => ({
  complete: async ({ tools }) => ({ toolCalls: [{ name: tools[0].name, input }] }),
});
/** A fake llm that makes no tool call at all. */
const silentLlm = { complete: async () => ({ toolCalls: [] }) };

const pitch = (id, title, url) => ({
  id,
  envelope: { id, text: `Beitrag ${id}`, media: [{ kind: "image", mime: "image/jpeg", data: "AAA" }] },
  jobs: [{ doc: { title }, url }],
});

// ── reference-show ────────────────────────────────────────────────────────────

test("reference-show answers with the last posting when asked to see it", async () => {
  const last = pitch("p1", "Lüsterklemmen", "http://x");
  const store = { lastPublished: () => last, describePosting: () => "DAS LETZTE: Lüsterklemmen" };
  const v = await referenceShow({ envelope: { text: "zeig mir das letzte posting" }, llm: llmReturning({ show: true }), store, queueDir: "/x" });
  assert.equal(v.type, ANSWER);
  assert.equal(v.response, "DAS LETZTE: Lüsterklemmen");
});

test("reference-show acks anything that is not a show request", async () => {
  const v = await referenceShow({ envelope: { text: "schreib was über Solar" }, llm: llmReturning({ show: false }), store: {}, queueDir: "/x" });
  assert.equal(v.type, ACK);
});

test("reference-show reports when there is no posting to show", async () => {
  const store = { lastPublished: () => null, describePosting: () => "" };
  const v = await referenceShow({ envelope: { text: "zeig mir das letzte" }, llm: llmReturning({ show: true }), store, queueDir: "/x" });
  assert.equal(v.type, ANSWER);
  assert.match(v.response, /kein früheres Posting/);
});

// ── reference-repost, turn 1 (fresh request) ───────────────────────────────────

test("reference-repost asks to confirm and carries the reactivation marker", async () => {
  const last = pitch("p1", "Lüsterklemmen", "http://x");
  const store = { lastPublished: () => last, read: () => null };
  const v = await referenceRepost({ envelope: { text: "poste das letzte noch mal auf den Blog" }, llm: llmReturning({ repost: true, target: "Blog" }), store, queueDir: "/x" });
  assert.equal(v.type, USER_REQUEST);
  assert.match(v.response, /Lüsterklemmen/);
  assert.match(v.response, /Blog/);
  assert.deepEqual(v.reactivation, { source_id: "p1", target: "Blog" });
});

test("reference-repost asks for the channel when none was named", async () => {
  const store = { lastPublished: () => pitch("p1", "T", "u"), read: () => null };
  const v = await referenceRepost({ envelope: { text: "poste das letzte noch mal" }, llm: llmReturning({ repost: true, target: null }), store, queueDir: "/x" });
  assert.equal(v.type, ANSWER);
  assert.match(v.response, /wohin/);
});

test("reference-repost acks a request that is not a repost", async () => {
  const v = await referenceRepost({ envelope: { text: "was gibt es neues?" }, llm: llmReturning({ repost: false }), store: {}, queueDir: "/x" });
  assert.equal(v.type, ACK);
});

// ── reference-repost, turn 2 (confirmation reply) ──────────────────────────────

test("reference-repost reactivates a fresh pitch on yes", async () => {
  const source = pitch("p1", "Lüsterklemmen", "http://x");
  const store = { lastPublished: () => null, read: () => source };
  const pending = { question: "Meinst du „Lüsterklemmen“?", reactivation: { source_id: "p1", target: "Blog" } };
  const v = await referenceRepost({ envelope: { text: "ja bitte" }, pending, llm: llmReturning({ answer: "yes" }), store, queueDir: "/x" });
  assert.equal(v.type, REACTIVATE);
  assert.notEqual(v.envelope.id, "p1", "a repost is a new pitch, not the old id");
  assert.equal(v.envelope.doc, null, "rebuilt channel-native, the old doc is not reused");
  assert.match(v.envelope.text, /Blog/);
  assert.match(v.envelope.text, /Beitrag p1/, "carries the original request text");
  assert.deepEqual(v.envelope.media, source.envelope.media, "carries the original image");
});

test("reference-repost drops the repost on no", async () => {
  const pending = { question: "Meinst du …?", reactivation: { source_id: "p1", target: "Blog" } };
  const v = await referenceRepost({ envelope: { text: "nee lass mal" }, pending, llm: llmReturning({ answer: "no" }), store: {}, queueDir: "/x" });
  assert.equal(v.type, ANSWER);
});

test("reference-repost treats a non-answer during confirmation as a fresh request (ack)", async () => {
  const pending = { question: "Meinst du …?", reactivation: { source_id: "p1", target: "Blog" } };
  const v = await referenceRepost({ envelope: { text: "wie spät ist es?" }, pending, llm: llmReturning({ answer: "other" }), store: {}, queueDir: "/x" });
  assert.equal(v.type, ACK);
});

test("reference-repost reports a vanished posting on yes", async () => {
  const store = { read: () => null };
  const pending = { question: "Meinst du …?", reactivation: { source_id: "gone", target: "Blog" } };
  const v = await referenceRepost({ envelope: { text: "ja" }, pending, llm: llmReturning({ answer: "yes" }), store, queueDir: "/x" });
  assert.equal(v.type, ANSWER);
  assert.match(v.response, /finde ich nicht mehr/);
});

// ── aggregation (runFilters) ───────────────────────────────────────────────────

const verdictFilter = (v) => async () => v;
const noMerge = async (list) => `MERGED(${list.join(" | ")})`;

test("runFilters: DECLINE wins over everything", async () => {
  const r = await runFilters(
    { envelope: {}, llm: silentLlm },
    {
      filters: [verdictFilter({ type: DECLINE, response: "verstößt" }), verdictFilter({ type: ANSWER, response: "egal" })],
      mergeSentences: noMerge,
    },
  );
  assert.equal(r.decision, "decline");
  assert.equal(r.message, "verstößt");
});

test("runFilters: a REACTIVATE forwards the built envelope", async () => {
  const env = { id: "new", text: "x" };
  const r = await runFilters(
    { envelope: {}, llm: silentLlm },
    { filters: [verdictFilter({ type: REACTIVATE, envelope: env }), verdictFilter({ type: ACK, response: null })] },
  );
  assert.equal(r.decision, "reactivate");
  assert.equal(r.envelope, env);
});

test("runFilters: a single USER-REQUEST passes through verbatim, with its reactivation", async () => {
  const r = await runFilters(
    { envelope: {}, llm: silentLlm },
    {
      filters: [verdictFilter({ type: USER_REQUEST, response: "Meinst du X?", reactivation: { source_id: "p1", target: "Blog" } })],
      mergeSentences: noMerge,
    },
  );
  assert.equal(r.decision, "ask");
  assert.equal(r.message, "Meinst du X?", "one message is not run through the merger");
  assert.deepEqual(r.reactivation, { source_id: "p1", target: "Blog" });
});

test("runFilters: several outgoing messages of one kind are merged into one", async () => {
  const r = await runFilters(
    { envelope: {}, llm: silentLlm },
    {
      filters: [verdictFilter({ type: ANSWER, response: "eins" }), verdictFilter({ type: ANSWER, response: "zwei" })],
      mergeSentences: noMerge,
    },
  );
  assert.equal(r.decision, "answer");
  assert.equal(r.message, "MERGED(eins | zwei)");
});

test("runFilters: all ACK → forward", async () => {
  const r = await runFilters(
    { envelope: {}, llm: silentLlm },
    { filters: [verdictFilter({ type: ACK, response: null }), verdictFilter({ type: ACK, response: null })] },
  );
  assert.equal(r.decision, "forward");
});

test("runFilters: a throwing filter counts as ACK, never hangs the request", async () => {
  const boom = () => {
    throw new Error("model down");
  };
  const r = await runFilters({ envelope: {}, llm: silentLlm }, { filters: [boom, verdictFilter({ type: ACK, response: null })] });
  assert.equal(r.decision, "forward");
});
