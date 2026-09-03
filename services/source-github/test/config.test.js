import { test } from "node:test";
import assert from "node:assert/strict";
import { buildConfig, assertSecrets } from "../config.js";

/** Minimal settings.yaml shape source-github reads: its own section + sink-github's label. */
function fakeSettings(overrides = {}) {
  return {
    "source-github": {
      repo: "freegroup/CampingElectricCalculator",
      out: "http://127.0.0.1:5080/pitches",
      poll_seconds: 30,
      ack_stale_min: 10,
      ack_text: "→ ACK-TEXT",
      reject_text: "→ REJECT-TEXT",
      ...overrides,
    },
    "sink-github": { label: "blogagent" },
  };
}

test("buildConfig turns settings + env into static vars", () => {
  const c = buildConfig(fakeSettings(), { GITHUB_TOKEN: "tok", GITHUB_OWNER: "freegroup" });

  assert.equal(c.repo, "freegroup/CampingElectricCalculator");
  assert.equal(c.owner, "freegroup", "owner is the repo owner, for formatRef");
  assert.equal(c.name, "CampingElectricCalculator");
  assert.equal(c.out, "http://127.0.0.1:5080/pitches");
  assert.equal(c.pollMs, 30_000, "poll_seconds → ms");
  assert.equal(c.staleMs, 10 * 60_000, "ack_stale_min → ms");
  assert.equal(c.githubToken, "tok");
  assert.equal(c.githubOwner, "freegroup", "the comment-author login we act on");
  assert.equal(c.ackText, "→ ACK-TEXT", "read from settings.yaml, never hard-coded");
  assert.equal(c.rejectText, "→ REJECT-TEXT", "read from settings.yaml, never hard-coded");
});

test("buildConfig applies defaults for optional keys", () => {
  const c = buildConfig(fakeSettings({ poll_seconds: undefined, ack_stale_min: undefined }), {});
  assert.equal(c.pollMs, 60_000);
  assert.equal(c.staleMs, 15 * 60_000);
  assert.equal(c.apiUrl, "https://api.github.com");
});

test("buildConfig never throws on missing secrets — importing this module for a test is safe", () => {
  const c = buildConfig(fakeSettings(), {});
  assert.equal(c.githubToken, "", "missing env reads as empty, not a throw");
  assert.equal(c.githubOwner, "");
});

test("assertSecrets fails fast and names the missing variable", () => {
  const c = buildConfig(fakeSettings(), { GITHUB_TOKEN: "tok" });
  assert.throws(() => assertSecrets(c), /GITHUB_OWNER missing/);

  const ok = buildConfig(fakeSettings(), { GITHUB_TOKEN: "tok", GITHUB_OWNER: "freegroup" });
  assert.doesNotThrow(() => assertSecrets(ok));
});
