#!/usr/bin/env node
import http from "node:http";
import { loadSettings, section } from "@blogagent/config";
import { makeStore } from "./store.js";

/**
 * The chat hub: the single record of the conversation with the user, and its
 * live broadcaster.
 *
 * It is deliberately dumb about Telegram — it neither sends nor receives there.
 * Producers (source-telegram for the user's messages, the watcher and sinks for
 * anything reported back) POST here; the hub persists the line and pushes it to
 * every subscriber over SSE. Subscribers just open `/events` — the hub broadcasts
 * to all and has no idea who they are. That is the observer bus, across processes.
 *
 * Storage is one JSON line per message; nothing here parses or interprets them.
 */
const cfg = section(loadSettings(), "chat");
const PORT = cfg.num("port", 5090);
const FILE = cfg.str("file", "./var/chat/history.jsonl");
const { append, recent } = makeStore(FILE);

/** SSE responses currently listening. */
const subscribers = new Set();

function broadcast(line) {
  for (const res of subscribers) {
    try {
      res.write(`data: ${line}\n\n`);
    } catch {
      /* a broken pipe is cleaned up by the 'close' handler */
    }
  }
}

const server = http.createServer(async (req, res) => {
  const reply = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Ingest: a producer records a message. Persist, then broadcast.
  if (req.method === "POST" && url.pathname === "/messages") {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const entry = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      broadcast(append(entry));
      return reply(202, { ok: true });
    } catch (err) {
      return reply(400, { errors: [err.message] });
    }
  }

  // History: catch up on what was said. `?limit=` bounds it.
  if (req.method === "GET" && url.pathname === "/messages") {
    const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 1000);
    return reply(200, recent(limit));
  }

  // Subscribe: the live stream. Stays open; every new message is pushed here.
  if (req.method === "GET" && url.pathname === "/events") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write(":ok\n\n");
    subscribers.add(res);
    // Comment heartbeat keeps proxies and half-open sockets from timing out.
    const heartbeat = setInterval(() => {
      try {
        res.write(":hb\n\n");
      } catch {
        /* cleaned up below */
      }
    }, 25_000);
    req.on("close", () => {
      clearInterval(heartbeat);
      subscribers.delete(res);
    });
    return;
  }

  reply(404, { errors: ["POST /messages | GET /messages | GET /events"] });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[chat] :${PORT} → ${FILE}`);
});
