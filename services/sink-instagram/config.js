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
 * The three token fields are the INITIAL values only. The running service keeps them
 * in mutable state (the OAuth flow and refreshes update both memory and .env); config
 * is the boot snapshot, not the live token.
 */
export function buildConfig(settings, env) {
  const cfg = section(settings, "sink-instagram");
  const port = cfg.num("port");
  return {
    port,
    apiUrl: cfg.str("api_url", "https://graph.instagram.com"),
    githubRepo: cfg.str("github_repo"),
    githubBranch: cfg.str("github_branch", DEFAULT_BRANCH),
    // Appended to the caption when the pitch carries no target_url (Instagram links are not clickable).
    defaultLink: cfg.str("default_link", ""),
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
    // Refresh the long-lived token when fewer than this many seconds remain (7 days).
    REFRESH_THRESHOLD_S: 7 * 24 * 3600,
    // App id/secret are only needed for the full OAuth bootstrap; the quick-start path
    // (a hand-generated token in INSTAGRAM_ACCESS_TOKEN) needs neither.
    appId: env.INSTAGRAM_APP_ID ?? "",
    appSecret: env.INSTAGRAM_APP_SECRET ?? "",
    githubToken: env.GITHUB_TOKEN ?? "",
    // Initial token state, seeded from the environment on startup. The token may be
    // hand-generated (quick start) or OAuth-obtained; the user id is resolved from the
    // token when absent.
    initialAccessToken: env.INSTAGRAM_ACCESS_TOKEN ?? "",
    initialTokenExpiresAt: Number(env.INSTAGRAM_TOKEN_EXPIRES_AT ?? 0), // Unix seconds, 0 = unknown
    initialUserId: env.INSTAGRAM_USER_ID ?? "",
  };
}

export const config = buildConfig(loadSettings(), process.env);
