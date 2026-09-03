import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, utimesSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Queue } from "../queue.js";

function fresh() {
  const dir = mkdtempSync(path.join(tmpdir(), "queue-"));
  return { dir, queue: new Queue(dir, { maxAttempts: 3 }), cleanup: () => rmSync(dir, { recursive: true }) };
}

const ENVELOPE = { id: "01J-test", text: "not like this", media: [] };

test("writes before enqueuing — pitch is on disk immediately", () => {
  const { dir, queue, cleanup } = fresh();
  queue.accept(ENVELOPE, ["blog"]);
  assert.ok(existsSync(path.join(dir, "01J-test.yaml")));
  cleanup();
});

test("creates one job per briefing", () => {
  const { queue, cleanup } = fresh();
  const pitch = queue.accept(ENVELOPE, ["blog", "pinterest"]);
  assert.deepEqual(pitch.jobs.map((j) => j.briefing), ["blog", "pinterest"]);
  cleanup();
});

test("processes jobs in order", () => {
  const { queue, cleanup } = fresh();
  queue.accept(ENVELOPE, ["blog", "pinterest"]);

  assert.equal(queue.next().job.briefing, "blog");
  queue.done("01J-test", "blog", { ref: "github:a/b#1", url: "u" });
  assert.equal(queue.next().job.briefing, "pinterest");
  queue.done("01J-test", "pinterest", { ref: "github:a/b#2", url: "u" });
  assert.equal(queue.next(), null);
  cleanup();
});

test("restores open pitches after restart", () => {
  const { dir, queue, cleanup } = fresh();
  queue.accept(ENVELOPE, ["blog"]);

  const restored = new Queue(dir);
  assert.equal(restored.restore(), 1);
  assert.equal(restored.next().job.briefing, "blog");
  cleanup();
});

test("does not restore finished pitches on restart", () => {
  const { dir, queue, cleanup } = fresh();
  queue.accept(ENVELOPE, ["blog"]);
  queue.done("01J-test", "blog", { ref: "r", url: "u" });

  assert.equal(new Queue(dir).restore(), 0);
  cleanup();
});

test("gives up after max_attempts rather than burning tokens", () => {
  const { queue, cleanup } = fresh();
  queue.accept(ENVELOPE, ["blog"]);

  assert.equal(queue.fail("01J-test", "blog", "boom"), false);
  assert.equal(queue.fail("01J-test", "blog", "boom"), false);
  assert.equal(queue.fail("01J-test", "blog", "boom"), true);
  assert.equal(queue.next(), null);
  cleanup();
});

test("does not delete before fetching", () => {
  const { dir, queue, cleanup } = fresh();
  queue.accept(ENVELOPE, ["blog"]);
  queue.done("01J-test", "blog", { ref: "r", url: "u" });

  assert.equal(queue.cleanup(24), 0, "kept before fetch");
  queue.get("01J-test");
  assert.equal(queue.cleanup(24), 1);
  assert.ok(!existsSync(path.join(dir, "01J-test.yaml")));
  cleanup();
});

test("remove() drops a published pitch from disk and the queue", () => {
  const { dir, queue, cleanup } = fresh();
  queue.accept(ENVELOPE, ["blog"]);
  queue.done("01J-test", "blog", { ref: "github:a/b#1", url: "u" });

  queue.remove("01J-test");
  assert.ok(!existsSync(path.join(dir, "01J-test.yaml")), "file is gone right away");
  assert.equal(queue.next(), null, "and it is not handed out again");
  assert.equal(new Queue(dir).restore(), 0, "nor restored after a restart");
  cleanup();
});

test("remove() on a missing file does not throw", () => {
  const { queue, cleanup } = fresh();
  assert.doesNotThrow(() => queue.remove("never-existed"));
  cleanup();
});

test("publish() keeps the file and marks it published", () => {
  const { dir, queue, cleanup } = fresh();
  queue.accept(ENVELOPE, ["blog"]);
  queue.done("01J-test", "blog", { ref: "github:a/b#1", url: "u" });

  queue.publish("01J-test");
  assert.ok(existsSync(path.join(dir, "01J-test.yaml")), "the file is kept as the lookup source");
  assert.equal(queue.read("01J-test").status, "published");
  cleanup();
});

test("a published pitch survives a status fetch — it is the lookup source for references", () => {
  const { dir, queue, cleanup } = fresh();
  queue.accept(ENVELOPE, ["blog"]);
  queue.done("01J-test", "blog", { ref: "r", url: "u" });
  queue.publish("01J-test");

  queue.get("01J-test"); // a status poll sets `fetched`
  assert.equal(queue.cleanup(24), 0, "the fetched fast-path does not drop a published pitch");
  assert.ok(existsSync(path.join(dir, "01J-test.yaml")));
  cleanup();
});

test("a published pitch is removed once the retention window expires", () => {
  const { dir, queue, cleanup } = fresh();
  queue.accept(ENVELOPE, ["blog"]);
  queue.done("01J-test", "blog", { ref: "r", url: "u" });
  queue.publish("01J-test");

  const old = new Date(Date.now() - 48 * 3600_000);
  utimesSync(path.join(dir, "01J-test.yaml"), old, old);
  assert.equal(queue.cleanup(24), 1, "kept only until retention expiry");
  cleanup();
});

test("publish() on a missing file does not throw", () => {
  const { queue, cleanup } = fresh();
  assert.doesNotThrow(() => queue.publish("never-existed"));
  cleanup();
});

test("an open awaiting-reply clarification is neither restored nor cleaned up", () => {
  const { dir, queue, cleanup } = fresh();
  // A step-dialog clarification: same directory, no jobs, status is the contract.
  writeFileSync(
    path.join(dir, "01J-clarify.yaml"),
    "id: 01J-clarify\nstatus: awaiting-reply\nquestion: Hast du den Link?\n",
  );
  queue.accept(ENVELOPE, ["blog"]); // a real pitch alongside it

  const restored = new Queue(dir);
  assert.equal(restored.restore(), 1, "only the real pitch is picked up");
  assert.equal(restored.next().job.briefing, "blog");

  const old = new Date(Date.now() - 48 * 3600_000);
  utimesSync(path.join(dir, "01J-clarify.yaml"), old, old);
  assert.equal(restored.cleanup(24), 0, "the clarification is not ours to delete");
  assert.ok(existsSync(path.join(dir, "01J-clarify.yaml")));
  cleanup();
});

test("failed pitches are kept until someone fetches them", () => {
  const { queue, cleanup } = fresh();
  queue.accept(ENVELOPE, ["blog"]);
  for (let i = 0; i < 3; i++) queue.fail("01J-test", "blog", "boom");

  queue.get("01J-test");
  assert.equal(queue.cleanup(24), 0, "failed is not auto-deleted");
  cleanup();
});

test("removes unfetched entries past the retention window", () => {
  const { dir, queue, cleanup } = fresh();
  queue.accept(ENVELOPE, ["blog"]);
  queue.done("01J-test", "blog", { ref: "r", url: "u" });

  const old = new Date(Date.now() - 48 * 3600_000);
  utimesSync(path.join(dir, "01J-test.yaml"), old, old);
  assert.equal(queue.cleanup(24), 1);
  cleanup();
});

// ------------------------------------------- the document grows in the job

test("stores the document in the job and grows it stage by stage", () => {
  const { queue, cleanup } = fresh();
  queue.accept(ENVELOPE, ["blog"]);

  queue.save("01J-test", "blog", "plot", { text: "x", plot: "Drehbuch" });
  queue.save("01J-test", "blog", "article", { text: "x", plot: "Drehbuch", markdown: "Text" });

  const job = queue.read("01J-test").jobs[0];
  assert.equal(job.stage, "article", "the last finished stage is what a restart resumes after");
  assert.equal(job.doc.markdown, "Text");
  assert.equal(job.doc.plot, "Drehbuch", "earlier fields are still there — nothing is merged, it is one document");
  cleanup();
});

test("save() re-reads, so it cannot clobber a concurrent write", () => {
  const { queue, cleanup } = fresh();
  queue.accept(ENVELOPE, ["blog"]);
  const stale = queue.next().pitch; // captured before the other writer runs

  queue.done("01J-test", "blog", { ref: "r", url: "u" });
  queue.save("01J-test", "blog", "plot", { plot: "p" });

  const job = queue.read("01J-test").jobs[0];
  assert.equal(job.state, "done", "the done() write survived");
  assert.equal(job.doc.plot, "p");
  assert.equal(stale.jobs[0].state, "pending", "the captured object was indeed stale");
  cleanup();
});

test("a new attempt starts without the document of the failed one", () => {
  const { queue, cleanup } = fresh();
  queue.accept(ENVELOPE, ["blog"]);
  queue.save("01J-test", "blog", "plot", { plot: "erster Versuch" });

  queue.fail("01J-test", "blog", "boom");

  const job = queue.read("01J-test").jobs[0];
  assert.equal(job.doc, undefined, "reusing it would repeat the failed run");
  assert.equal(job.stage, undefined, "and there is nothing to resume after");
  cleanup();
});

test("done() drops the reason of an earlier attempt", () => {
  const { queue, cleanup } = fresh();
  queue.accept(ENVELOPE, ["blog"]);
  queue.fail("01J-test", "blog", "boom");
  queue.done("01J-test", "blog", { ref: "r", url: "u" });

  const job = queue.read("01J-test").jobs[0];
  assert.equal(job.state, "done");
  assert.equal(job.reason, undefined, "a finished job must not read as if it had failed");
  cleanup();
});

// ------------------------------------------------------------ robustness

test("a foreign .yaml in the queue directory does not take startup down", () => {
  const { dir, queue, cleanup } = fresh();
  queue.accept(ENVELOPE, ["blog"]);
  writeFileSync(path.join(dir, "notes.yaml"), "anything: true\n");

  const restored = new Queue(dir);
  assert.equal(restored.restore(), 1, "the real pitch is still picked up");
  assert.equal(restored.cleanup(24), 0, "and cleanup survives it too");
  cleanup();
});

test("writes are atomic — no half file is ever visible", () => {
  const { dir, queue, cleanup } = fresh();
  queue.accept(ENVELOPE, ["blog"]);
  queue.save("01J-test", "blog", "article", { markdown: "x".repeat(200_000) });

  assert.deepEqual(readdirSync(dir), ["01J-test.yaml"], "no temp file left behind");
  assert.ok(queue.read("01J-test").jobs[0].doc.markdown, "and the file parses");
  cleanup();
});

test("a job without a state counts as work to do", () => {
  const { dir, queue, cleanup } = fresh();
  queue.accept(ENVELOPE, ["blog"]);
  queue.done("01J-test", "blog", { ref: "r", url: "u" });

  // What hand-editing a queue file to re-run it looks like.
  const pitch = queue.read("01J-test");
  pitch.jobs = [{ briefing: "blog" }];
  queue.write(pitch);

  const restored = new Queue(dir);
  assert.equal(restored.restore(), 1, "picked up again");
  assert.equal(restored.next().job.briefing, "blog");
  assert.equal(restored.fail("01J-test", "blog", "boom"), false, "attempts start at 0, not NaN");
  assert.equal(restored.read("01J-test").jobs[0].attempts, 1);
  cleanup();
});

test("a pitch file that vanishes mid-job does not take the worker down", () => {
  const { dir, queue, cleanup } = fresh();
  queue.accept(ENVELOPE, ["blog"]);
  rmSync(path.join(dir, "01J-test.yaml"));

  // All three writers re-read first, so all three can find it gone.
  assert.doesNotThrow(() => queue.save("01J-test", "blog", "plot", { plot: "p" }));
  assert.doesNotThrow(() => queue.done("01J-test", "blog", { ref: "r", url: "u" }));
  assert.equal(queue.fail("01J-test", "blog", "boom"), false, "not permanent — we only know the file is gone");
  assert.equal(queue.next(), null, "and the id is dropped from the queue");
  cleanup();
});
