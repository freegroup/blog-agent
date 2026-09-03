import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadBriefings } from "../briefings.js";

/** Write briefing files into a throwaway dir and load them; cleaned up via t.after. */
function withBriefings(t, files) {
  const dir = mkdtempSync(path.join(tmpdir(), "briefings-"));
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, name), body);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return loadBriefings(dir);
}

test("frontmatter is exposed verbatim, including keys the newsroom does not map (e.g. account)", (t) => {
  const [b] = withBriefings(t, {
    "instagram-camper.md": `---
name: instagram-camper
target-sink: http://127.0.0.1:5087/publish
account: camper
when: only for camper insta
---
Body text is the prompt, not part of the frontmatter.`,
  });

  assert.equal(b.name, "instagram-camper");
  assert.equal(b.targetSink, "http://127.0.0.1:5087/publish");
  // The whole parsed frontmatter rides along so a sink can read its own keys.
  assert.equal(b.frontmatter.account, "camper", "a sink-specific key survives to the payload");
  assert.equal(b.frontmatter.name, "instagram-camper");
  assert.equal(b.frontmatter["target-sink"], "http://127.0.0.1:5087/publish");
  assert.ok(!("body" in b.frontmatter), "the prompt body is not part of the frontmatter");
});

test("frontmatter has no account key when the briefing declares none", (t) => {
  const [b] = withBriefings(t, {
    "camper-blog.md": `---
name: camper-blog
target-sink: http://127.0.0.1:5081/publish
---
Body.`,
  });
  assert.equal(b.frontmatter.account, undefined, "sink then falls back to its default account");
});
