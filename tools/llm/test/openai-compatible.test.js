import { test } from "node:test";
import assert from "node:assert/strict";
import { OpenAiCompatibleLlm } from "../openai-compatible.js";

/**
 * Gemini 3 attaches a `thought_signature` to each tool call and rejects the
 * follow-up turn unless it comes back verbatim on the same call. The adapter
 * therefore carries `extra_content` through untouched: out of the response onto
 * the canonical tool_use block, and back into the request when that block is
 * replayed. These tests pin both halves with a fake transport.
 */

const SIG = { google: { thought_signature: "Ep4FCpsF-signature-blob" } };

function fakeFetchOnce(response) {
  const calls = [];
  const fake = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, json: async () => response };
  };
  return { fake, calls };
}

test("carries extra_content off a tool call onto the canonical block", async () => {
  const llm = new OpenAiCompatibleLlm({ baseUrl: "https://api.test/v1", model: "m", maxTokens: 100, apiKey: "k" });
  const { fake } = fakeFetchOnce({
    choices: [{ message: { content: "", tool_calls: [{ id: "call_1", type: "function", extra_content: SIG, function: { name: "wire_cross_section", arguments: '{"ampere":40}' } }] } }],
  });
  const { fetch: real } = globalThis;
  globalThis.fetch = fake;
  let reply;
  try {
    reply = await llm.complete({ system: "s", messages: [{ role: "user", content: [{ type: "text", text: "rechne" }] }], tools: [] });
  } finally {
    globalThis.fetch = real;
  }
  assert.equal(reply.stopReason, "tool_use");
  assert.deepEqual(reply.toolCalls[0].extraContent, SIG, "thought signature captured");
});

test("echoes extra_content back when the tool_use block is replayed", async () => {
  const llm = new OpenAiCompatibleLlm({ baseUrl: "https://api.test/v1", model: "m", maxTokens: 100, apiKey: "k" });
  const { fake, calls } = fakeFetchOnce({ choices: [{ message: { content: "6 mm²" } }] });
  const messages = [
    { role: "user", content: [{ type: "text", text: "rechne" }] },
    { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "wire_cross_section", input: { ampere: 40 }, extraContent: SIG }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "6 mm²" }] },
  ];
  const { fetch: real } = globalThis;
  globalThis.fetch = fake;
  try {
    await llm.complete({ system: "s", messages, tools: [] });
  } finally {
    globalThis.fetch = real;
  }
  const sent = calls[0].body.messages.find((m) => m.role === "assistant");
  assert.deepEqual(sent.tool_calls[0].extra_content, SIG, "thought signature sent back on the same tool call");
});

test("omits extra_content entirely when a backend never sent one", async () => {
  const llm = new OpenAiCompatibleLlm({ baseUrl: "https://api.test/v1", model: "m", maxTokens: 100, apiKey: "k" });
  const { fake, calls } = fakeFetchOnce({ choices: [{ message: { content: "done" } }] });
  const messages = [
    { role: "assistant", content: [{ type: "tool_use", id: "c", name: "t", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "c", content: "x" }] },
  ];
  const { fetch: real } = globalThis;
  globalThis.fetch = fake;
  try {
    await llm.complete({ system: "s", messages, tools: [] });
  } finally {
    globalThis.fetch = real;
  }
  const sent = calls[0].body.messages.find((m) => m.role === "assistant");
  assert.ok(!("extra_content" in sent.tool_calls[0]), "no empty extra_content key leaks");
});
