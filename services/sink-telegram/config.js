import { loadSettings, section } from "@blogagent/config";

/**
 * sink-telegram's configuration in one place. index.js reads from here — never from
 * process.env or loadSettings directly. `buildConfig` is pure (settings in, config
 * out) so it is unit-testable with a fake settings object; `config` is the live
 * instance the running service uses as static vars.
 */
export function buildConfig(settings) {
  const cfg = section(settings, "sink-telegram");
  return {
    // Required, no default — a misconfigured port must fail loudly.
    port: cfg.num("port"),
    // The mcp-telegram command: this sink reaches Telegram only through that one
    // process (the single token holder). Just a spawn command, so it stays in settings.
    mcp: cfg.str("mcp", "node services/mcp-telegram/index.js"),
    // Telegram accepts up to 10 photos in one media group. UPPERCASE: static literal
    // baked in here, not read from settings.yaml.
    MAX_PHOTOS: 10,
  };
}

export const config = buildConfig(loadSettings());
