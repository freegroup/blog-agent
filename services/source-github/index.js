#!/usr/bin/env node
import { loadSettings, section, secret } from "@blogagent/config";
import { GitHub } from "@blogagent/sink-github/github.js";
import { makePoll } from "./poll.js";

/**
 * Bootstrap only: read settings, build the GitHub client, run the poll loop. This
 * file is the process entry point and is never imported, so it needs no
 * run-as-main guard — the pollable logic (decide, makePoll) lives in poll.js.
 */
const settings = loadSettings();
const cfg = section(settings, "source-github");
const POLL_MS = cfg.num("poll_seconds", 60) * 1000;
const LABEL = section(settings, "sink-github").str("label", "blogagent");
const REPO = cfg.str("repo");
const [OWNER, NAME] = REPO.split("/");

const gh = new GitHub({ apiUrl: cfg.str("api_url", "https://api.github.com"), repo: REPO, token: secret("GITHUB_TOKEN") });

const poll = makePoll({
  gh,
  // A revision skips research and posts straight to the newsroom: the facts were
  // gathered on the first pitch and persisted in the article's blogagent.yaml —
  // the owner only wants changes, not a second round of fact-finding. Still just a
  // configurable URL, so the routing stays in settings, not hard-coded here.
  out: cfg.str("out"),
  ackText: cfg.str("ack_text", "→ weitergeleitet an die Fachabteilung"),
  ownerLogin: secret("GITHUB_OWNER"),
  staleMs: cfg.num("ack_stale_min", 15) * 60_000,
  label: LABEL,
  owner: OWNER,
  name: NAME,
});

console.log(`[source-github] ${REPO}, label '${LABEL}', every ${POLL_MS / 1000}s`);
while (true) {
  await poll().catch((err) => console.error(`[source-github] ${err.message}`));
  await new Promise((r) => setTimeout(r, POLL_MS));
}
