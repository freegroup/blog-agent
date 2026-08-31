import Anthropic from "@anthropic-ai/sdk";
import { LlmProvider } from "./index.js";

/**
 * Anthropic via the official SDK. The canonical block format maps almost
 * 1:1 to the wire format — only `image` needs to be remapped.
 */
export class AnthropicLlm extends LlmProvider {
  constructor({ model, maxTokens } = {}) {
    super();
    this.model = model;
    this.maxTokens = maxTokens;
    // The SDK picks up ANTHROPIC_API_KEY (and, if set, ANTHROPIC_BASE_URL) from
    // the environment.
    this.client = new Anthropic();
  }

  async complete({ system, messages, tools = [], maxTokens }) {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: maxTokens ?? this.maxTokens,
      system,
      messages: messages.map(toAnthropicMessage),
      ...(tools.length
        ? {
            tools: tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.inputSchema,
            })),
          }
        : {}),
    });

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    const toolCalls = response.content
      .filter((b) => b.type === "tool_use")
      .map((b) => ({ type: "tool_use", id: b.id, name: b.name, input: b.input }));

    return {
      text,
      toolCalls,
      stopReason: response.stop_reason === "tool_use" ? "tool_use" : "end",
      raw: response,
    };
  }
}

function toAnthropicMessage(message) {
  return {
    role: message.role,
    content: message.content.map((block) => {
      if (block.type === "image") {
        return {
          type: "image",
          source: { type: "base64", media_type: block.mime, data: block.data },
        };
      }
      return block;
    }),
  };
}
