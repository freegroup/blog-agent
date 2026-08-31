import { LlmProvider } from "./index.js";
import { whyFetchFailed, fetchWithRetry } from "@blogagent/http";

/**
 * Adapter for anything that speaks /v1/chat/completions:
 * Ollama, liteLLM, vLLM, LM Studio. liteLLM also proxies
 * Gemini, Qwen, and Gemma through it.
 *
 * Deliberate limitation: tool calls are unreliable in small local models.
 * If `tool_calls` is absent the newsroom keeps running without the
 * calculator and must cite its numbers instead — the briefing already requires this.
 */
export class OpenAiCompatibleLlm extends LlmProvider {
  constructor({ baseUrl, model, maxTokens, apiKey, retries, backoffMs }) {
    super();
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.model = model;
    this.maxTokens = maxTokens;
    this.apiKey = apiKey;
    // Retry policy for the one external call. Overridable so tests need not wait
    // out real backoff; production keeps fetchWithRetry's defaults.
    this.retries = retries;
    this.backoffMs = backoffMs;
  }

  async complete({ system, messages, tools = [], maxTokens }) {
    const body = {
      model: this.model,
      max_tokens: maxTokens ?? this.maxTokens,
      messages: [{ role: "system", content: system }, ...messages.flatMap(toOpenAiMessages)],
      ...(tools.length
        ? {
            tools: tools.map((t) => ({
              type: "function",
              function: { name: t.name, description: t.description, parameters: t.inputSchema },
            })),
          }
        : {}),
    };

    const url = `${this.baseUrl}/chat/completions`;
    let response;
    try {
      response = await fetchWithRetry(
        url,
        {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
          body: JSON.stringify(body),
        },
        { label: `LLM ${this.model}`, retries: this.retries, backoffMs: this.backoffMs },
      );
    } catch (err) {
      throw new Error(`LLM unreachable at ${url} (model ${this.model}): ${whyFetchFailed(err)}`);
    }

    if (!response.ok) {
      throw new Error(`LLM ${response.status} from ${url} (model ${this.model}): ${await response.text()}`);
    }

    const json = await response.json();
    const choice = json.choices?.[0];
    const calls = choice?.message?.tool_calls ?? [];

    return {
      text: choice?.message?.content ?? "",
      // Arguments arrive as a string — always parse, never string-match.
      toolCalls: calls.map((c) => ({
        type: "tool_use",
        id: c.id,
        name: c.function.name,
        input: JSON.parse(c.function.arguments || "{}"),
        // Gemini 3 returns a `thought_signature` here and rejects the follow-up
        // turn if it is not echoed back verbatim. Carry the whole `extra_content`
        // through unread; other backends simply never set it.
        ...(c.extra_content ? { extraContent: c.extra_content } : {}),
      })),
      stopReason: calls.length ? "tool_use" : "end",
      raw: json,
    };
  }
}

/**
 * One canonical turn can expand into multiple OpenAI messages: tool results
 * become separate messages with role "tool".
 */
function toOpenAiMessages(message) {
  const results = message.content.filter((b) => b.type === "tool_result");
  if (results.length) {
    return results.map((b) => ({
      role: "tool",
      tool_call_id: b.tool_use_id,
      content: b.content,
    }));
  }

  const calls = message.content.filter((b) => b.type === "tool_use");
  if (calls.length) {
    return [
      {
        role: "assistant",
        content: textOf(message) || null,
        tool_calls: calls.map((b) => ({
          id: b.id,
          type: "function",
          function: { name: b.name, arguments: JSON.stringify(b.input) },
          // Echo Gemini 3's thought signature back on the same tool call, or the
          // follow-up turn is rejected. Absent for backends that never sent one.
          ...(b.extraContent ? { extra_content: b.extraContent } : {}),
        })),
      },
    ];
  }

  const images = message.content.filter((b) => b.type === "image");
  if (images.length) {
    return [
      {
        role: message.role,
        content: [
          ...images.map((b) => ({
            type: "image_url",
            image_url: { url: `data:${b.mime};base64,${b.data}` },
          })),
          { type: "text", text: textOf(message) },
        ],
      },
    ];
  }

  return [{ role: message.role, content: textOf(message) }];
}

function textOf(message) {
  return message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
}
