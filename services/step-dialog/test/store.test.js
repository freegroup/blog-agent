import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, utimesSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { stringify } from "yaml";
import {
  chatIdOf,
  park,
  discard,
  pendingForChat,
  read,
  lastPublished,
  titleOf,
  describePosting,
} from "../store.js";

const freshDir = () => mkdtempSync(path.join(tmpdir(), "step-dialog-store-"));

const envelope = (id, chat, text = "hallo") => ({
  id,
  source: "telegram",
  source_ref: `chat:${chat}/msg:1`,
  received_at: new Date().toISOString(),
  text,
  media: [],
});

/** Write a published pitch straight to disk, then stamp its mtime so "newest" is deterministic. */
function writePublished(dir, id, { title, url, mtime }) {
  const pitch = {
    id,
    envelope: envelope(id, "1", `pitch ${id}`),
    jobs: [{ briefing: "camper-blog", state: "done", doc: title ? { title } : undefined, url }],
    status: "published",
    created_at: new Date().toISOString(),
  };
  const file = path.join(dir, `${id}.yaml`);
  writeFileSync(file, stringify(pitch));
  if (mtime) utimesSync(file, mtime, mtime);
}

test("chatIdOf reads the chat from source_ref, null when absent", () => {
  assert.equal(chatIdOf({ source_ref: "chat:42/msg:7" }), "42");
  assert.equal(chatIdOf({ source_ref: "reactivate:abc" }), null);
  assert.equal(chatIdOf({}), null);
});

test("park writes an awaiting-reply entry with no jobs, found again by chat", () => {
  const dir = freshDir();
  park(dir, envelope("e1", "99"), "Schick mir den Link?");

  const found = pendingForChat(dir, "99");
  assert.equal(found.id, "e1");
  assert.equal(found.status, "awaiting-reply");
  assert.equal(found.question, "Schick mir den Link?");
  assert.equal(found.jobs, undefined, "a clarification carries no jobs — the newsroom ignores it");
  assert.equal(pendingForChat(dir, "other"), null, "correlation is by chat id");
});

test("park carries a reactivation marker for a repost confirmation", () => {
  const dir = freshDir();
  park(dir, envelope("e2", "5"), "Meinst du „X“?", { reactivation: { source_id: "p1", target: "Blog" } });
  const found = pendingForChat(dir, "5");
  assert.deepEqual(found.reactivation, { source_id: "p1", target: "Blog" });
});

test("discard removes a parked entry; read fetches one by id", () => {
  const dir = freshDir();
  park(dir, envelope("e3", "5"), "frage?");
  assert.equal(read(dir, "e3").id, "e3");
  discard(dir, "e3");
  assert.equal(read(dir, "e3"), null);
  assert.equal(existsSync(path.join(dir, "e3.yaml")), false);
  discard(dir, "e3"); // idempotent — no throw when already gone
});

test("lastPublished returns the newest published pitch, ignoring awaiting-reply", () => {
  const dir = freshDir();
  writePublished(dir, "old", { title: "Alt", url: "http://a", mtime: new Date("2026-01-01") });
  writePublished(dir, "new", { title: "Neu", url: "http://b", mtime: new Date("2026-02-01") });
  park(dir, envelope("open", "1"), "frage?"); // must be skipped

  const last = lastPublished(dir);
  assert.equal(last.id, "new");
});

test("lastPublished is null when nothing is published", () => {
  const dir = freshDir();
  park(dir, envelope("open", "1"), "frage?");
  assert.equal(lastPublished(dir), null);
});

test("titleOf and describePosting read the finished doc", () => {
  const pitch = {
    id: "p",
    envelope: envelope("p", "1"),
    jobs: [{ doc: { title: "Lüsterklemmen" }, url: "http://x" }],
  };
  assert.equal(titleOf(pitch), "Lüsterklemmen");
  assert.equal(describePosting(pitch), 'Das letzte Posting war „Lüsterklemmen“: http://x');

  const noUrl = { jobs: [{ doc: { title: "Ohne Link" } }] };
  assert.equal(describePosting(noUrl), 'Das letzte Posting war „Ohne Link“.');

  const noTitle = { envelope: { text: "irgendein request" }, jobs: [] };
  assert.equal(titleOf(noTitle), "irgendein request");
});
