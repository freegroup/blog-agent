import { test } from "node:test";
import assert from "node:assert/strict";
import { composeMessage, planDelivery, TELEGRAM_LIMIT, TELEGRAM_CAPTION_LIMIT } from "../message.js";

test("composeMessage builds a plain-text notification from the article", () => {
  const text = composeMessage({
    slug: "kabelquerschnitt",
    title: "Zu dünnes Kabel?",
    description: "Woran du es erkennst.",
    markdown: "Das ist der Artikel.",
  });
  assert.match(text, /^✅ Neuer Artikel/);
  assert.ok(text.includes("Zu dünnes Kabel?"));
  assert.ok(text.includes("Woran du es erkennst."));
  assert.ok(text.includes("Das ist der Artikel."));
});

test("composeMessage marks a revision differently", () => {
  const text = composeMessage({ title: "T", markdown: "x", revises: "github:foo/bar#7" });
  assert.match(text, /^✏️ Artikel aktualisiert/);
});

test("composeMessage skips empty fields", () => {
  const text = composeMessage({ title: "Nur Titel", description: "  ", markdown: "" });
  assert.equal(text, "✅ Neuer Artikel\n\nNur Titel");
});

test("composeMessage truncates to Telegram's limit with a visible marker", () => {
  const text = composeMessage({ title: "T", markdown: "a".repeat(5000) });
  assert.ok(text.length <= TELEGRAM_LIMIT);
  assert.ok(text.endsWith("… (gekürzt)"));
});

test("composeMessage strips image placeholders — Telegram has no inline images", () => {
  const text = composeMessage({
    title: "Titel",
    markdown: "Erster Absatz.\n\n![Ein Foto](foto-1.webp)\n\nZweiter Absatz.",
  });
  assert.ok(!text.includes("foto-1.webp"));
  assert.ok(!text.includes("!["));
  assert.ok(text.includes("Erster Absatz."));
  assert.ok(text.includes("Zweiter Absatz."));
  // No blank-line gap left where the placeholder sat.
  assert.ok(!/\n\n\n/.test(text));
});

test("planDelivery: no photos, some text → a single message", () => {
  assert.deepEqual(planDelivery({ text: "hallo", photoCount: 0 }), [{ kind: "message" }]);
});

test("planDelivery: no photos and no text → nothing to send", () => {
  assert.deepEqual(planDelivery({ text: "   ", photoCount: 0 }), []);
});

test("planDelivery: photos + short text → one photo group, text as caption", () => {
  assert.deepEqual(planDelivery({ text: "kurz", photoCount: 2 }), [{ kind: "photos", caption: true }]);
});

test("planDelivery: photos + text too long for a caption → photos first, then the text", () => {
  const text = "a".repeat(TELEGRAM_CAPTION_LIMIT + 1);
  assert.deepEqual(planDelivery({ text, photoCount: 3 }), [
    { kind: "photos", caption: false },
    { kind: "message" },
  ]);
});

test("planDelivery: text exactly at the caption limit still rides as the caption", () => {
  const text = "a".repeat(TELEGRAM_CAPTION_LIMIT);
  assert.deepEqual(planDelivery({ text, photoCount: 1 }), [{ kind: "photos", caption: true }]);
});

test("planDelivery: photos but no text → just the photo group, no caption", () => {
  assert.deepEqual(planDelivery({ text: "", photoCount: 1 }), [{ kind: "photos", caption: false }]);
});
