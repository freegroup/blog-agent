import { test } from "node:test";
import assert from "node:assert/strict";
import { buildConfig } from "../config.js";

/** Minimal settings.yaml shape sink-pinterest reads: its own section. */
function fakeSettings(overrides = {}) {
  return {
    "sink-pinterest": {
      port: 5088,
      board_id: "123456789",
      ...overrides,
    },
  };
}

test("buildConfig turns settings + env into static vars", () => {
  const c = buildConfig(fakeSettings({ api_url: "https://api-sandbox.pinterest.com" }), {
    PINTEREST_APP_ID: "app",
    PINTEREST_APP_SECRET: "sec",
    PINTEREST_ACCESS_TOKEN: "direct",
    PINTEREST_REFRESH_TOKEN: "refresh",
  });

  assert.equal(c.port, 5088);
  assert.equal(c.boardId, "123456789");
  assert.equal(c.apiUrl, "https://api-sandbox.pinterest.com");
  assert.equal(c.appId, "app");
  assert.equal(c.appSecret, "sec");
  assert.equal(c.directToken, "direct");
  assert.equal(c.initialRefreshToken, "refresh");
});

test("buildConfig applies defaults for optional keys", () => {
  const c = buildConfig(fakeSettings(), {});
  assert.equal(c.apiUrl, "https://api.pinterest.com");
  assert.equal(c.redirectUri, "http://localhost:5088/oauth/callback");
});

test("static UPPERCASE constants are baked in, not read from settings", () => {
  const c = buildConfig(fakeSettings(), {});
  assert.deepEqual(c.SCOPES, ["pins:write", "boards:read"]);
  assert.equal(c.ENV_PATH, ".env");
});

test("buildConfig never throws on missing secrets — importing this module for a test is safe", () => {
  const c = buildConfig(fakeSettings(), {});
  assert.equal(c.appId, "");
  assert.equal(c.appSecret, "");
  assert.equal(c.directToken, "");
  assert.equal(c.initialRefreshToken, "");
});
