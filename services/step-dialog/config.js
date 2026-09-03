import { loadSettings, section } from "@blogagent/config";

/**
 * step-dialog's configuration in one place. index.js and handler.js read from
 * here — never from process.env or loadSettings directly. `buildConfig` is pure
 * (settings in, config out) so it is unit-testable with a fake settings object;
 * `config` is the live instance the running service uses as static vars.
 *
 * `llm` is a prepared section accessor, not a scalar — createLlm reads its own
 * keys off it. Which model the meaning-based filters use is therefore a settings
 * choice like every other LLM use, resolved here once.
 */
export function buildConfig(settings) {
  const cfg = section(settings, "step-dialog");
  return {
    // Required, no default — a misconfigured port must fail loudly, not silently
    // bind somewhere unexpected.
    port: cfg.num("port"),
    // Required — where a completed request goes next (normally step-research). A
    // step with nowhere to deliver is a dead end, not a default.
    out: cfg.str("out"),
    // The shared queue directory — the SAME one the newsroom uses. A parked
    // clarification lives here as an `awaiting-reply` entry; the status, not the
    // folder, is what separates it from a real pitch.
    queueDir: cfg.str("queue_dir", "./var/queue"),
    // The mcp-telegram command: step-dialog only ever SENDS (the clarifying
    // question), never polls — two pollers with the same token get a 409.
    mcp: cfg.str("mcp", "node services/mcp-telegram/index.js"),
    llm: section(settings, `llm-profiles.${cfg.str("llm")}`),
  };
}

export const config = buildConfig(loadSettings());
