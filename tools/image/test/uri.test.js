import { test } from "node:test";
import assert from "node:assert/strict";
import { buildImageUri, getImageData, getImageMimeType } from "../index.js";

const B64 = "iVBORw0KGgoAAAANSUhEUg=="; // arbitrary base64-looking bytes

test("buildImageUri builds the canonical data URI", () => {
  assert.equal(buildImageUri("image/jpeg", B64), `data:image/jpeg;base64,${B64}`);
});

test("build → read round-trips mime and bytes", () => {
  const uri = buildImageUri("image/webp", B64);
  assert.equal(getImageMimeType(uri), "image/webp");
  assert.equal(getImageData(uri), B64);
});

test("the helpers accept a media item, reading its `data`", () => {
  const item = { kind: "image", source: "user", data: buildImageUri("image/png", B64) };
  assert.equal(getImageMimeType(item), "image/png");
  assert.equal(getImageData(item), B64);
});

test("a bare base64 string (legacy) is tolerated", () => {
  assert.equal(getImageData(B64), B64, "returned unchanged, no data: prefix to strip");
  assert.equal(getImageMimeType(B64), "image/webp", "falls back to the pipeline's WebP");
});

test("empty / missing input does not throw", () => {
  assert.equal(getImageData(undefined), "");
  assert.equal(getImageData({}), "");
  assert.equal(getImageMimeType(undefined), "image/webp");
});

test("getImageData keeps base64 that itself contains no comma boundary intact", () => {
  // A data URI's payload may contain '+' '/' '=' but the split is only on the first
  // ";base64," marker — the rest is the payload verbatim.
  const payload = "AAAA+BBB/CCC==";
  assert.equal(getImageData(buildImageUri("image/gif", payload)), payload);
});
