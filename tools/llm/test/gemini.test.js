import { test } from "node:test";
import assert from "node:assert/strict";
import { createLlm } from "../index.js";
import { OpenAiCompatibleLlm } from "../openai-compatible.js";
import { AnthropicLlm } from "../anthropic.js";

/**
 * Gemini has no adapter of its own: it speaks the OpenAI protocol, so the
 * factory points the OpenAI-compatible adapter at Google's endpoint. What these
 * tests pin is that wiring — the default endpoint and model, and that the key
 * comes from GEMINI_API_KEY (the same key the image generator uses).
 */

const cfg = (over = {}) => ({
  str: (k, d) => over[k] ?? d ?? "",
  num: (k, d) => over[k] ?? d,
});

test("createLlm builds gemini on the OpenAI-compatible adapter with sane defaults", async () => {
  const prev = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "secret-gemini";
  let llm;
  try {
    llm = await createLlm(cfg({ provider: "gemini" }));
  } finally {
    if (prev === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prev;
  }
  assert.ok(llm instanceof OpenAiCompatibleLlm);
  assert.equal(llm.baseUrl, "https://generativelanguage.googleapis.com/v1beta/openai");
  assert.equal(llm.model, "gemini-flash-latest");
  assert.equal(llm.apiKey, "secret-gemini");
});

test("a configured model and base_url win over the gemini defaults", async () => {
  const llm = await createLlm(cfg({ provider: "gemini", model: "gemini-2.5-flash-lite", base_url: "https://proxy/openai" }));
  assert.equal(llm.model, "gemini-2.5-flash-lite");
  assert.equal(llm.baseUrl, "https://proxy/openai");
});

test("createLlm still builds the anthropic default and rejects the unknown", async () => {
  const llm = await createLlm(cfg());
  assert.ok(llm instanceof AnthropicLlm, "provider defaults to anthropic");
  await assert.rejects(createLlm(cfg({ provider: "acme" })), /Unknown LLM provider: acme/);
});
