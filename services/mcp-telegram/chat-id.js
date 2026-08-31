#!/usr/bin/env node
/**
 * Helper script: find your own chat ID.
 *
 *   TELEGRAM_BOT_TOKEN=... node services/mcp-telegram/chat-id.js
 *
 * Then send any message to the bot in Telegram. The ID appears here and
 * belongs in .env as TELEGRAM_CHAT_ID — it is the only chat the agent
 * accepts pitches from.
 */
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("TELEGRAM_BOT_TOKEN missing.\nCreate a bot: in Telegram @BotFather → /newbot");
  process.exit(1);
}

const me = await fetch(`https://api.telegram.org/bot${token}/getMe`).then((r) => r.json());
if (!me.ok) {
  console.error(`Token rejected: ${me.description}`);
  process.exit(1);
}

console.log(`Bot: @${me.result.username}`);
console.log("Send it a message in Telegram now — waiting…\n");

let offset = 0;
while (true) {
  const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, {
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
