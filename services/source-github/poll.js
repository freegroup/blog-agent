import { parse } from "yaml";
import { makeEnvelope, formatRef, forwardEnvelope } from "@blogagent/envelope";

/**
 * The return channel's logic. Polls PRs with the label and submits owner comments
 * as a new pitch — with `revises`, so the newsroom revises rather than writing from
 * scratch.
 *
 * State lives in GitHub, not locally, and is determined by comment order: if the
 * last comment is mine, the case has been handed off. This means the service is
 * immediately up to date after any restart.
 *
 * Everything here is import-testable: `decide` is pure, and `makePoll` closes over
 * its dependencies (a GitHub client, settings) so a test can drive it with fakes.
 * index.js only reads settings and runs the loop.
 */

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
 * Build the poll routine bound to its dependencies. `gh` is a GitHub client;
 * `out` is the newsroom's pitch URL; the rest are the configured values decide()
 * needs.
 */
export function makePoll({ gh, out, ackText, ownerLogin, staleMs, label, owner, name }) {
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
    for (const n of doc?.image_names ?? []) {
      const bytes = await gh.getContent(`${dir}${n}`, ref);
      media.push({ kind: "image", mime: "image/webp", data: bytes.toString("base64") });
    }
    return { doc, media };
  }

  async function checkPull(pull) {
    const [comments, commits] = await Promise.all([gh.listComments(pull.number), gh.listCommits(pull.number)]);

    const decision = decide({ comments, commits, now: Date.now(), ackText, owner: ownerLogin, staleMs });
    if (decision.action === "nothing") return;

    const text =
      decision.action === "retry"
        ? comments.filter((c) => c.user?.login === ownerLogin).at(-1)?.body
        : decision.comments.map((c) => c.body).join("\n\n");
    if (!text?.trim()) return;

    // The article as it stands, plus the comment history (minus our own acks) as review.
    const { doc, media } = await readArticle(pull);
    const review = comments
      .filter((c) => !c.body?.startsWith(ackText))
      .map((c) => ({ author: c.user?.login, body: c.body, at: c.created_at }));

    const envelope = makeEnvelope({
      source: "github",
      source_ref: `pr:${pull.number}`,
      text,
      media,
      revises: formatRef(owner, name, pull.number),
      doc,
      review,
    });

    await forwardEnvelope(envelope, out);

    if (decision.action === "handoff") await gh.addComment(pull.number, ackText);
    console.log(`[source-github] PR #${pull.number} ${decision.action}`);
  }

  return async function poll() {
    const pulls = await gh.listPullsByLabel();
    for (const pull of pulls) {
      if (!pull.labels?.some((l) => l.name === label)) continue;
      try {
        await checkPull(pull);
      } catch (err) {
        console.error(`[source-github] PR #${pull.number}: ${err.message}`);
      }
    }
  };
}
