import { loadSettings, section } from "@blogagent/config";

/**
 * newsroom's configuration in one place. index.js reads from here — never from
 * process.env or loadSettings directly.
 *
 * `buildConfig` is pure (settings in, config out) so it is unit-testable with a fake
 * settings object; `config` is the live instance the running service uses as static
 * vars.
 *
 * Two fields carry structured settings rather than scalars, because their consumers
 * are themselves settings-driven sub-assemblers, not env readers:
 *  - `mcpServers` — the top-level `mcp` map handed to connectMany (the tool servers).
 *  - `settings` — the whole parsed document, handed to buildPipeline, which reads
 *    llm-profiles, the stage list, and the image profile off it. Keeping loadSettings
 *    in this one module (not the pipeline builder) is the point: the pipeline receives
 *    its settings, it does not fetch them.
 */
export function buildConfig(settings) {
  const cfg = section(settings, "newsroom");
  return {
    port: cfg.num("port", 5080),
    retentionH: cfg.num("retention_h", 24),
    maxAttempts: cfg.num("max_attempts", 3),
    // Grows with each attempt: 30 s, then 60 s, then 90 s.
    retryPauseMs: cfg.num("retry_pause_s", 30) * 1000,
    briefingsDir: cfg.str("briefings_dir", "./briefings"),
    queueDir: cfg.str("queue_dir", "./var/queue"),
    // The mcp-telegram command: the newsroom reports its dispatch decision over
    // Telegram, reached only through that one token-holding process.
    mcp: cfg.str("mcp", "node services/mcp-telegram/index.js"),
    // The dispatcher's LLM profile — a settings choice like any stage's.
    dispatchLlmProfile: settings.newsroom?.dispatch?.llm ?? "default",
    // The tool servers offered to the pipeline's model (mcp-calc, …). May be empty.
    mcpServers: settings.mcp ?? {},
    settings,
  };
}

export const config = buildConfig(loadSettings());
