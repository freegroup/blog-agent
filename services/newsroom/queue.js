import { mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, statSync } from "node:fs";
import path from "node:path";
import { parse, stringify } from "yaml";

/**
 * In-memory queue with a directory as its mirror.
 *
 * Ordering on accept is not arbitrary: write first, then enqueue.
 * The other way leaves a window where a crash swallows a pitch even though
 * the 202 has already gone out.
 *
 * Stored as YAML, not JSON, because these files are meant to be read while a
 * job runs: a stage's markdown comes out as a block scalar with real line
 * breaks instead of one long line full of `\n`.
 *
 * @typedef {{briefing:string, state:'pending'|'done'|'failed', attempts:number,
 *            stage?:string, doc?:object, ref?:string, url?:string, reason?:string}} Job
 * @typedef {{id:string, envelope:object, jobs:Job[], created_at:string, fetched?:boolean}} Pitch
 */
/**
 * A job with no state yet is work to do.
 *
 * That is not only the freshly accepted case: deleting `state`, `ref` and `url`
 * from a queue file by hand is the obvious way to say "run this again", and it
 * should not silently do nothing.
 */
const isPending = (job) => (job.state ?? "pending") === "pending";

const SUFFIX = ".yaml";

export class Queue {
  constructor(dir, { maxAttempts = 3 } = {}) {
    this.dir = dir;
    this.maxAttempts = maxAttempts;
    this.waiting = [];
    mkdirSync(dir, { recursive: true });
  }

  filePath(id) {
    return path.join(this.dir, `${id}${SUFFIX}`);
  }

  read(id) {
    try {
      return parse(readFileSync(this.filePath(id), "utf8"));
    } catch {
      return null;
    }
  }

  /**
   * Atomic: write beside, then rename.
   *
   * A torn write here is silent AND permanent — read() swallows the parse error,
   * next() drops the id, restore() skips the file forever and cleanup() never
   * deletes it. Harmless at 800 bytes; the stage records make these files large
   * enough to care.
   */
  write(pitch) {
    const target = this.filePath(pitch.id);
    const tmp = `${target}.${process.pid}.tmp`;
    // lineWidth is a global stringify option, but it only reshapes scalars that
    // exceed it — here just the prose (text, plot, description), which folds to
    // readable multiline instead of one endless line. Short fields are untouched,
    // and base64 in envelope.media has no spaces to fold at, so it stays on its
    // own single line. The folding round-trips losslessly.
    writeFileSync(tmp, stringify(pitch, { lineWidth: 80 }));
    renameSync(tmp, target);
  }

  /** Write to disk first, then enqueue in memory. Never the other way around. */
  accept(envelope, briefingNames) {
    const pitch = {
      id: envelope.id,
      envelope,
      jobs: briefingNames.map((briefing) => ({ briefing, state: "pending", attempts: 0 })),
      created_at: new Date().toISOString(),
    };
    this.write(pitch);
    this.waiting.push(pitch.id);
    return pitch;
  }

  /** On startup: restore open pitches from the directory into the in-memory queue. */
  restore() {
    const ids = [];
    for (const file of readdirSync(this.dir).filter((f) => f.endsWith(SUFFIX))) {
      const pitch = this.read(path.basename(file, SUFFIX));
      // An open step-dialog clarification lives in the same directory but is not
      // ours: it has no jobs yet, only a status. Skip it explicitly (the jobs
      // guard below would catch it too, but the status is the contract).
      if (pitch?.status === "awaiting-reply") continue;
      // Anything else that ends in .yaml must not take startup down with it —
      // restore() runs inside server.listen, so a throw here is a restart loop.
      if (!Array.isArray(pitch?.jobs)) continue;
      if (pitch.jobs.some(isPending)) ids.push(pitch.id);
    }
    ids.sort();
    this.waiting.push(...ids);
    return ids.length;
  }

  next() {
    while (this.waiting.length) {
      const id = this.waiting[0];
      const pitch = this.read(id);
      const job = pitch?.jobs.find(isPending);
      if (job) return { pitch, job };
      this.waiting.shift();
    }
    return null;
  }

  /**
   * Stores the document as it stands after a stage, and which stage that was.
   * The document lives in the job itself and grows step by step — no separate
   * per-stage records, and nothing to merge back together afterwards. `stage`
   * is what a restart resumes after.
   *
   * Re-reads before mutating like every other writer here: `get()` can set
   * `fetched` from the HTTP thread while a job is mid-pipeline, and mutating the
   * object captured back at next() would clobber it.
   */
  save(id, briefing, name, doc) {
    const pitch = this.read(id);
    const job = pitch?.jobs.find((j) => j.briefing === briefing);
    if (!job) return;
    job.stage = name;
    job.doc = doc;
    this.write(pitch);
  }

  done(id, briefing, { ref, url }) {
    const pitch = this.read(id);
    const job = pitch?.jobs.find((j) => j.briefing === briefing);
    if (!job) {
      this.vanished(id, "done");
      return;
    }
    Object.assign(job, { state: "done", ref, url });
    // The reason belonged to an attempt that is over. Left behind it reads as if
    // a finished job had failed — which is exactly how it looked before.
    delete job.reason;
    this.write(pitch);
  }

  /** After `maxAttempts` permanently failed — otherwise a poisoned pitch burns tokens. */
  fail(id, briefing, reason) {
    const pitch = this.read(id);
    const job = pitch?.jobs.find((j) => j.briefing === briefing);
    if (!job) {
      this.vanished(id, "fail");
      // Not permanent: we do not know the job failed, only that its file is
      // gone. next() drops the id on its own pass.
      return false;
    }
    job.attempts = (job.attempts ?? 0) + 1;
    job.reason = reason;
    // The half-built document is kept for reading, never for reuse: the next
    // attempt has to start from scratch, or all three are the same failed run.
    // (A process restart is the other case — there the document survives, and
    // the pipeline resumes after `stage`.)
    delete job.doc;
    delete job.stage;
    if (job.attempts >= this.maxAttempts) job.state = "failed";
    this.write(pitch);
    return job.state === "failed";
  }

  /**
   * A pitch file that disappeared mid-job — deleted, moved, or unreadable.
   *
   * Every writer re-reads before mutating, so any of them can find it gone.
   * Recording the result is then impossible, but it must not take the worker
   * down: the job itself may well have succeeded, and the next pitch in the
   * queue has nothing to do with this one.
   */
  vanished(id, where) {
    console.error(`[queue] ${id} disappeared while running — ${where}() had nothing to write to`);
  }

  /** All jobs terminal? Then the pitch is complete and may be removed after fetching. */
  isComplete(pitch) {
    return Array.isArray(pitch?.jobs) && !pitch.jobs.some(isPending);
  }

  /**
   * Drop a pitch from disk and the waiting list. Used the moment it is fully
   * published — the PR is the record of truth, so the queue file has done its
   * job. Failed pitches are NOT removed this way; they are kept as the signal
   * that something broke (see cleanup()).
   */
  remove(id) {
    try {
      unlinkSync(this.filePath(id));
    } catch {
      // already gone (hand-deleted, or a torn write) — nothing to do
    }
    const i = this.waiting.indexOf(id);
    if (i !== -1) this.waiting.splice(i, 1);
  }

  /**
   * Mark a fully published pitch as published instead of dropping it.
   *
   * The PR(s) are the record of truth, but the queue file — envelope, media and the
   * finished doc(s) — stays as the lookup source for later references ("also put
   * the last posting on the blog"). This only flips the status and rewrites;
   * cleanup() keeps a published pitch until the retention window expires, so a
   * status poll (which sets `fetched`) can no longer drop it early.
   */
  publish(id) {
    const pitch = this.read(id);
    if (!pitch) {
      this.vanished(id, "publish");
      return;
    }
    pitch.status = "published";
    this.write(pitch);
  }

  get(id) {
    const pitch = this.read(id);
    if (!pitch) return null;
    if (this.isComplete(pitch) && !pitch.fetched) {
      pitch.fetched = true;
      this.write(pitch);
    }
    return pitch;
  }

  /**
   * Cleans up: fetched completed pitches, and everything finished past the retention window.
   * `failed` is kept until fetched — otherwise the only signal that something broke disappears.
   * `published` is kept until the retention window expires regardless of fetching — it is the
   * lookup source for references ("the last posting"). An open `awaiting-reply` clarification
   * is not ours and is left untouched.
   */
  cleanup(retentionHours) {
    const cutoff = Date.now() - retentionHours * 3600_000;
    let removed = 0;

    for (const file of readdirSync(this.dir).filter((f) => f.endsWith(SUFFIX))) {
      const fullPath = path.join(this.dir, file);
      const pitch = this.read(path.basename(file, SUFFIX));
      if (!pitch) continue;
      if (pitch.status === "awaiting-reply") continue; // a step-dialog clarification, not ours
      if (!this.isComplete(pitch)) continue;

      const expired = statSync(fullPath).mtimeMs < cutoff;
      const allSucceeded = pitch.jobs.every((j) => j.state === "done");
      // The fetched fast-path drops a done pitch as soon as a status poll has read
      // it — but NOT a published one: that stays until it expires so references can
      // still find it.
      const fetchedDone = pitch.fetched && allSucceeded && pitch.status !== "published";
      if (fetchedDone || expired) {
        unlinkSync(fullPath);
        removed++;
      }
    }
    return removed;
  }
}
