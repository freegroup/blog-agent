import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeStore } from "../store.js";

function fresh() {
  const dir = mkdtempSync(path.join(tmpdir(), "chat-"));
  return { store: makeStore(path.join(dir, "history.jsonl")), cleanup: () => rmSync(dir, { recursive: true }) };
}

test("append stamps a ts and recent reads it back oldest-first", () => {
  const { store, cleanup } = fresh();
  store.append({ direction: "in", author: "user", text: "hallo" });
  store.append({ direction: "out", author: "watch-rss", text: "live", meta: { kind: "blog-live", url: "u" } });

  const all = store.recent(50);
  assert.equal(all.length, 2);
  assert.equal(all[0].text, "hallo");
  assert.ok(all[0].ts, "a timestamp was added");
  assert.equal(all[1].meta.kind, "blog-live", "structured meta round-trips");
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
