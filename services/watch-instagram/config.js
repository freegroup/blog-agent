import { loadSettings, section } from "@blogagent/config";

/**
 * watch-instagram's configuration in one place. index.js and media.js read from
 * here — never from process.env or loadSettings directly. `buildConfig` is pure
 * (settings in, config out) so it is unit-testable with a fake settings object;
 * `config` is the live instance the running service uses as static vars.
 *
 * The access token is deliberately NOT part of config: it is a live secret that
 * sink-instagram refreshes and writes back to .env at runtime. This monitor re-reads
 * it from .env on every poll (see index.js) so it never runs on a stale token —
 * sink-instagram stays the single writer, watch-instagram is a pure reader.
 */
export function buildConfig(settings) {
  const cfg = section(settings, "watch-instagram");
  return {
    apiUrl: cfg.str("api_url", "https://graph.instagram.com"),
    pollMs: cfg.num("poll_seconds", 120) * 1000,
    // One seen-file per account, so the watcher stays agnostic of how many there are:
    // <seenDir>/watch-instagram-<account>-seen.json.
    seenDir: cfg.str("seen_dir", "./var"),
    // How many of the most-recent posts to request per poll — enough to catch a
    // burst between two polls, small enough to stay light.
    limit: cfg.num("limit", 10),
    // Where sink-instagram keeps the live access tokens; re-read every poll so a
    // refreshed token or a newly added account is picked up without a restart.
    envPath: cfg.str("env_path", ".env"),
    // The mcp-telegram command: the "is live" signal is reported over Telegram,
    // reached only through that one token-holding process. Just a spawn command.
    mcp: cfg.str("mcp", "node services/mcp-telegram/index.js"),
  };
}

export const config = buildConfig(loadSettings());
