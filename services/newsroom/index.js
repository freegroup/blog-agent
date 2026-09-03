#!/usr/bin/env node
import http from "node:http";
import { validateEnvelope } from "@blogagent/envelope";
import { connectMany, connectOne } from "@blogagent/mcp";
import { config } from "./config.js";
import { loadBriefings } from "./briefings.js";
import { deliver } from "./deliver.js";
import { resizeToWebp } from "./media.js";
import { Queue } from "./queue.js";
import { chooseChannels } from "./dispatch.js";
import { buildPipeline, runPipeline, persistable, rehydrate } from "./pipeline/index.js";

/**
 * The newsroom: accepts pitches, runs them through the pipeline, submits to the sink.
 *
 * It knows neither GitHub nor any blog platform — it only posts finished articles
 * to sinks. The one exception is the dispatcher: when a pitch arrives it decides
 * which briefings it is for and tells the user directly over Telegram (the single
 * user-facing channel), because that decision is the newsroom's to explain. Even a
 * permanently failed job goes to a sink: the dead-letter sink.
 *
 * What an article is made of lives in `pipeline/`, and in which order in
 * `newsroom.pipeline`. This file only moves documents between the queue, the
 * pipeline and the sink.
 */
// Startup load doubles as validation — a broken briefing here is fatal, as it should be.
let briefings = loadBriefings(config.briefingsDir);

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
    const next = loadBriefings(config.briefingsDir);
    const before = briefings.map((b) => b.name).sort().join(",");
    const after = next.map((b) => b.name).sort().join(",");
    if (before !== after) console.log(`[newsroom] briefings reloaded: ${next.map((b) => b.name).join(", ")}`);
    briefings = next;
  } catch (err) {
    console.error(`[newsroom] briefing reload failed, keeping previous set: ${err.message}`);
  }
  return briefings;
}

const queue = new Queue(config.queueDir, { maxAttempts: config.maxAttempts });
const mcp = await connectMany(config.mcpServers);
const pipeline = await buildPipeline({ settings: config.settings, mcp });

// The dispatcher's model — which LLM it uses is a settings choice like any stage's,
// built through the pipeline's memoised map so there is one place that knows profiles.
const dispatchLlm = await pipeline.llmFor(config.dispatchLlmProfile);

// The bridge to the user. The newsroom reports its own dispatch decision here;
// mcp-telegram records every outbound message into the chat history, so we do not
// mirror it ourselves.
const telegram = await connectOne(config.mcp, "newsroom");

/** Tell the user something over Telegram. Best-effort: a send failure must never drop a pitch. */
async function announce(text) {
  try {
    await telegram.call("send_message", { text });
  } catch (err) {
    console.error(`[newsroom] announce failed: ${err.message}`);
  }
}

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

  // step-research runs once per pitch, upstream — that hop enriches the envelope
  // with `context` (shared facts, same for every ressort) before it ever reaches
  // here. A source that skips step-research simply leaves it null.

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
    // The ressort this document belongs to, persisted into blogagent.yaml (persistable
    // keeps it as an unknown field). A later revision read back by source-github then
    // carries it, so the dispatcher can route the revision to exactly this briefing
    // instead of fanning back out to all of them.
    briefing: job.briefing,
    // The shared context facts — same for every ressort of this pitch. On a fresh
    // pitch they ride in on the envelope (from step-research); on a revision
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
    // The selected briefing's full frontmatter, so a sink can read per-channel
    // config it cares about (e.g. `account` for the Instagram profile) without
    // knowing anything about how or where briefings are stored.
    briefing: briefing.frontmatter,
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

        // Fully published (every channel done)? The PR(s) are the record of
        // truth, but we KEEP the queue file — envelope, media and the finished
        // doc(s) — as the lookup source for later references ("also put the last
        // posting on the blog"). Mark it published; cleanup() drops it when the
        // retention window expires.
        const current = queue.read(pitch.id);
        if (queue.isComplete(current) && current.jobs.every((j) => j.state === "done")) {
          queue.publish(pitch.id);
          console.log(`[newsroom] ${pitch.id.slice(0, 8)} published — kept for reference`);
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
        const pause = config.retryPauseMs * attempt;
        console.log(`[newsroom] ${label} retrying in ${pause / 1000}s (attempt ${attempt + 1}/${config.maxAttempts})`);
        await new Promise((r) => setTimeout(r, pause));
      }
    }
  } finally {
    running = false;
  }
}

// ---------------------------------------------------------------------- Server

/**
 * Which briefings is this pitch for?
 *
 * A revision skips the dispatcher: it already belongs to one ressort, recorded in
 * its document (blogagent.yaml) on the first publish. We route it straight back
 * there; a legacy document without that field falls back to all briefings (safe:
 * a revision only touches an existing article).
 *
 * A fresh pitch goes through the dispatcher. If that fails we never drop the pitch
 * — we fall back to every briefing and let the pipeline decide, exactly as before
 * the dispatcher existed.
 */
async function routeChannels(envelope, all) {
  const allNames = all.map((b) => b.name);

  if (envelope.doc) {
    const owner = envelope.doc.briefing;
    return owner && allNames.includes(owner) ? [owner] : allNames;
  }

  try {
    return await chooseChannels({ text: envelope.text ?? "", briefings: all, llm: dispatchLlm });
  } catch (err) {
    console.error(`[newsroom] dispatch failed, using all channels: ${err.message}`);
    return allNames;
  }
}

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
      const all = refreshBriefings();
      const channels = await routeChannels(envelope, all);

      // No channel is responsible: create nothing and tell the user so, rather than
      // silently dropping the pitch or fanning it out to briefings it does not fit.
      if (!channels.length) {
        reply(202, { id: envelope.id, channels: [] });
        announce("🤷 Dafür habe ich keinen passenden Kanal — ich schreibe nichts.");
        return;
      }

      const pitch = queue.accept(envelope, channels);
      reply(202, { id: pitch.id });
      announce(`✍️ Ich schreibe den Artikel für die Briefings:\n${channels.map((c) => ` - ${c}`).join("\n")}`);
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
server.listen(config.port, "127.0.0.1", () => {
  const restored = queue.restore();
  console.log(`[newsroom] :${config.port}${restored ? ` — ${restored} open pitch(es) restored` : ""}`);
  if (restored) setImmediate(work);
});

setInterval(() => queue.cleanup(config.retentionH), 3600_000).unref();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await mcp.close();
    await telegram.close();
    server.close(() => process.exit(0));
  });
}
