import { loadSettings, section } from "@blogagent/config";

/**
 * sink-github's configuration in one place: settings.yaml values, the environment
 * token, and the blog-format constants. index.js reads from here — never from
 * process.env or loadSettings directly.
 *
 * `buildConfig` is pure (settings + env in, config out) so it is unit-testable with
 * fakes and never throws on a plain read; `config` is the live instance the running
 * service uses as static vars. Required-secret enforcement is an explicit boot check
 * (`assertSecrets`, called by index.js) rather than an import-time surprise — so
 * importing this module for a test stays safe.
 */
export function buildConfig(settings, env) {
  const cfg = section(settings, "sink-github");
  const repo = cfg.str("repo");
  const [owner, name] = repo.split("/");
  return {
    port: cfg.num("port", 5081),
    repo,
    owner,
    name,
    baseBranch: cfg.str("base_branch", "main"),
    contentPath: cfg.str("content_path"),
    assetPath: cfg.str("asset_path"),
    // The machine-readable document beside the article (blogagent.yaml). Written on
    // every publish so a later revision can read the article's own truth back.
    metaPath: cfg.str("meta_path", ""),
    label: cfg.str("label", "blogagent"),
    apiUrl: cfg.str("api_url", "https://api.github.com"),
    // Optional: report over Telegram (the one token-holding process). Empty = silent.
    mcp: cfg.str("mcp", ""),
    githubToken: env.GITHUB_TOKEN ?? "",
    // Blog format. Target knowledge — the newsroom delivers 2048 px and knows nothing of
    // this. UPPERCASE: static literals baked in here, not read from settings.yaml.
    BLOG_WIDTH: 1600,
    BLOG_QUALITY: 82,
  };
}

export const config = buildConfig(loadSettings(), process.env);

/** Fail fast and legibly at startup rather than with a 401 on the first publish. */
export function assertSecrets(c = config) {
  if (!c.githubToken) throw new Error("Environment variable GITHUB_TOKEN missing — see .env.example");
}
