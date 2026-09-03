#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { connectOne } from "@blogagent/mcp";
import { postMessage } from "@blogagent/chat";
import { config } from "./config.js";
import { fetchMedia, freshMedia, firstLine, discoverAccounts } from "./media.js";

/**
 * Watches every Instagram account and reports each newly published post to Telegram.
 *
 * The symmetric partner to watch-rss ("blog is live"), this is "Instagram post is
 * live". sink-instagram logs a post the moment it creates one but sends nothing to
 * Telegram — this monitor closes that gap and, being independent, also catches posts
 * made to an account outside the pipeline.
 *
 * Agnostic of how many profiles exist: it discovers every `INSTAGRAM_*ACCESS_TOKEN`
 * in .env on each poll (sink-instagram owns and refreshes those tokens; the watcher
 * only reads), polls each account's media, and keeps one seen-file per account. A new
 * account is picked up the moment its token appears — no config, no restart.
 *
 * On first sight of an account it adopts the current media as a silent baseline — no
 * flood of "new" for posts that already existed — and announces only what follows.
 */
const telegram = await connectOne(config.mcp, "watch-instagram");

/** Every account with a token in .env right now (label + token, deduped). */
function accountsFromEnv() {
  try {
    return discoverAccounts(readFileSync(config.envPath, "utf8"));
  } catch {
    return [];
  }
}

const seenPath = (label) => path.join(config.seenDir, `watch-instagram-${label}-seen.json`);

function loadSeen(label) {
  try {
    return new Set(JSON.parse(readFileSync(seenPath(label), "utf8")));
  } catch {
    return null; // no baseline yet
  }
}

function saveSeen(label, seen) {
  mkdirSync(config.seenDir, { recursive: true });
  // Pretty-printed so the file is readable/diff-able when you open it.
  writeFileSync(seenPath(label), JSON.stringify([...seen], null, 2) + "\n");
}

async function announce(label, item) {
  const text = `📸 Instagram-Post ist live (${label}):\n${firstLine(item.caption)}\n${item.permalink}`;
  const meta = { kind: "instagram-live", account: label, url: item.permalink, media_id: item.id };

  // Tell the user, and record it in the hub with structure so a later reference
  // ("der Insta-Post von gestern") can resolve which post was meant.
  await telegram.call("send_message", { text });
  await postMessage({ direction: "out", author: "watch-instagram", text, meta });
  console.log(`[watch-instagram] announced: media ${item.id} (${label})`);
}

async function pollAccount({ label, token }) {
  const items = await fetchMedia({ apiUrl: config.apiUrl, token, limit: config.limit });

  let seen = loadSeen(label);
  if (seen === null) {
    seen = new Set(items.map((i) => i.id));
    saveSeen(label, seen);
    console.log(`[watch-instagram] baseline (${label}): ${seen.size} existing posts, watching for new ones`);
    return;
  }

  const fresh = freshMedia(items, seen);
  // Oldest first, so the chat reads in publication order.
  for (const item of fresh.reverse()) {
    await announce(label, item);
    seen.add(item.id);
  }
  if (fresh.length) saveSeen(label, seen);
}

async function poll() {
  const accounts = accountsFromEnv();
  if (!accounts.length) {
    console.log("[watch-instagram] no INSTAGRAM_*ACCESS_TOKEN in .env yet — waiting");
    return;
  }
  for (const account of accounts) {
    // One account's failure (e.g. an expired token) must not stop the others.
    await pollAccount(account).catch((err) => console.error(`[watch-instagram] ${account.label}: ${err.message}`));
  }
}

console.log(`[watch-instagram] ${config.apiUrl}/me/media, every ${config.pollMs / 1000}s`);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await telegram.close();
    process.exit(0);
  });
}

while (true) {
  await poll().catch((err) => console.error(`[watch-instagram] ${err.message}`));
  await new Promise((r) => setTimeout(r, config.pollMs));
}
