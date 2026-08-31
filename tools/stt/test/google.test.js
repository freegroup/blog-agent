import { test } from "node:test";
import assert from "node:assert/strict";
import { createStt, SttProvider } from "../index.js";
import { GoogleStt } from "../google.js";

/**
 * The provider is a thin translator over one native `:generateContent` call: the
 * audio goes in inline (OGG, not just wav/mp3), the transcript comes back in the
 * candidate's parts. These pin the wiring with a fake transport.
 */

const cfg = (over = {}) => ({
  str: (k, d) => over[k] ?? d ?? "",
  num: (k, d) => over[k] ?? d,
});

test("createStt builds the google provider on the native generateContent endpoint", async () => {
  const stt = await createStt(cfg({ provider: "google" }));
  assert.ok(stt instanceof GoogleStt);
  assert.ok(stt instanceof SttProvider);
  assert.equal(stt.baseUrl, "https://generativelanguage.googleapis.com/v1beta");
  assert.equal(stt.model, "gemini-3.5-flash");
});

test("createStt rejects an unknown provider", async () => {
  await assert.rejects(createStt(cfg({ provider: "acme" })), /Unknown STT provider: acme/);
});

test("transcribe sends the OGG audio inline and returns the transcript", async () => {
  const calls = [];
  const fake = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), key: init.headers["x-goog-api-key"] });
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "  Hallo Welt  " }] } }] }) };
  };

  const stt = new GoogleStt({ baseUrl: "https://api.test/v1beta/", model: "m", language: "de", apiKey: "secret-key" });
  const { fetch: real } = globalThis;
  globalThis.fetch = fake;
  let result;
  try {
    result = await stt.transcribe({ audio: Buffer.from("OGGDATA"), mime: "audio/ogg", language: "de" });
  } finally {
    globalThis.fetch = real;
  }

  assert.equal(calls[0].url, "https://api.test/v1beta/models/m:generateContent", "trailing slash trimmed, model + method appended");
  assert.equal(calls[0].key, "secret-key");
  const parts = calls[0].body.contents[0].parts;
  const audio = parts.find((p) => p.inline_data);
  assert.equal(audio.inline_data.mime_type, "audio/ogg", "the OGG mime is passed through — no transcoding");
  assert.equal(audio.inline_data.data, Buffer.from("OGGDATA").toString("base64"));
  assert.match(parts.find((p) => p.text).text, /Transkribiere/);
  assert.equal(result.text, "Hallo Welt", "transcript trimmed");
});

test("transcribe drops the model's thinking parts and keeps the transcript", async () => {
  const stt = new GoogleStt({ baseUrl: "https://api.test", model: "m", language: "de", apiKey: "k" });
  const { fetch: real } = globalThis;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text: "denk…", thought: true }, { text: "Der Satz." }] } }] }),
  });
  try {
    assert.equal((await stt.transcribe({ audio: Buffer.from("x"), mime: "audio/ogg" })).text, "Der Satz.");
  } finally {
    globalThis.fetch = real;
  }
});

test("transcribe surfaces a non-2xx as a legible error", async () => {
  const stt = new GoogleStt({ baseUrl: "https://api.test", model: "m", language: "de", apiKey: "k" });
  const { fetch: real } = globalThis;
  globalThis.fetch = async () => ({ ok: false, status: 400, text: async () => "bad audio" });
  try {
    await assert.rejects(stt.transcribe({ audio: Buffer.from("x"), mime: "audio/ogg" }), /STT 400 .* bad audio/);
  } finally {
    globalThis.fetch = real;
  }
});
