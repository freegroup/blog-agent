#!/usr/bin/env node
import { config } from "./config.js";

/**
 * Helper script: find your own chat ID.
 *
 *   TELEGRAM_BOT_TOKEN=... node services/mcp-telegram/chat-id.js
 *
 * Then send any message to the bot in Telegram. The ID appears here and
 * belongs in .env as TELEGRAM_CHAT_ID — it is the only chat the agent
 * accepts pitches from.
 *
 * Reads the token through config.js like the service does — but only the token,
 * since the chat id is exactly what this script exists to discover (so it does not
 * call assertSecrets, which would demand a chat id that does not exist yet).
 */
if (!config.token) {
  console.error("TELEGRAM_BOT_TOKEN missing.\nCreate a bot: in Telegram @BotFather → /newbot");
  process.exit(1);
}

const me = await fetch(`${config.api}/getMe`).then((r) => r.json());
if (!me.ok) {
  console.error(`Token rejected: ${me.description}`);
  process.exit(1);
}

console.log(`Bot: @${me.result.username}`);
console.log("Send it a message in Telegram now — waiting…\n");

let offset = 0;
while (true) {
  const res = await fetch(`${config.api}/getUpdates`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ offset, timeout: 30, allowed_updates: ["message"] }),
  }).then((r) => r.json());

  for (const update of res.result ?? []) {
    offset = update.update_id + 1;
    const chat = update.message?.chat;
    if (!chat) continue;
    console.log(`TELEGRAM_CHAT_ID=${chat.id}`);
    console.log(`  (${chat.type}${chat.username ? `, @${chat.username}` : ""})`);
    process.exit(0);
  }
}
