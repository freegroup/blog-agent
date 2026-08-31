#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { loadSettings, section } from "@blogagent/config";
import { fetchWithRetry } from "@blogagent/http";
import { connectOne } from "@blogagent/mcp";
import { postMessage } from "@blogagent/chat";
import { parseFeed, slugOf, freshItems } from "./feed.js";

/**
 * Watches the blog's RSS feed and reports every newly published post to Telegram.
 *
 * This is the "it's live" signal the pipeline never had: the PR merge and the
 * deploy happen outside the system, so the feed — not GitHub — is the truth that
 * an article is actually online. Independent of everything else, and the future
 * trigger for downstream channels (Pinterest), which can only run once the blog
 * URL is reachable.
 *
 * On first start it adopts the current feed as a silent baseline — no flood of
 * "new" for posts that already existed — and announces only what appears after.
 */
const settings = loadSettings();
const cfg = section(settings, "watch-rss");
const FEED_URL = cfg.str("feed_url");
const POLL_MS = cfg.num("poll_seconds", 60) * 1000;
const SEEN_FILE = cfg.str("seen_file", "./var/watch-rss-seen.json");

const telegram = await connectOne(cfg.str("mcp", "node services/mcp-telegram/index.js"), "watch-rss");

function loadSeen() {
  try {
    return new Set(JSON.parse(readFileSync(SEEN_FILE, "utf8")));
  } catch {
    return null; // no baseline yet
  }
}

function saveSeen(seen) {
  mkdirSync(path.dirname(SEEN_FILE), { recursive: true });
  // Pretty-printed so the file is readable/diff-able when you open it.
  writeFileSync(SEEN_FILE, JSON.stringify([...seen], null, 2) + "\n");
}

async function announce(item) {
  const text = `✅ Neuer Blog ist live:\n${item.title}\n${item.link}`;
  const meta = { kind: "blog-live", url: item.link, slug: slugOf(item.link), title: item.title };

  // Tell the user, and record it in the hub with structure so a later
  // "mach dafür einen Pin" can resolve which blog was meant.
  await telegram.call("send_message", { text });
  await postMessage({ direction: "out", author: "watch-rss", text, meta });
  console.log(`[watch-rss] announced: ${item.title}`);
}

async function poll() {
  const res = await fetchWithRetry(FEED_URL, { headers: { "user-agent": "BlogAgent-watch/1.0" } }, { label: "watch-rss feed" });
  if (!res.ok) throw new Error(`feed ${res.status}`);
  const items = parseFeed(await res.text());

  let seen = loadSeen();
  if (seen === null) {
    seen = new Set(items.map((i) => i.guid));
    saveSeen(seen);
    console.log(`[watch-rss] baseline: ${seen.size} existing posts, watching for new ones`);
    return;
  }

  const fresh = freshItems(items, seen);
  // Oldest first, so the chat reads in publication order.
  for (const item of fresh.reverse()) {
    await announce(item);
    seen.add(item.guid);
  }
  if (fresh.length) saveSeen(seen);
}

console.log(`[watch-rss] ${FEED_URL}, every ${POLL_MS / 1000}s`);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await telegram.close();
    process.exit(0);
  });
}

while (true) {
  await poll().catch((err) => console.error(`[watch-rss] ${err.message}`));
  await new Promise((r) => setTimeout(r, POLL_MS));
}
