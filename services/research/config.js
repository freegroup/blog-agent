import { loadSettings, section } from "@blogagent/config";

/**
 * research's configuration in one place. index.js and handler.js read from here —
 * never from process.env or loadSettings directly. `buildConfig` is pure (settings
 * in, config out) so it is unit-testable with a fake settings object; `config` is
 * the live instance the running service uses as static vars.
 */
export function buildConfig(settings) {
  const cfg = section(settings, "research");
  return {
    // Required, no default — a misconfigured port must fail loudly, not silently
    // bind somewhere unexpected.
    port: cfg.num("port"),
    // Required — a research with nowhere to deliver is a dead end, not a default.
    out: cfg.str("out"),
  };
}

export const config = buildConfig(loadSettings());
