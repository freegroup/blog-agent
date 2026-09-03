#!/usr/bin/env node
import http from "node:http";
import { loadSettings, section } from "@blogagent/config";
import { makeHandler } from "./handler.js";

/**
 * Bootstrap only: read settings, bind the port, wire the handler. This file is the
 * process entry point and is never imported, so it needs no run-as-main guard —
 * every testable part lives in handler.js and context.js.
 */
const cfg = section(loadSettings(), "research");
// Required, no default — a misconfigured port must fail loudly, not silently
// bind somewhere unexpected.
const PORT = cfg.num("port");
// Required — a research with nowhere to deliver is a dead end, not a default.
const OUT = cfg.str("out");

const server = http.createServer(makeHandler(OUT));
// Localhost only, like every other hop — the chain never leaves the machine.
server.listen(PORT, "127.0.0.1", () => console.log(`[research] :${PORT} → ${OUT}`));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
