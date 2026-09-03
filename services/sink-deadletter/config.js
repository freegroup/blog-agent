import { loadSettings, section } from "@blogagent/config";

/**
 * sink-deadletter's configuration in one place. index.js reads from here — never
 * from process.env or loadSettings directly. `buildConfig` is pure (settings in,
 * config out) so it is unit-testable with a fake settings object; `config` is the
 * live instance the running service uses as static vars.
 */
export function buildConfig(settings) {
  const cfg = section(settings, "sink-deadletter");
  return {
    port: cfg.num("port", 5083),
    dir: cfg.str("dir", "./var/deadletter"),
    // The mcp-telegram command: the deadletter sink reports over Telegram, which is
    // the one process holding the token. Just a spawn command, so it stays in settings.
    mcp: cfg.str("mcp", "node services/mcp-telegram/index.js"),
  };
}

export const config = buildConfig(loadSettings());
