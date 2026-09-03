import { existsSync } from "node:fs";

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

// Unlike the other services, this one does not import @blogagent/config (it has no
// settings.yaml section), so it must load .env itself. It runs as an MCP stdio child
// spawned by the newsroom/sinks, which inherits only a restricted environment — so it
// reads its own secrets from the file rather than relying on the parent's env.
if (existsSync(".env")) process.loadEnvFile(".env");

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
