import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePublish } from "../validate.js";

const OPTS = { maxBildBytes: 2 * 1024 * 1024 };
const IMG = Buffer.from("x".repeat(100)).toString("base64");

function valid(over = {}) {
  return {
    slug: "kabelquerschnitt-wohnmobil",
    title: "Why 2.5 mm² is rarely enough",
    description: "Undersized cables are the most common mistake in camper builds.",
    markdown: "![Wiring](kabel.webp)\n\nText with [calculator](https://camper-elektrik-planer.de/de/).",
    images: [{ name: "kabel.webp", data: IMG }],
    revises: null,
    ...over,
  };
}

test("accepts a valid submission", () => {
  assert.deepEqual(validatePublish(valid(), OPTS), []);
});

test("rejects path traversal in slug", () => {
  const errors = validatePublish(valid({ slug: "../../.github/workflows/deploy" }), OPTS);
  assert.ok(errors.some((e) => e.startsWith("slug")));
});

test("rejects uppercase and slashes in slug", () => {
  for (const slug of ["Kabelquerschnitt", "kabel/quer", "-kabel", "ab"]) {
    assert.ok(validatePublish(valid({ slug }), OPTS).length > 0, `${slug} should have been rejected`);
  }
});

test("rejects path traversal in image name", () => {
  const errors = validatePublish(
    valid({
      markdown: "![x](../../evil.webp)",
      images: [{ name: "../../evil.webp", data: IMG }],
    }),
    OPTS,
  );
  assert.ok(errors.some((e) => e.includes("images[0].name")));
});

test("rejects oversized images", () => {
  const errors = validatePublish(valid(), { maxBildBytes: 10 });
  assert.ok(errors.some((e) => e.includes("limit is 10")));
});

test("detects reference without file", () => {
  const errors = validatePublish(valid({ images: [] }), OPTS);
  assert.ok(errors.some((e) => e.includes("references 'kabel.webp'")));
});

test("detects file without reference", () => {
  const errors = validatePublish(valid({ markdown: "Text without image." }), OPTS);
  assert.ok(errors.some((e) => e.includes("not referenced in markdown")));
});

test("rejects relative links", () => {
  const errors = validatePublish(
    valid({ markdown: "![Wiring](kabel.webp)\n\n[Calculator](/de/kabelquerschnitt-berechnen/)" }),
    OPTS,
  );
  assert.ok(errors.some((e) => e.includes("not absolute")));
});

test("allows anchor links", () => {
  const errors = validatePublish(
    valid({ markdown: "![Wiring](kabel.webp)\n\n[down](#sources)" }),
    OPTS,
  );
  assert.deepEqual(errors, []);
});

test("requires title and description", () => {
  assert.ok(validatePublish(valid({ title: "" }), OPTS).some((e) => e.includes("title")));
  assert.ok(validatePublish(valid({ description: "  " }), OPTS).some((e) => e.includes("description")));
});
