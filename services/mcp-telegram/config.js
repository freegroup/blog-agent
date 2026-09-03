/**
 * mcp-telegram's configuration in one place: the Telegram token and chat id, and
 * the API base URLs derived from the token. index.js and chat-id.js read from here
 * — never from process.env directly. This service has no settings.yaml section; its
 * whole configuration is the environment.
 *
 * `buildConfig` is pure (env in, config out) so it is unit-testable with a fake env
 * and never throws on a plain read; `config` is the live instance the running
 * service uses. Required-secret enforcement is an explicit boot check
 * (`assertSecrets`) rather than an import-time surprise — so chat-id.js (which needs
 * only the token, before a chat id even exists) can import this module safely.
 */
export function buildConfig(env) {
  const token = env.TELEGRAM_BOT_TOKEN ?? "";
  return {
    token,
    chatId: env.TELEGRAM_CHAT_ID ?? "",
    api: `https://api.telegram.org/bot${token}`,
    files: `https://api.telegram.org/file/bot${token}`,
  };
}

export const config = buildConfig(process.env);

/** The running service needs both. chat-id.js checks only the token itself (see below). */
export function assertSecrets(c = config) {
  for (const [key, name] of [
    ["token", "TELEGRAM_BOT_TOKEN"],
    ["chatId", "TELEGRAM_CHAT_ID"],
  ]) {
    if (!c[key]) throw new Error(`Environment variable ${name} missing — see .env.example`);
  }
}
