#!/usr/bin/env node
import { GitHub } from "@blogagent/sink-github/github.js";
import { config, assertSecrets } from "./config.js";
import { makePoll } from "./poll.js";

/**
 * Bootstrap only: build the GitHub client, run the poll loop. This file is the
 * process entry point and is never imported, so it needs no run-as-main guard —
 * the pollable logic (decide, makePoll) lives in poll.js, all config in config.js.
 * No process.env or settings reads here: everything comes from `config`.
 */
assertSecrets();

const gh = new GitHub({ apiUrl: config.apiUrl, repo: config.repo, token: config.githubToken });

const poll = makePoll({
  gh,
  out: config.out,
  ackText: config.ackText,
  rejectText: config.rejectText,
  ownerLogin: config.githubOwner,
  staleMs: config.staleMs,
  label: config.label,
  owner: config.owner,
  name: config.name,
});

console.log(`[source-github] ${config.repo}, label '${config.label}', every ${config.pollMs / 1000}s`);
while (true) {
  await poll().catch((err) => console.error(`[source-github] ${err.message}`));
  await new Promise((r) => setTimeout(r, config.pollMs));
}
