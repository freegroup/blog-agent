#!/usr/bin/env node
import http from "node:http";
import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { connectOne } from "@blogagent/mcp";
import { config } from "./config.js";
import { deadletterRecord } from "./record.js";

/**
 * Sink for everything that has permanently failed.
 *
 * The newsroom never sends itself — it only posts to sinks. A job that
 * gives up after `max_attempts` ends up here, and this sink reports it.
 * Without it a failure is silent: no PR, no message, just a log line nobody reads.
 *
 * Two channels, independent: a Telegram notification (seen at once, scrolls away)
 * and a Markdown record under `dir` (stays, grep-able) for later debugging.
 */
const telegram = await connectOne(config.mcp, "sink-deadletter");

const server = http.createServer(async (req, res) => {
  const reply = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (req.method !== "POST" || req.url !== "/deadletter") {
    return reply(404, { errors: ["POST /deadletter"] });
  }

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    // `pitch` is the authoritative queue record (state: failed, reason on the job);
    // `briefing`/`reason` are pulled out for the notification only.
    const { pitch, briefing, reason } = JSON.parse(Buffer.concat(chunks).toString("utf8"));

    // Write the on-disk record first; a disk problem must not swallow the alert.
    let file = null;
    try {
      const { filename, content } = deadletterRecord(pitch);
      mkdirSync(config.dir, { recursive: true });
      file = path.join(config.dir, filename);
      writeFileSync(file, content);
    } catch (err) {
      console.error(`[sink-deadletter] could not write record: ${err.message}`);
    }

    const excerpt = (pitch?.envelope?.text ?? "").trim().split("\n")[0].slice(0, 120);
    await telegram.call("send_message", {
      text:
        `❌ Aufgegeben nach mehreren Versuchen\n\n` +
        `Kanal: ${briefing}\n` +
        `Pitch: ${pitch?.id}\n` +
        (excerpt ? `Ursprung: „${excerpt}"\n` : "") +
        `\nGrund: ${reason}`,
    });

    console.log(`[sink-deadletter] reported: ${pitch?.id}/${briefing} — ${reason}${file ? ` · ${file}` : ""}`);
    reply(200, { notified: true, file });
  } catch (err) {
    console.error("[sink-deadletter]", err);
    reply(500, { errors: [err.message] });
  }
});

server.listen(config.port, "127.0.0.1", () => console.log(`[sink-deadletter] :${config.port}`));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await telegram.close();
    server.close(() => process.exit(0));
  });
}
