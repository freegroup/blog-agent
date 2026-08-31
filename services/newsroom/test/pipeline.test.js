import { test } from "node:test";
import assert from "node:assert/strict";
import { Stage, runPipeline } from "../pipeline/index.js";

/**
 * The pipeline contract itself: each stage sees its predecessor's result and
 * nothing else. These tests use throwaway stages rather than the real ones —
 * the point is the wiring, not what any particular step writes.
 */

class Append extends Stage {
  constructor(name, key) {
    super(name);
    this.key = key;
    this.saw = [];
  }
  async run(doc) {
    this.saw.push(doc);
    return { ...doc, [this.key]: `${this.key}-from(${Object.keys(doc).join(",")})` };
  }
}

const ctx = { contextFor: () => ({ briefing: { prompt: "x" } }), briefing: { prompt: "x" } };

test("each stage receives what the previous one returned", async () => {
  const a = new Append("a", "alpha");
  const b = new Append("b", "beta");

  const out = await runPipeline([a, b], { text: "pitch" }, ctx);

  assert.deepEqual(Object.keys(a.saw[0]), ["text"], "first stage sees only the initial document");
  assert.ok(b.saw[0].alpha, "second stage sees the first stage's output");
  assert.equal(out.beta, "beta-from(text,alpha)");
});

test("a stage cannot reach the ones after it", async () => {
  const a = new Append("a", "alpha");
  const b = new Append("b", "beta");
  await runPipeline([a, b], { text: "pitch" }, ctx);
  assert.equal(a.saw[0].beta, undefined);
});

test("order comes from the list, not from the stages", async () => {
  const mk = () => [new Append("a", "alpha"), new Append("b", "beta")];
  const [a1, b1] = mk();
  const forward = await runPipeline([a1, b1], { text: "p" }, ctx);
  const [a2, b2] = mk();
  const backward = await runPipeline([b2, a2], { text: "p" }, ctx);

  assert.match(forward.beta, /alpha/, "beta built on alpha");
  assert.doesNotMatch(backward.beta, /alpha/, "reversed, beta ran first and saw no alpha");
});

test("a stage may replace a field its predecessor wrote", async () => {
  class Translate extends Stage {
    constructor() {
      super("translate");
    }
    async run(doc) {
      return { ...doc, markdown: doc.markdown.toUpperCase() };
    }
  }
  const out = await runPipeline([new Translate()], { markdown: "hallo" }, ctx);
  assert.equal(out.markdown, "HALLO");
});

test("hands the whole document to onSave after each stage, not a diff", async () => {
  const seen = [];
  await runPipeline([new Append("a", "alpha"), new Append("b", "beta")], { text: "p" }, {
    ...ctx,
    onSave: (name, doc) => seen.push([name, Object.keys(doc)]),
  });
  assert.deepEqual(seen, [
    ["a", ["text", "alpha"]],
    ["b", ["text", "alpha", "beta"]],
  ]);
});

test("resumeAfter continues past the named stage, on the document given", async () => {
  const a = new Append("a", "alpha");
  const b = new Append("b", "beta");
  // 'a' already ran on an earlier process; we hand back its stored result.
  const out = await runPipeline([a, b], { text: "p", alpha: "kept" }, { ...ctx, resumeAfter: "a" });

  assert.equal(a.saw.length, 0, "the finished stage is not run again");
  assert.equal(out.alpha, "kept", "its earlier output is carried through untouched");
  assert.ok(out.beta, "the remaining stage runs");
});

test("an unknown resumeAfter re-runs everything rather than skipping it", async () => {
  const a = new Append("a", "alpha");
  const out = await runPipeline([a], { text: "p" }, { ...ctx, resumeAfter: "gone" });
  assert.equal(a.saw.length, 1, "reordering the pipeline must not silently drop a stage");
  assert.ok(out.alpha);
});

test("a failing stage stops the run", async () => {
  class Boom extends Stage {
    constructor() {
      super("boom");
    }
    async run() {
      throw new Error("nope");
    }
  }
  const after = new Append("after", "never");
  await assert.rejects(runPipeline([new Boom(), after], { text: "p" }, ctx), /nope/);
  assert.equal(after.saw.length, 0, "later stages do not run");
});

test("the base class refuses to be used unimplemented", async () => {
  await assert.rejects(new Stage("bare").run({}, {}), /run\(\) not implemented/);
});
