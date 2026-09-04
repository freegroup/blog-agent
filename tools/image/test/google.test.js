import { test } from "node:test";
import assert from "node:assert/strict";
import { createImage, ImageProvider } from "../index.js";
import { GoogleImage } from "../google.js";

/**
 * The provider is a thin translator over one HTTP call. What these tests pin is
 * the wiring: the factory's defaults, and that the adapter pulls the inline
 * base64 image out of the response and hands back raw bytes.
 */

const cfg = (over = {}) => ({
  str: (k, d) => over[k] ?? d ?? "",
  num: (k, d) => over[k] ?? d,
});

test("createImage builds the google provider with sane defaults", async () => {
  const img = await createImage(cfg());
  assert.ok(img instanceof GoogleImage);
  assert.ok(img instanceof ImageProvider);
  assert.equal(img.baseUrl, "https://generativelanguage.googleapis.com/v1beta");
  assert.equal(img.model, "gemini-2.5-flash-image");
});

test("createImage rejects an unknown provider", async () => {
  await assert.rejects(createImage(cfg({ provider: "acme" })), /Unknown image provider: acme/);
});

test("generate posts to :generateContent and returns the inline image bytes", async () => {
  const calls = [];
  const fake = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: Buffer.from("PNGDATA").toString("base64") } }] } }],
      }),
    };
  };

  const img = new GoogleImage({ baseUrl: "https://api.test/v1beta/", model: "m", apiKey: "secret-key" });
  const { fetch: realFetch } = globalThis;
  globalThis.fetch = fake;
  let result;
  try {
    result = await img.generate({ prompt: "a camper van at dusk" });
  } finally {
    globalThis.fetch = realFetch;
  }

  assert.equal(calls[0].url, "https://api.test/v1beta/models/m:generateContent", "trailing slash trimmed, model + method appended");
  assert.equal(calls[0].init.headers["x-goog-api-key"], "secret-key");
  assert.match(calls[0].init.body, /a camper van at dusk/);
  assert.equal(result.bytes.toString(), "PNGDATA");
  assert.equal(result.mime, "image/png");
});

test("generate attaches a source image as an inline part (image-to-image)", async () => {
  const calls = [];
  const fake = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/webp", data: "T0s=" } }] } }] }),
    };
  };
  const img = new GoogleImage({ baseUrl: "https://api.test", model: "m", apiKey: "k" });
  const { fetch: realFetch } = globalThis;
  globalThis.fetch = fake;
  try {
    await img.generate({ prompt: "make it brighter", image: "data:image/jpeg;base64,VVNFUg==" });
  } finally {
    globalThis.fetch = realFetch;
  }
  const body = JSON.parse(calls[0].init.body);
  const parts = body.contents[0].parts;
  assert.equal(parts[0].text, "make it brighter");
  assert.deepEqual(parts[1].inlineData, { mimeType: "image/jpeg", data: "VVNFUg==" }, "the data URI is unpacked into mime + bare base64");
});

test("generate throws when the response carries no image", async () => {
  const img = new GoogleImage({ baseUrl: "https://api.test", model: "m", apiKey: "k" });
  const { fetch: realFetch } = globalThis;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "sorry" }] } }] }) });
  try {
    await assert.rejects(img.generate({ prompt: "x" }), /returned no image/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
