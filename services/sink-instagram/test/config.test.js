import { test } from "node:test";
import assert from "node:assert/strict";
import { buildConfig } from "../config.js";

/** Minimal settings.yaml shape sink-instagram reads: its own section. */
function fakeSettings(overrides = {}) {
  return {
    "sink-instagram": {
      port: 5087,
      github_repo: "freegroup/CampingElectricCalculator",
      ...overrides,
    },
  };
}

test("buildConfig turns settings + env into static vars", () => {
  const c = buildConfig(fakeSettings({ github_branch: "custom-assets", default_link: "https://example.test" }), {
    INSTAGRAM_APP_ID: "app",
    INSTAGRAM_APP_SECRET: "sec",
    GITHUB_TOKEN: "tok",
    INSTAGRAM_ACCESS_TOKEN: "atok",
    INSTAGRAM_TOKEN_EXPIRES_AT: "1700000000",
    INSTAGRAM_USER_ID: "42",
  });

  assert.equal(c.port, 5087);
  assert.equal(c.githubRepo, "freegroup/CampingElectricCalculator");
  assert.equal(c.githubBranch, "custom-assets");
  assert.equal(c.defaultLink, "https://example.test");
  assert.equal(c.appId, "app");
  assert.equal(c.appSecret, "sec");
  assert.equal(c.githubToken, "tok");
  assert.equal(c.initialAccessToken, "atok");
  assert.equal(c.initialTokenExpiresAt, 1_700_000_000, "env string → number");
  assert.equal(c.initialUserId, "42");
});

test("buildConfig applies defaults for optional keys", () => {
  const c = buildConfig(fakeSettings(), {});
  assert.equal(c.apiUrl, "https://graph.instagram.com");
  assert.equal(c.githubBranch, "instagram-assets", "the default assets branch lives in config, not github-assets.js");
  assert.equal(c.defaultLink, "");
  assert.equal(c.redirectUri, "http://localhost:5087/oauth/callback");
});

test("static UPPERCASE constants are baked in, not read from settings", () => {
  const c = buildConfig(fakeSettings(), {});
  assert.equal(c.OAUTH_AUTHORIZE, "https://www.instagram.com/oauth/authorize");
  assert.equal(c.OAUTH_TOKEN, "https://api.instagram.com/oauth/access_token");
  assert.equal(c.GITHUB_API, "https://api.github.com");
  assert.deepEqual(c.SCOPES, ["instagram_business_basic", "instagram_business_content_publish"]);
  assert.equal(c.ENV_PATH, ".env");
  assert.equal(c.CAPTION_MAX, 2200);
  assert.equal(c.REFRESH_THRESHOLD_S, 7 * 24 * 3600);
});

test("buildConfig never throws on missing secrets — importing this module for a test is safe", () => {
  const c = buildConfig(fakeSettings(), {});
  assert.equal(c.appId, "");
  assert.equal(c.appSecret, "");
  assert.equal(c.githubToken, "");
  assert.equal(c.initialAccessToken, "");
  assert.equal(c.initialTokenExpiresAt, 0, "unset expiry reads as 0 (unknown), not NaN");
  assert.equal(c.initialUserId, "");
});
