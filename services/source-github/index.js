#!/usr/bin/env node
import { parse } from "yaml";
import { loadSettings, section, secret } from "@blogagent/config";
import { makeEnvelope, formatRef } from "@blogagent/envelope";
import { GitHub } from "@blogagent/sink-github/github.js";

/**
 * The return channel. Polls PRs with the label and submits owner comments as a
 * new pitch — with `revises`, so the newsroom revises rather than
 * writing from scratch.
 *
 * State lives in GitHub, not locally, and is determined by comment order: if the
 * last comment is mine, the case has been handed off. This means the service is
 * immediately up to date after any restart.
 */
const settings = loadSettings();
const cfg = section(settings, "source-github");
const POLL_MS = cfg.num("poll_seconds", 60) * 1000;
const STALE_MS = cfg.num("ack_stale_min", 15) * 60_000;
const ACK_TEXT = cfg.str("ack_text", "→ weitergeleitet an die Fachabteilung");
const LABEL = section(settings, "sink-github").str("label", "blogagent");
// A revision skips research and posts straight to the newsroom: the facts were
// gathered on the first pitch and persisted in the article's blogagent.yaml —
// the owner only wants changes, not a second round of fact-finding. Still just a
// configurable URL, so the routing stays in settings, not hard-coded here.
const OUT = cfg.str("out");

const REPO = cfg.str("repo");
const [OWNER, NAME] = REPO.split("/");
const gh = new GitHub({ apiUrl: cfg.str("api_url", "https://api.github.com"), repo: REPO, token: secret("GITHUB_TOKEN") });
const OWNER_LOGIN = secret("GITHUB_OWNER");

/**
 * Decides what to do for a PR.
 * The cursor is not "which comment" but "everything newer than my last ack" —
 * so two rapid comments are forwarded together rather than the second being lost.
 */
export function decide({ comments, commits, now, ackText, owner, staleMs }) {
  const lastAck = [...comments].reverse().find((c) => c.body?.startsWith(ackText));
  const lastComment = comments.at(-1);
  if (!lastComment) return { action: "nothing" };

  if (lastComment.body?.startsWith(ackText)) {
    // Handed off. Only pick up again if the newsroom appears to have abandoned it.
    const age = now - Date.parse(lastAck.created_at);
    const commitAfter = commits.some((c) => Date.parse(c.commit.author.date) > Date.parse(lastAck.created_at));
    if (age > staleMs && !commitAfter) return { action: "retry", since: lastAck.created_at };
    return { action: "nothing" };
  }

  const since = lastAck ? Date.parse(lastAck.created_at) : 0;
  const newComments = comments.filter((c) => Date.parse(c.created_at) > since && c.user?.login === owner);
  return newComments.length ? { action: "handoff", comments: newComments } : { action: "nothing" };
}

/**
 * Reads the published article back from the PR branch: `blogagent.yaml` — the
 * document's own truth (slug, plot, image_names, …) — and its images. No slug is
 * derived; the file simply names itself. This is handed to the pipeline verbatim
 * so each stage sees the fields it wrote and decides for itself.
 */
async function readArticle(pull) {
  const files = await gh.listPullFiles(pull.number);
  const metaFile = files.find((f) => f.filename.endsWith("/blogagent.yaml") && f.status !== "removed");
  if (!metaFile) return { doc: null, media: [] };

  const ref = pull.head.ref;
  const dir = metaFile.filename.slice(0, -"blogagent.yaml".length); // keeps the trailing slash
  const doc = parse((await gh.getContent(metaFile.filename, ref)).toString("utf8"));

  const media = [];
  for (const name of doc?.image_names ?? []) {
    const bytes = await gh.getContent(`${dir}${name}`, ref);
    media.push({ kind: "image", mime: "image/webp", data: bytes.toString("base64") });
  }
  return { doc, media };
}

async function checkPull(pull) {
  const [comments, commits] = await Promise.all([gh.listComments(pull.number), gh.listCommits(pull.number)]);

  const decision = decide({
    comments,
    commits,
    now: Date.now(),
    ackText: ACK_TEXT,
    owner: OWNER_LOGIN,
    staleMs: STALE_MS,
  });
  if (decision.action === "nothing") return;

  const text =
    decision.action === "retry"
      ? comments.filter((c) => c.user?.login === OWNER_LOGIN).at(-1)?.body
      : decision.comments.map((c) => c.body).join("\n\n");
  if (!text?.trim()) return;

  // The article as it stands, plus the comment history (minus our own acks) as review.
  const { doc, media } = await readArticle(pull);
  const review = comments
    .filter((c) => !c.body?.startsWith(ACK_TEXT))
    .map((c) => ({ author: c.user?.login, body: c.body, at: c.created_at }));

  const envelope = makeEnvelope({
    source: "github",
    source_ref: `pr:${pull.number}`,
    text,
    media,
    revises: formatRef(OWNER, NAME, pull.number),
    doc,
    review,
  });

  const response = await fetch(OUT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(envelope),
  });
  if (!response.ok) throw new Error(`newsroom ${response.status}: ${await response.text()}`);

  if (decision.action === "handoff") await gh.addComment(pull.number, ACK_TEXT);
  console.log(`[source-github] PR #${pull.number} ${decision.action}`);
}

async function poll() {
  const pulls = await gh.listPullsByLabel();
  for (const pull of pulls) {
    if (!pull.labels?.some((l) => l.name === LABEL)) continue;
    try {
      await checkPull(pull);
    } catch (err) {
      console.error(`[source-github] PR #${pull.number}: ${err.message}`);
    }
  }
}

if (process.argv[1]?.endsWith("index.js")) {
  console.log(`[source-github] ${REPO}, label '${LABEL}', every ${POLL_MS / 1000}s`);
  while (true) {
    await poll().catch((err) => console.error(`[source-github] ${err.message}`));
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}
