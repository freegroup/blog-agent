import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeStore } from "../store.js";

function fresh(maxContext = 50) {
  const dir = mkdtempSync(path.join(tmpdir(), "chat-history-"));
  return { dir, store: makeStore(dir, maxContext), cleanup: () => rmSync(dir, { recursive: true }) };
}

test("append stamps ts and recent reads it back oldest-first", () => {
  const { store, cleanup } = fresh();
  store.append({ direction: "in", author: "user", text: "hallo" });
  store.append({ direction: "out", author: "watch-rss", text: "live", meta: { kind: "blog-live", url: "u" } });

  const all = store.recent(50);
  assert.equal(all.length, 2);
  assert.equal(all[0].text, "hallo");
  assert.ok(all[0].ts, "a timestamp was added");
  assert.equal(all[1].meta.kind, "blog-live");
  cleanup();
});

test("recent bounds to the last n", () => {
  const { store, cleanup } = fresh();
  for (let i = 0; i < 5; i++) store.append({ direction: "in", text: `m${i}` });
  assert.deepEqual(store.recent(2).map((e) => e.text), ["m3", "m4"]);
  cleanup();
});

test("recent is empty and never throws before anything is written", () => {
  const { store, cleanup } = fresh();
  assert.deepEqual(store.recent(10), []);
  cleanup();
});

test("buffer is pruned to maxContext — older entries stay only in the daily log", () => {
  const { dir, store, cleanup } = fresh(3);
  for (let i = 0; i < 5; i++) store.append({ direction: "in", text: `m${i}` });

  // In-memory / current.jsonl: only last 3
  assert.deepEqual(store.recent(10).map((e) => e.text), ["m2", "m3", "m4"]);

  // Daily file has all 5
  const today = new Date().toISOString().slice(0, 10) + ".jsonl";
  const lines = readFileSync(path.join(dir, today), "utf8").trim().split("\n");
  assert.equal(lines.length, 5);

  cleanup();
});

test("current.jsonl is rewritten on every append", () => {
  const { dir, store, cleanup } = fresh(5);
  store.append({ text: "a" });
  store.append({ text: "b" });

  const lines = readFileSync(path.join(dir, "current.jsonl"), "utf8").trim().split("\n");
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[1]).text, "b");
  cleanup();
});

test("a restart seeds the buffer from current.jsonl", () => {
  const { dir, store, cleanup } = fresh(10);
  store.append({ text: "first" });
  store.append({ text: "second" });

  // New store instance over the same dir — simulates a restart.
  const store2 = makeStore(dir, 10);
  const entries = store2.recent(10);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].text, "first");
  assert.equal(entries[1].text, "second");
  cleanup();
});

test("daily files are named YYYY-MM-DD.jsonl", () => {
  const { dir, store, cleanup } = fresh();
  store.append({ text: "x" });

  const today = new Date().toISOString().slice(0, 10) + ".jsonl";
  assert.ok(existsSync(path.join(dir, today)));
  cleanup();
});
