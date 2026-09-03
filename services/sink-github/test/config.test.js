import { test } from "node:test";
import assert from "node:assert/strict";
import { buildConfig, assertSecrets } from "../config.js";

/** Minimal settings.yaml shape sink-github reads: its own section. */
function fakeSettings(overrides = {}) {
  return {
    "sink-github": {
      repo: "freegroup/CampingElectricCalculator",
      content_path: "content/blog/{slug}/index.md",
      asset_path: "content/blog/{slug}/{name}",
      ...overrides,
    },
  };
}

test("buildConfig splits the repo into owner and name and reads the token from env", () => {
  const c = buildConfig(fakeSettings(), { GITHUB_TOKEN: "tok" });
  assert.equal(c.repo, "freegroup/CampingElectricCalculator");
  assert.equal(c.owner, "freegroup");
  assert.equal(c.name, "CampingElectricCalculator");
  assert.equal(c.contentPath, "content/blog/{slug}/index.md");
  assert.equal(c.assetPath, "content/blog/{slug}/{name}");
  assert.equal(c.githubToken, "tok");
});

test("buildConfig applies defaults for optional keys", () => {
  const c = buildConfig(fakeSettings(), {});
  assert.equal(c.port, 5081);
  assert.equal(c.baseBranch, "main");
  assert.equal(c.label, "blogagent");
  assert.equal(c.apiUrl, "https://api.github.com");
  assert.equal(c.metaPath, "");
  assert.equal(c.mcp, "", "no Telegram command by default → silent");
});

test("static UPPERCASE blog-format constants are baked in, not read from settings", () => {
  const c = buildConfig(fakeSettings(), {});
  assert.equal(c.BLOG_WIDTH, 1600);
  assert.equal(c.BLOG_QUALITY, 82);
});

test("buildConfig never throws on a missing token — importing this module for a test is safe", () => {
  const c = buildConfig(fakeSettings(), {});
  assert.equal(c.githubToken, "", "missing env reads as empty, not a throw");
});

test("assertSecrets fails fast and names the missing variable", () => {
  assert.throws(() => assertSecrets(buildConfig(fakeSettings(), {})), /GITHUB_TOKEN missing/);
  assert.doesNotThrow(() => assertSecrets(buildConfig(fakeSettings(), { GITHUB_TOKEN: "tok" })));
});
