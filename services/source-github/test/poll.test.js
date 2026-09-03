import { test } from "node:test";
import assert from "node:assert/strict";
import { decide } from "../poll.js";

// The two standard texts the bot itself posts. decide() must recognize them so it
// never acts on its own comments — the loop-avoidance the return channel relies on.
// The real wording lives in settings.yaml; these are neutral stand-ins, since decide
// only matches on the text as a prefix.
const ACK = "[[ack]]";
const REJECT = "[[reject]]";
const OWNER = "freegroup";

/** A comment at minute `m` (chronological order, as GitHub returns them). */
const c = (login, body, m) => ({ user: { login }, body, created_at: `2026-09-03T10:${String(m).padStart(2, "0")}:00Z` });
const commitAt = (m) => ({ commit: { author: { date: `2026-09-03T10:${String(m).padStart(2, "0")}:00Z` } } });
const base = { now: Date.parse("2026-09-03T10:05:00Z"), ackText: ACK, rejectText: REJECT, owner: OWNER, staleMs: 15 * 60_000 };

test("no comments → nothing", () => {
  assert.equal(decide({ ...base, comments: [], commits: [] }).action, "nothing");
});

test("an owner comment is handed off", () => {
  const d = decide({ ...base, comments: [c(OWNER, "bitte in Serie rechnen", 1)], commits: [] });
  assert.equal(d.action, "handoff");
  assert.equal(d.comments.length, 1);
});

test("a foreign comment is rejected, not forwarded", () => {
  const d = decide({ ...base, comments: [c("finally-fancy", "toller artikel!", 1)], commits: [] });
  assert.equal(d.action, "reject");
  assert.equal(d.comments.length, 1);
});

test("the bot never answers its own reject notice (no loop)", () => {
  const comments = [c("finally-fancy", "fremd", 1), c(OWNER, REJECT, 2)];
  // The reject notice is authored by the owner login but recognized by its text:
  // excluded from the owner-review set AND from the foreign set.
  assert.equal(decide({ ...base, comments, commits: [] }).action, "nothing");
});

test("a fresh foreign comment after our notice is rejected again, once", () => {
  const comments = [c("finally-fancy", "fremd 1", 1), c(OWNER, REJECT, 2), c("someone", "fremd 2", 3)];
  const d = decide({ ...base, comments, commits: [] });
  assert.equal(d.action, "reject");
  assert.deepEqual(
    d.comments.map((x) => x.body),
    ["fremd 2"],
    "only the comment newer than the last reject notice",
  );
});

test("a pending owner review wins over a foreign comment", () => {
  const comments = [c("finally-fancy", "fremd", 1), c(OWNER, "bitte ändern", 2)];
  assert.equal(decide({ ...base, comments, commits: [] }).action, "handoff");
});

test("an un-answered foreign comment is rejected on the poll after a handoff+ack", () => {
  const comments = [c("finally-fancy", "fremd", 1), c(OWNER, "review", 2), c(OWNER, ACK, 3)];
  const d = decide({ ...base, comments, commits: [] });
  assert.equal(d.action, "reject", "the owner review is already handed off; the outsider still gets a reply");
  assert.deepEqual(d.comments.map((x) => x.body), ["fremd"]);
});

test("the ack itself is not re-forwarded as an owner review", () => {
  const comments = [c(OWNER, "review", 1), c(OWNER, ACK, 2)];
  // Not stale yet, no foreign comments → nothing to do.
  assert.equal(decide({ ...base, now: Date.parse("2026-09-03T10:02:30Z"), comments, commits: [] }).action, "nothing");
});

test("retry when handed off and the newsroom went quiet past the stale window", () => {
  const comments = [c(OWNER, "review", 1), c(OWNER, ACK, 2)];
  const now = Date.parse("2026-09-03T10:02:00Z") + 15 * 60_000 + 1000;
  const d = decide({ ...base, now, comments, commits: [] });
  assert.equal(d.action, "retry");
  assert.equal(d.since, "2026-09-03T10:02:00Z");
});

test("no retry while a commit landed after the ack — the newsroom is working", () => {
  const comments = [c(OWNER, "review", 1), c(OWNER, ACK, 2)];
  const now = Date.parse("2026-09-03T10:02:00Z") + 15 * 60_000 + 1000;
  assert.equal(decide({ ...base, now, comments, commits: [commitAt(3)] }).action, "nothing");
});

test("without a reject text, a foreign comment is simply ignored (no crash, no reply)", () => {
  const d = decide({ ...base, rejectText: undefined, comments: [c("finally-fancy", "fremd", 1)], commits: [] });
  assert.equal(d.action, "nothing");
});
