import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMedia, freshMedia, firstLine, discoverAccounts } from "../media.js";

// A trimmed /me/media payload as the Instagram graph host returns it (newest-first).
const PAYLOAD = {
  data: [
    {
      id: "17918970999222559",
      permalink: "https://www.instagram.com/p/DAbc123/",
      caption: "Reihe oder parallel?\n\nWas braucht dein Camper-Solar?\nhttps://camper-elektrik-planer.de/",
      timestamp: "2026-09-03T16:13:05+0000",
    },
    {
      id: "17911111111111111",
      permalink: "https://www.instagram.com/p/DAxy789/",
      timestamp: "2026-09-01T09:00:00+0000",
    },
  ],
};

test("parseMedia keeps id, permalink, caption and timestamp of each post", () => {
  const items = parseMedia(PAYLOAD);
  assert.equal(items.length, 2);
  assert.equal(items[0].id, "17918970999222559");
  assert.equal(items[0].permalink, "https://www.instagram.com/p/DAbc123/");
  assert.equal(items[1].caption, "", "a post without a caption reads as empty, not undefined");
});

test("parseMedia tolerates an empty or shapeless payload", () => {
  assert.deepEqual(parseMedia({}), []);
  assert.deepEqual(parseMedia({ data: [{ permalink: "no id → dropped" }] }), []);
});

test("freshMedia returns only what the seen-set does not contain", () => {
  const items = parseMedia(PAYLOAD);
  const seen = new Set([items[0].id]);
  assert.deepEqual(
    freshMedia(items, seen).map((i) => i.id),
    [items[1].id],
    "only the unseen post is fresh",
  );
  assert.deepEqual(freshMedia(items, new Set(items.map((i) => i.id))), [], "nothing new once all are seen");
});

test("firstLine takes the caption's first non-empty line (the title)", () => {
  assert.equal(firstLine("Reihe oder parallel?\n\nmehr Text"), "Reihe oder parallel?");
  assert.equal(firstLine("\n\n  gepolstert  \nzweite"), "gepolstert", "leading blank lines are skipped and it trims");
  assert.equal(firstLine(""), "(ohne Text)");
  assert.equal(firstLine(undefined), "(ohne Text)");
});

test("discoverAccounts finds each INSTAGRAM_*ACCESS_TOKEN, labels default vs named, ignores other vars", () => {
  const env = [
    "INSTAGRAM_APP_ID=app",
    "INSTAGRAM_ACCESS_TOKEN=legacy",
    "INSTAGRAM_CAMPER_ACCESS_TOKEN=camtok",
    "INSTAGRAM_3DPRINT_ACCESS_TOKEN=dtok",
    "INSTAGRAM_USER_ID=42",
    "GITHUB_TOKEN=g",
  ].join("\n");
  const got = discoverAccounts(env).sort((a, b) => a.label.localeCompare(b.label));
  assert.deepEqual(got, [
    { label: "3dprint", token: "dtok" },
    { label: "camper", token: "camtok" },
    { label: "default", token: "legacy" },
  ]);
});

test("discoverAccounts dedups a token shared by two vars, preferring the named account", () => {
  const env = "INSTAGRAM_ACCESS_TOKEN=same\nINSTAGRAM_CAMPER_ACCESS_TOKEN=same";
  assert.deepEqual(discoverAccounts(env), [{ label: "camper", token: "same" }]);
});

test("discoverAccounts skips blank tokens and non-token INSTAGRAM_* vars", () => {
  assert.deepEqual(discoverAccounts("INSTAGRAM_APP_SECRET=x\nINSTAGRAM_ACCESS_TOKEN=\n"), []);
});
