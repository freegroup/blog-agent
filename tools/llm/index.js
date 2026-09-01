/**
 * LLM abstraction.
 *
 * The newsroom knows only this interface and runs the tool loop itself —
 * adapters only translate back and forth and stay thin.
 *
 * The canonical form follows Anthropic (the richest of the three); adapters that
 * support less fold content down during translation.
 *
 * @typedef {{type:'text', text:string}} TextBlock
 * @typedef {{type:'image', mime:string, data:string}} ImageBlock          data = base64
 * @typedef {{type:'tool_use', id:string, name:string, input:object}} ToolUseBlock
 * @typedef {{type:'tool_result', tool_use_id:string, content:string, is_error?:boolean}} ToolResultBlock
 * @typedef {TextBlock|ImageBlock|ToolUseBlock|ToolResultBlock} Block
 * @typedef {{role:'user'|'assistant', content:Block[]}} Message
 * @typedef {{name:string, description:string, inputSchema:object}} ToolDef
 * @typedef {{text:string, toolCalls:ToolUseBlock[], stopReason:'end'|'tool_use', raw?:unknown}} Reply
 */

/** @abstract */
export class LlmProvider {
  /**
   * @param {{system:string, messages:Message[], tools?:ToolDef[], maxTokens?:number}} _req
   * @returns {Promise<Reply>}
   */
  async complete(_req) {
    throw new Error("complete() not implemented");
  }
}

/** Builds the configured adapter. New providers are added here. */
export async function createLlm(cfg) {
  const provider = cfg.str("provider", "anthropic");

  if (provider === "anthropic") {
    const { AnthropicLlm } = await import("./anthropic.js");
    return new AnthropicLlm({
      model: cfg.str("model", "claude-opus-5"),
      maxTokens: cfg.num("max_tokens", 16000),
    });
  }

  if (provider === "openai-compatible") {
    const { OpenAiCompatibleLlm } = await import("./openai-compatible.js");
    return new OpenAiCompatibleLlm({
      baseUrl: cfg.str("base_url"),
      model: cfg.str("model"),
      maxTokens: cfg.num("max_tokens", 16000),
      apiKey: process.env.LLM_API_KEY ?? "not-needed",
      // 5 attempts past the first, with fetchWithRetry's exponential backoff
      // (1s, 2s, 4s, 8s, 16s) — the provider's 503s under load are transient.
      retries: cfg.num("retries", 5),
    });
  }

  if (provider === "gemini") {
    // Google's Gemini speaks the OpenAI protocol, so the same adapter carries it —
    // only the default endpoint and the key differ. One GEMINI_API_KEY serves both
    // the text stages and the illustrate stage's image generator.
    const { OpenAiCompatibleLlm } = await import("./openai-compatible.js");
    return new OpenAiCompatibleLlm({
      baseUrl: cfg.str("base_url", "https://generativelanguage.googleapis.com/v1beta/openai"),
      model: cfg.str("model", "gemini-flash-latest"),
      maxTokens: cfg.num("max_tokens", 16000),
      apiKey: process.env.GEMINI_API_KEY ?? "not-needed",
      // Gemini is chronically overloaded (503) under load; give it 5 retries with
      // exponential backoff (1s, 2s, 4s, 8s, 16s) before giving up.
      retries: cfg.num("retries", 5),
    });
  }

  throw new Error(`Unknown LLM provider: ${provider}`);
}
