import { test } from "node:test";
import assert from "node:assert/strict";
import { buildConfig, assertSecrets } from "../config.js";

test("buildConfig derives the API base URLs from the token", () => {
  const c = buildConfig({ TELEGRAM_BOT_TOKEN: "123:abc", TELEGRAM_CHAT_ID: "42" });
  assert.equal(c.token, "123:abc");
  assert.equal(c.chatId, "42");
  assert.equal(c.api, "https://api.telegram.org/bot123:abc");
  assert.equal(c.files, "https://api.telegram.org/file/bot123:abc");
});

test("buildConfig never throws on missing env — importing this module for a test (or chat-id.js) is safe", () => {
  const c = buildConfig({});
  assert.equal(c.token, "");
  assert.equal(c.chatId, "");
  // The URLs still build (with an empty token) rather than throwing on a plain read.
  assert.equal(c.api, "https://api.telegram.org/bot");
});

test("assertSecrets fails fast and names each missing variable", () => {
  assert.throws(() => assertSecrets(buildConfig({})), /TELEGRAM_BOT_TOKEN missing/);
  assert.throws(() => assertSecrets(buildConfig({ TELEGRAM_BOT_TOKEN: "t" })), /TELEGRAM_CHAT_ID missing/);
  assert.doesNotThrow(() => assertSecrets(buildConfig({ TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "1" })));
});
