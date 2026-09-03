#!/usr/bin/env node
import http from "node:http";
import { createLlm } from "@blogagent/llm";
import { connectOne } from "@blogagent/mcp";
import { config } from "./config.js";
import { makeHandler } from "./handler.js";

/**
 * Bootstrap only: build the LLM the filters judge with, connect mcp-telegram as a
 * SENDER (never a poller — two pollers with one token get a 409), bind the port and
 * wire the handler. This file is the process entry point and is never imported;
 * everything testable lives in handler.js / pipeline.js / filters / store.js.
 */
const llm = await createLlm(config.llm);
const telegram = await connectOne(config.mcp, "step-dialog");

const server = http.createServer(
  makeHandler({ out: config.out, queueDir: config.queueDir, telegram, llm }),
);
// Localhost only, like every other hop — the chain never leaves the machine.
server.listen(config.port, "127.0.0.1", () => console.log(`[step-dialog] :${config.port} → ${config.out}`));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await telegram.close();
    server.close(() => process.exit(0));
  });
}
