#!/usr/bin/env node
import http from "node:http";
import { config } from "./config.js";
import { makeHandler } from "./handler.js";

/**
 * Bootstrap only: bind the port, wire the handler. This file is the process entry
 * point and is never imported, so it needs no run-as-main guard — every testable
 * part lives in handler.js and context.js, all config in config.js.
 */
const server = http.createServer(makeHandler(config.out));
// Localhost only, like every other hop — the chain never leaves the machine.
server.listen(config.port, "127.0.0.1", () => console.log(`[step-research] :${config.port} → ${config.out}`));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
