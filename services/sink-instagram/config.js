import { loadSettings, section } from "@blogagent/config";

// The GitHub branch instagram assets are uploaded to when settings.yaml does not
// override it. A static default, not itself a settings value.
const DEFAULT_BRANCH = "instagram-assets";

/**
 * sink-instagram's configuration in one place: settings.yaml values, the OAuth /
 * GitHub secrets, and the constants that used to sit inline (OAuth hosts, API base,
 * scopes, caption limit, refresh threshold, the .env path). index.js reads from here
 * — never from process.env or loadSettings directly.
 *
 * Naming convention: UPPERCASE fields are static literals baked in here (fixed by
 * Instagram or by us, never read from settings.yaml); camelCase fields come from
 * settings.yaml or the environment.
 *
 * `buildConfig` is pure (settings + env in, config out) so it is unit-testable with
 * fakes and never throws on a plain read; `config` is the live instance the running
 * service uses. There is no assertSecrets: Instagram runs in DRY RUN without a token
 * (and the app secret is only needed for the OAuth bootstrap), so nothing is strictly
 * required at boot — the service reports its authorization state itself.
 *
 * `igEnv` is the INITIAL snapshot of every INSTAGRAM_* variable. The running service
 * keeps per-account token state in memory (the OAuth flow and refreshes update both
 * memory and .env); config is the boot snapshot, not the live token.
 */
export function buildConfig(settings, env) {
  const cfg = section(settings, "sink-instagram");
  const port = cfg.num("port");
  return {
    port,
    apiUrl: cfg.str("api_url", "https://graph.instagram.com"),
    githubRepo: cfg.str("github_repo"),
    githubBranch: cfg.str("github_branch", DEFAULT_BRANCH),
    // Feed captions can't carry a clickable link, so the caption ends with a
    // "link in bio" call-to-action instead of a dead URL. Set to "" to omit it.
    captionCta: cfg.str("caption_cta", "🔗 Link in Bio"),
    // Must match the URI registered in the Instagram app EXACTLY (port and path included).
    redirectUri: cfg.str("redirect_uri", `http://localhost:${port}/oauth/callback`),
    // Fixed OAuth hosts for Instagram Login — not configurable (no sandbox for Instagram).
    OAUTH_AUTHORIZE: "https://www.instagram.com/oauth/authorize",
    OAUTH_TOKEN: "https://api.instagram.com/oauth/access_token",
    GITHUB_API: "https://api.github.com",
    SCOPES: ["instagram_business_basic", "instagram_business_content_publish"],
    ENV_PATH: ".env",
    // Instagram caption limit (chars visible before the "more" fold at ~125 chars).
    CAPTION_MAX: 2200,
    // Max images per post — one posts as a single image, more as a carousel. This is
    // Instagram's platform limit; the briefings keep the editorial count to 1–2.
    CAROUSEL_MAX: 10,
    // Refresh the long-lived token when fewer than this many seconds remain (7 days).
    REFRESH_THRESHOLD_S: 7 * 24 * 3600,
    // App id/secret are only needed for the full OAuth bootstrap; the quick-start path
    // (a hand-generated token in INSTAGRAM_ACCESS_TOKEN) needs neither.
    appId: env.INSTAGRAM_APP_ID ?? "",
    appSecret: env.INSTAGRAM_APP_SECRET ?? "",
    githubToken: env.GITHUB_TOKEN ?? "",
    // A snapshot of every INSTAGRAM_* variable, so index.js can seed one token per
    // account by convention (INSTAGRAM_<ACCOUNT>_ACCESS_TOKEN) without reading
    // process.env itself and without a predeclared account list — the account name
    // arrives on the briefing at publish time. The unsuffixed INSTAGRAM_ACCESS_TOKEN
    // is the default account (a briefing with no `account`), so existing single-
    // account setups keep working unchanged.
    igEnv: Object.fromEntries(Object.entries(env).filter(([k]) => k.startsWith("INSTAGRAM_"))),
  };
}

export const config = buildConfig(loadSettings(), process.env);
