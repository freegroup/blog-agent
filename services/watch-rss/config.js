import { loadSettings, section } from "@blogagent/config";

/**
 * watch-rss's configuration in one place. index.js and feed.js read from here —
 * never from process.env or loadSettings directly. `buildConfig` is pure (settings
 * in, config out) so it is unit-testable with a fake settings object; `config` is
 * the live instance the running service uses as static vars.
 */
export function buildConfig(settings) {
  const cfg = section(settings, "watch-rss");
  return {
    feedUrl: cfg.str("feed_url"),
    pollMs: cfg.num("poll_seconds", 60) * 1000,
    seenFile: cfg.str("seen_file", "./var/watch-rss-seen.json"),
    // The mcp-telegram command: the "it's live" signal is reported over Telegram,
    // reached only through that one token-holding process. Just a spawn command.
    mcp: cfg.str("mcp", "node services/mcp-telegram/index.js"),
  };
}

export const config = buildConfig(loadSettings());
