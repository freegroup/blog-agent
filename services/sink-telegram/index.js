#!/usr/bin/env node
import http from "node:http";
import sharp from "sharp";
import { connectOne } from "@blogagent/mcp";
import { getImageData } from "@blogagent/image";
import { config } from "./config.js";
import { composeMessage, planDelivery } from "./message.js";

/**
 * Sink that delivers a finished article to a Telegram chat.
 *
 * Same `POST /publish` contract as the file and GitHub sinks — a briefing names
 * it as a sink and the newsroom posts the finished article here. It reuses
 * `mcp-telegram` (the single holder of the Telegram token, like `sink-deadletter`
 * does), so there is no direct Telegram API access here — only its tools.
 *
 * It delivers the article's images too: the pipeline's WebP is converted to JPEG
 * (Telegram will not take WebP as a photo) and sent as a photo group via
 * `send_photos`, with the text as the caption when it fits (see planDelivery).
 *
 * It is NOT wired into the chat hub — it neither reads nor writes the conversation
 * history. It just publishes to the chat.
 */
const telegram = await connectOne(config.mcp, "sink-telegram");

/** Convert one WebP (base64) to JPEG (base64) — Telegram rejects WebP as a photo. */
async function toJpeg(base64) {
  const buffer = await sharp(Buffer.from(base64, "base64")).jpeg({ quality: 85 }).toBuffer();
  return buffer.toString("base64");
}

async function publish(payload) {
  const { slug, revises, images = [] } = payload ?? {};
  const text = composeMessage(payload);

  // Convert each image; a single bad image is skipped, not a reason to fail the
  // whole delivery.
  const photos = (
    await Promise.all(
      images.slice(0, config.MAX_PHOTOS).map(async (img) => {
        try {
          return { name: (img.name ?? "foto").replace(/\.webp$/i, ".jpg"), data: await toJpeg(getImageData(img)) };
        } catch (err) {
          console.error(`[sink-telegram] image ${img.name} skipped: ${err.message}`);
          return null;
        }
      }),
    )
  ).filter(Boolean);

  const steps = planDelivery({ text, photoCount: photos.length });
  if (!steps.length) return { status: 400, body: { errors: ["nothing to send"] } };

  for (const step of steps) {
    if (step.kind === "photos") {
      await telegram.call("send_photos", { photos, ...(step.caption ? { caption: text } : {}) });
    } else {
      await telegram.call("send_message", { text });
    }
  }

  const withPhotos = photos.length ? ` +${photos.length} photo(s)` : "";
  console.log(`[sink-telegram] sent: ${slug ?? "(no slug)"}${withPhotos}${revises ? " (revision)" : ""}`);
  return {
    status: 201,
    // No public URL: send_message returns only "sent", Telegram gives no message link.
    body: { publication_ref: `telegram:${slug ?? "article"}`, url: null },
  };
}

const server = http.createServer(async (req, res) => {
  const reply = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (req.method !== "POST" || req.url !== "/publish") return reply(404, { errors: ["POST /publish"] });

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const { status, body } = await publish(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    reply(status, body);
  } catch (err) {
    console.error("[sink-telegram]", err);
    reply(500, { errors: [err.message] });
  }
});

server.listen(config.port, "127.0.0.1", () => console.log(`[sink-telegram] :${config.port}`));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await telegram.close();
    server.close(() => process.exit(0));
  });
}
