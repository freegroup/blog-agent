import { loadSettings, section } from "@blogagent/config";

/**
 * chat-history's configuration in one place. index.js reads from here — never from
 * process.env or loadSettings directly. `buildConfig` is pure (settings in, config
 * out) so it is unit-testable with a fake settings object; `config` is the live
 * instance the running service uses as static vars.
 */
export function buildConfig(settings) {
  const cfg = section(settings, "chat-history");
  return {
    port: cfg.num("port", 5090),
    dir: cfg.str("dir", "./var/chat-history"),
    maxContext: cfg.num("max_context", 50),
  };
}

export const config = buildConfig(loadSettings());
