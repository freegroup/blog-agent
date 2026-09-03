import { loadSettings, section } from "@blogagent/config";

/**
 * source-telegram's configuration in one place. index.js reads from here — never
 * from process.env or loadSettings directly. `buildConfig` is pure (settings in,
 * config out) so it is unit-testable with a fake settings object; `config` is the
 * live instance the running service uses as static vars.
 *
 * `stt` and `llm` are prepared section accessors, not scalars — createStt/createLlm
 * read their own keys off them. Which model tidies the request is therefore a
 * settings choice like every other LLM use, resolved here once.
 */
export function buildConfig(settings) {
  const cfg = section(settings, "source-telegram");
  return {
    pollMs: cfg.num("poll_seconds", 5) * 1000,
    // Where a fresh pitch goes next. Required, and normally the research filter
    // (which enriches and forwards to the newsroom) — but it is just a URL, so this
    // source can also point straight at the newsroom, or at any other filter.
    out: cfg.str("out"),
    // The mcp-telegram command: this source polls Telegram only through that one
    // token-holding process. Just a spawn command, so it stays in settings.
    mcp: cfg.str("mcp", "node services/mcp-telegram/index.js"),
    stt: section(settings, "stt"),
    llm: section(settings, `llm-profiles.${cfg.str("llm")}`),
  };
}

export const config = buildConfig(loadSettings());
