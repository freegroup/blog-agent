#!/usr/bin/env node
import http from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { getImageData } from "@blogagent/image";
import { config } from "./config.js";
import { validatePublish, _intern } from "@blogagent/sink-github/validate.js";

/**
 * Sink that writes to disk instead of a remote service.
 *
 * For inspection: whatever the newsroom produces ends up as readable
 * Markdown with images in a local folder. No secrets, no network, no repo —
 * and it proves that a channel really is just a different sink URL in the briefing.
 */
async function publish(payload) {
  const errors = validatePublish(payload, { maxBildBytes: config.maxImageBytes });
  if (errors.length) return { status: 400, body: { errors } };

  const { slug, title, description, markdown, images = [], debug_images = [] } = payload;
  const dir = path.join(config.targetDir, slug);
  mkdirSync(dir, { recursive: true });

  // Frontmatter is target form, not payload — the sink sets it.
  const content =
    `---\n` +
    `title: ${JSON.stringify(title)}\n` +
    `description: ${JSON.stringify(description)}\n` +
    `---\n\n${markdown.trim()}\n`;
  writeFileSync(path.join(dir, "index.md"), content);

  for (const img of images) {
    const resized = await sharp(Buffer.from(getImageData(img), "base64"))
      .resize({ width: config.imageWidth, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    writeFileSync(path.join(dir, img.name), resized);
  }

  // Images the article did not reference are dropped from the publication, but
  // this sink exists for inspection — so it writes them too, into a `_debug/`
  // subfolder so they never sit among the published files. The name guard is the
  // same the article and the GitHub sink enforce; a validating sink ignores this field.
  let debugCount = 0;
  for (const img of debug_images) {
    if (!_intern.IMAGE_NAME.test(img.name)) continue;
    const resized = await sharp(Buffer.from(getImageData(img), "base64"))
      .resize({ width: config.imageWidth, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    const debugDir = path.join(dir, "_debug");
    mkdirSync(debugDir, { recursive: true });
    writeFileSync(path.join(debugDir, img.name), resized);
    debugCount++;
  }

  const suffix = debugCount ? `, ${debugCount} debug` : "";
  console.log(`[sink-file] ${dir} (${images.length} image(s)${suffix})`);
  return {
    status: 201,
    body: { publication_ref: `file:${slug}`, url: `file://${path.resolve(dir)}/index.md` },
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
    console.error("[sink-file]", err);
    reply(500, { errors: [err.message] });
  }
});

server.listen(config.port, "127.0.0.1", () => console.log(`[sink-file] :${config.port} → ${config.targetDir}`));
