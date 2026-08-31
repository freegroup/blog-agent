#!/usr/bin/env node
import http from "node:http";
import { loadSettings, section } from "@blogagent/config";
import { validateEnvelope } from "@blogagent/envelope";
import { connectMany } from "@blogagent/mcp";
import { loadBriefings } from "./briefings.js";
import { deliver } from "./deliver.js";
import { resizeToWebp } from "./media.js";
import { Queue } from "./queue.js";
import { buildPipeline, runPipeline, persistable, rehydrate } from "./pipeline/index.js";

/**
 * The newsroom: accepts pitches, runs them through the pipeline, submits to the sink.
 *
 * It knows neither Telegram nor GitHub and never sends itself — it only posts
 * to sinks. Even a permanently failed job goes to a sink: the dead-letter sink.
 *
 * What an article is made of lives in `pipeline/`, and in which order in
 * `newsroom.pipeline`. This file only moves documents between the queue, the
 * pipeline and the sink.
 */
const settings = loadSettings();
const cfg = section(settings, "newsroom");
const PORT = cfg.num("port", 5080);
const RETENTION_H = cfg.num("retention_h", 24);
const MAX_ATTEMPTS = cfg.num("max_attempts", 3);

/** Grows with each attempt: 30 s, then 60 s, then 90 s. */
const RETRY_PAUSE_MS = cfg.num("retry_pause_s", 30) * 1000;

const BRIEFINGS_DIR = cfg.str("briefings_dir", "./briefings");
// Startup load doubles as validation — a broken briefing here is fatal, as it should be.
let briefings = loadBriefings(BRIEFINGS_DIR);

/**
 * Re-read briefings from disk so edits, new sections, and whole new briefing
 * files take effect without a restart. Called at the two moments that matter:
 * when a pitch is accepted (which channels exist) and when a job runs (the
 * prompt and sink URLs it uses). Resilient by design — a briefing saved
 * mid-edit (missing frontmatter, momentarily empty) must not take the worker
 * down, so on any load error we keep the last good set and log.
 */
function refreshBriefings() {
  try {
    const next = loadBriefings(BRIEFINGS_DIR);
    const before = briefings.map((b) => b.name).sort().join(",");
    const after = next.map((b) => b.name).sort().join(",");
    if (before !== after) console.log(`[newsroom] briefings reloaded: ${next.map((b) => b.name).join(", ")}`);
    briefings = next;
  } catch (err) {
    console.error(`[newsroom] briefing reload failed, keeping previous set: ${err.message}`);
  }
  return briefings;
}

const queue = new Queue(cfg.str("queue_dir", "./var/queue"), { maxAttempts: MAX_ATTEMPTS });
const mcp = await connectMany(settings.mcp ?? {});
const pipeline = await buildPipeline({ settings, mcp });

console.log(
  `[newsroom] ${briefings.length} briefing(s): ${briefings.map((b) => b.name).join(", ")} | ` +
    `${mcp.tools.length} tool(s)\n` +
    `[newsroom] pipeline: ${pipeline.describe}`,
);

// ---------------------------------------------------------------- Processing

async function handle(pitch, job) {
  // Re-read here so prompt/sink edits take effect on the very next job — no restart.
  const briefing = refreshBriefings().find((b) => b.name === job.briefing);
  if (!briefing) throw new Error(`Briefing '${job.briefing}' no longer exists`);

  // Resize once, here. Model and sink then see the same picture, and the raw
  // phone JPEG is never sent to a vision model. Names come from the newsroom so
  // the model cannot invent one that fails the sink's reference check.
  const images = [];
  for (const [i, medium] of pitch.envelope.media.entries()) {
    const webp = await resizeToWebp(Buffer.from(medium.data, "base64"));
    images.push({ name: `foto-${i + 1}.webp`, data: webp.toString("base64") });
  }

  // Research runs once per pitch, upstream — a filter service enriches the
  // envelope with `context` (shared facts, same for every ressort) before it ever
  // reaches here. A source that skips research simply leaves it null.

  // The document lives in the queue and grows stage by stage. If the process
  // died mid-pipeline, `job.doc` still holds how far it got — rehydrate it with
  // the freshly resized pictures and resume after the last finished stage. A
  // fresh job (or one restarting after a failure, where fail() cleared the doc)
  // starts from the pitch — or, for a revision, from the published document the
  // source read back (envelope.doc), with the comment history attached. The
  // newsroom does not interpret the review; it hands the whole document to the
  // stages, and each decides on its own fields.
  const isRevise = !!pitch.envelope.doc;
  const base = job.doc
    ? rehydrate(job.doc, images)
    : isRevise
      ? rehydrate(pitch.envelope.doc, images)
      : { text: pitch.envelope.text ?? "", images };
  const withReview = isRevise ? { ...base, review: pitch.envelope.review ?? [], revise: true } : base;

  // Timestamps travel in the document (→ blogagent.yaml): `created` is stamped
  // once on the first publish and preserved through every revision; `updated`
  // moves each time. `created` uses the pitch's own received_at so it reflects
  // when the impulse arrived, not when a worker happened to pick it up.
  const start = {
    ...withReview,
    // The shared research facts — same for every ressort of this pitch. On a fresh
    // pitch they ride in on the envelope (from the research filter); on a revision
    // they were persisted in the document and come back through rehydrate.
    context: pitch.envelope.context ?? withReview.context ?? null,
    created: withReview.created ?? pitch.envelope.received_at ?? new Date().toISOString(),
    updated: new Date().toISOString(),
  };

  const doc = await runPipeline(pipeline.stages, start, {
    contextFor: pipeline.contextFor,
    briefing,
    resumeAfter: job.stage,
    // Written as it happens, so `cat var/queue/<id>.yaml` shows how far a
    // running job has come and the whole article as it stands.
    onSave: (name, produced) => {
      queue.save(pitch.id, job.briefing, name, persistable(produced));
      console.log(`[newsroom] ${pitch.id.slice(0, 8)}/${job.briefing} · ${name} ✓`);
    },
  });

  const payload = {
    slug: doc.slug,
    title: doc.title,
    description: doc.description,
    markdown: doc.markdown,
    // The pipeline's images, not the pitch's: the article decides which of the
    // photos are actually part of it, and drops the rest.
    images: doc.images,
    // The dropped ones ride along for an inspection sink to write for debugging;
    // they are not part of the article and validating sinks ignore this field.
    debug_images: doc.imagesDropped ?? [],
    revises: pitch.envelope.revises ?? null,
    // The document's own truth, persisted next to the article as blogagent.yaml so
    // a later revision can read it back (plot, slug, image_names, …). Same shape
    // the queue stores; runtime-only review/revise are stripped by persistable.
    meta: persistable(doc),
    // The slug stage may rename on a revision; tell the sink so it removes the old
    // directory. null unless this is a revision whose slug actually changed.
    rename_from: isRevise && pitch.envelope.doc.slug && pitch.envelope.doc.slug !== doc.slug ? pitch.envelope.doc.slug : null,
  };

  // Best-effort debug copy first (if any), then the authoritative publish. Only
  // the target's failure propagates to retry/dead-letter; the logging sink never blocks.
  return deliver(briefing, payload);
}

/** Permanent failure is also a delivery — just to a different sink. */
async function reportFailure(pitch, job, reason) {
  const target = briefings.find((b) => b.name === job.briefing)?.deadletterSink;
  if (!target) return;
  // Re-read: the in-memory `pitch` predates queue.fail(), so it still looks
  // pending. The file on disk carries state:failed and the reason — that is the
  // record the dead-letter sink persists, unchanged, so it can be copied back
  // into the queue to reprocess.
  const record = queue.read(pitch.id) ?? pitch;
  try {
    await fetch(target, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pitch: record, briefing: job.briefing, reason }),
    });
  } catch (err) {
    console.error(`[newsroom] dead-letter unreachable: ${err.message}`);
  }
}

let running = false;
async function work() {
  if (running) return;
  running = true;
  try {
    let next;
    while ((next = queue.next())) {
      const { pitch, job } = next;
      const label = `${pitch.id.slice(0, 8)}/${job.briefing}`;
      try {
        const { publication_ref, url } = await handle(pitch, job);
        queue.done(pitch.id, job.briefing, { ref: publication_ref, url });
        console.log(`[newsroom] ${label} → ${url}`);

        // Fully published (every channel done)? Then the PR(s) are the record of
        // truth — drop the queue file instead of letting it linger until cleanup.
        const current = queue.read(pitch.id);
        if (queue.isComplete(current) && current.jobs.every((j) => j.state === "done")) {
          queue.remove(pitch.id);
          console.log(`[newsroom] ${pitch.id.slice(0, 8)} published — removed from queue`);
        }
      } catch (err) {
        const attempt = (job.attempts ?? 0) + 1;
        const permanent = queue.fail(pitch.id, job.briefing, err.message);
        console.error(`[newsroom] ${label} ${permanent ? "permanently " : ""}failed: ${err.message}`);

        if (permanent) {
          await reportFailure(pitch, job, err.message);
          continue;
        }
        // next() hands the same job straight back, so without this the three
        // attempts happen in one second. A model or a sink that is briefly down
        // would use up every retry before it is back — which is how a working
        // job ends in the dead letter.
        const pause = RETRY_PAUSE_MS * attempt;
        console.log(`[newsroom] ${label} retrying in ${pause / 1000}s (attempt ${attempt + 1}/${MAX_ATTEMPTS})`);
        await new Promise((r) => setTimeout(r, pause));
      }
    }
  } finally {
    running = false;
  }
}

// ---------------------------------------------------------------------- Server

const server = http.createServer(async (req, res) => {
  const reply = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (req.method === "POST" && req.url === "/pitches") {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const envelope = JSON.parse(Buffer.concat(chunks).toString("utf8"));

      const errors = validateEnvelope(envelope);
      if (errors.length) return reply(400, { errors });

      // Re-read here so a newly added briefing file is a live channel for new pitches.
      const pitch = queue.accept(envelope, refreshBriefings().map((b) => b.name));
      reply(202, { id: pitch.id });
      setImmediate(work);
    } catch (err) {
      reply(400, { errors: [err.message] });
    }
    return;
  }

  const status = req.method === "GET" && /^\/pitches\/([\w-]+)$/.exec(req.url ?? "");
  if (status) {
    const pitch = queue.get(status[1]);
    if (!pitch) return reply(404, { errors: ["unknown or already fetched"] });
    return reply(200, {
      id: pitch.id,
      state: queue.isComplete(pitch) ? (pitch.jobs.every((j) => j.state === "done") ? "done" : "failed") : "pending",
      // `doc` holds the whole article — it exists for reading the queue file,
      // not for shipping on every status poll. `stage` (how far it got) stays.
      jobs: pitch.jobs.map(({ doc, ...job }) => job),
    });
  }

  reply(404, { errors: ["POST /pitches | GET /pitches/{id}"] });
});

// Localhost only: otherwise anyone could curl a pitch straight into publication.
server.listen(PORT, "127.0.0.1", () => {
  const restored = queue.restore();
  console.log(`[newsroom] :${PORT}${restored ? ` — ${restored} open pitch(es) restored` : ""}`);
  if (restored) setImmediate(work);
});

setInterval(() => queue.cleanup(RETENTION_H), 3600_000).unref();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await mcp.close();
    server.close(() => process.exit(0));
  });
}
