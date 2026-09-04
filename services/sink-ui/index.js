#!/usr/bin/env node
import http from "node:http";
import { config } from "./config.js";

/**
 * Debug sink — receives publish payloads and shows them in a local browser UI.
 * Nothing is persisted; everything lives in memory and is gone on restart.
 *
 * POST /publish  → stores the article (title + markdown + images) in memory
 * GET  /         → renders all stored articles as a simple HTML page
 * POST /delete   → removes one article by id (form submit, redirects back to /)
 */

let nextId = 1;
const posts = new Map();

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderPost(p) {
  const images = (p.images ?? [])
    .map((img) => `<img src="${esc(img.data)}" alt="${esc(img.name)}" style="max-width:100%;border-radius:6px;margin-top:8px;">`)
    .join("\n");

  const metaEntries = [
    p.slug && `slug: <code>${esc(p.slug)}</code>`,
    p.briefing?.account && `account: <code>${esc(p.briefing.account)}</code>`,
    `received: <code>${esc(p.receivedAt)}</code>`,
  ]
    .filter(Boolean)
    .join(" &nbsp;·&nbsp; ");

  return `
<article id="post-${p.id}" style="background:#fff;border:1px solid #e0e0e0;border-radius:10px;padding:20px 24px;margin-bottom:24px;">
  <header style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;">
    <div>
      <h2 style="margin:0 0 4px;font-size:1.2rem;">${esc(p.title ?? p.slug ?? "#" + p.id)}</h2>
      <p style="margin:0;font-size:0.8rem;color:#888;">${metaEntries}</p>
    </div>
    <form method="POST" action="/delete" style="flex-shrink:0;">
      <input type="hidden" name="id" value="${p.id}">
      <button type="submit" style="background:#e53935;color:#fff;border:none;border-radius:6px;padding:6px 14px;cursor:pointer;font-size:0.85rem;">Löschen</button>
    </form>
  </header>
  ${images ? `<div style="margin-top:14px;">${images}</div>` : ""}
  ${p.description ? `<p style="margin:14px 0 0;font-size:0.9rem;color:#555;font-style:italic;">${esc(p.description)}</p>` : ""}
  <pre style="margin:14px 0 0;white-space:pre-wrap;font-family:sans-serif;font-size:0.92rem;line-height:1.6;background:#f7f7f7;padding:14px;border-radius:6px;overflow-x:auto;">${esc(p.markdown ?? "")}</pre>
</article>`;
}

function renderPage(items) {
  const count = items.length;
  const body = count === 0
    ? `<p style="color:#888;text-align:center;margin-top:60px;">Noch keine Posts — schick etwas mit „als debug".</p>`
    : items.map(renderPost).join("\n");

  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Debug UI (${count})</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #f3f4f6; margin: 0; padding: 24px; }
    h1   { font-size: 1.3rem; margin: 0 0 20px; color: #333; }
    .toolbar { display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; }
  </style>
</head>
<body>
  <div class="toolbar">
    <h1>Debug UI &nbsp;<span style="font-weight:normal;color:#888;font-size:1rem;">${count} Post${count !== 1 ? "s" : ""}</span></h1>
    ${count > 0 ? `<form method="POST" action="/clear"><button type="submit" style="background:#555;color:#fff;border:none;border-radius:6px;padding:6px 14px;cursor:pointer;">Alle löschen</button></form>` : ""}
  </div>
  ${body}
</body>
</html>`;
}

const server = http.createServer(async (req, res) => {
  const reply = (status, body, type = "text/html; charset=utf-8") => {
    res.writeHead(status, { "content-type": type });
    res.end(body);
  };
  const json = (status, obj) => reply(status, JSON.stringify(obj), "application/json");

  const readBody = async () => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    return Buffer.concat(chunks).toString("utf8");
  };

  if (req.method === "POST" && req.url === "/publish") {
    try {
      const payload = JSON.parse(await readBody());
      const id = nextId++;
      posts.set(id, { id, ...payload, receivedAt: new Date().toISOString() });
      console.log(`[sink-ui] #${id} received: ${payload.slug ?? payload.briefing ?? "?"}`);
      json(200, { ok: true, id });
    } catch (err) {
      console.error("[sink-ui] bad payload:", err.message);
      json(400, { errors: [err.message] });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/delete") {
    const params = new URLSearchParams(await readBody());
    posts.delete(Number(params.get("id")));
    res.writeHead(303, { location: "/" });
    res.end();
    return;
  }

  if (req.method === "POST" && req.url === "/clear") {
    posts.clear();
    res.writeHead(303, { location: "/" });
    res.end();
    return;
  }

  if (req.method === "GET" && (req.url === "/" || req.url === "")) {
    reply(200, renderPage([...posts.values()].reverse()));
    return;
  }

  reply(404, "Not found");
});

server.listen(config.port, "127.0.0.1", () =>
  console.log(`[sink-ui] :${config.port}  →  http://127.0.0.1:${config.port}/`),
);

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
