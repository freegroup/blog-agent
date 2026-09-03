import { loadSettings, section } from "@blogagent/config";

/**
 * All of source-github's configuration in one place: the settings.yaml values and
 * the environment secrets it needs. No other module in this service reads
 * process.env or calls loadSettings — they import `config` from here.
 *
 * `buildConfig` is pure (settings + env in, config out) so it is unit-testable
 * with fakes and never throws on a plain read; `config` is the live instance the
 * running service uses as static vars. Required-secret enforcement is an explicit
 * boot check (`assertSecrets`, called by index.js) rather than an import-time
 * surprise — so importing this module for a test stays safe.
 */
export function buildConfig(settings, env) {
  const cfg = section(settings, "source-github");
  const repo = cfg.str("repo");
  const [owner, name] = repo.split("/");
  return {
    pollMs: cfg.num("poll_seconds", 60) * 1000,
    staleMs: cfg.num("ack_stale_min", 15) * 60_000,
    ackText: cfg.str("ack_text"),
    // Posted (once) when a login other than githubOwner comments: the return channel
    // only acts on the owner's comments, so an outsider gets a short notice instead of
    // silence. It is a known standard text — the poller recognizes its own notice on the
    // next round and never answers itself (no loop). Lives in settings.yaml, not here.
    rejectText: cfg.str("reject_text"),
    // A revision skips step-research and posts straight to the newsroom: the facts
    // were gathered on the first pitch and persisted in the article's blogagent.yaml.
    // Still just a configurable URL, so the routing stays in settings.
    out: cfg.str("out"),
    apiUrl: cfg.str("api_url", "https://api.github.com"),
    repo,
    owner, // repo owner, for formatRef
    name, // repo name, for formatRef
    label: section(settings, "sink-github").str("label", "blogagent"),
    githubToken: env.GITHUB_TOKEN ?? "",
    githubOwner: env.GITHUB_OWNER ?? "", // the login whose PR comments we act on
  };
}

/** The live configuration the service runs on. */
export const config = buildConfig(loadSettings(), process.env);

/** Fail fast and legibly at startup rather than with a 401 on the first poll. */
export function assertSecrets(c = config) {
  for (const [key, name] of [
    ["githubToken", "GITHUB_TOKEN"],
    ["githubOwner", "GITHUB_OWNER"],
  ]) {
    if (!c[key]) throw new Error(`Environment variable ${name} missing — see .env.example`);
  }
}
