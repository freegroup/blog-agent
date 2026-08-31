#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { secret } from "@blogagent/config";
import { fetchWithRetry } from "@blogagent/http";

/**
 * The only place the Telegram token lives.
 *
 * source-telegram reads here; sink-github and the newsroom write here.
 * None of the three ever see the token.
 *
 * Important: read_messages must be called by exactly ONE process.
 * Two pollers with the same token get a 409 Conflict from Telegram.
 */
const TOKEN = secret("TELEGRAM_BOT_TOKEN");
const CHAT_ID = secret("TELEGRAM_CHAT_ID");
const api = `https://api.telegram.org/bot${TOKEN}`;
const files = `https://api.telegram.org/file/bot${TOKEN}`;

async function call(method, params = {}) {
  const response = await fetchWithRetry(
    `${api}/${method}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    },
    { label: `Telegram ${method}` },
  );
  const json = await response.json();
  if (!json.ok) throw new Error(`Telegram ${method}: ${json.description}`);
  return json.result;
}

const server = new McpServer({ name: "mcp-telegram", version: "0.1.0" });

server.registerTool(
  "read_messages",
  {
    title: "Fetch new messages",
    description:
      "Fetches new messages via long-polling. Only messages from the configured chat are " +
      "returned; everything else is discarded but counted in the offset. " +
      "Media comes as file_id — fetch content separately via 'load_file'. " +
      "Must only be called from a single process.",
    inputSchema: {
      offset: z.number().int().describe("update_id of the last processed message + 1, otherwise 0"),
      timeout: z.number().int().min(0).max(50).default(30).describe("Seconds the server keeps the connection open"),
    },
  },
  async ({ offset, timeout }) => {
    const updates = await call("getUpdates", { offset, timeout, allowed_updates: ["message"] });

    const messages = updates
      .filter((u) => u.message && String(u.message.chat.id) === CHAT_ID)
      .map((u) => ({
        update_id: u.update_id,
        message_id: u.message.message_id,
        chat_id: u.message.chat.id,
        text: u.message.text ?? u.message.caption ?? "",
        // Telegram sends multiple sizes; the last one is the largest.
        photo: u.message.photo?.at(-1)?.file_id ?? null,
        audio: u.message.voice ?? u.message.audio
          ? {
              file_id: (u.message.voice ?? u.message.audio).file_id,
              mime: (u.message.voice ?? u.message.audio).mime_type ?? "audio/ogg",
            }
          : null,
      }));

    const next_offset = updates.length ? updates.at(-1).update_id + 1 : offset;
    return { content: [{ type: "text", text: JSON.stringify({ messages, next_offset }) }] };
  },
);

server.registerTool(
  "load_file",
  {
    title: "Download file",
    description: "Downloads a Telegram file by its file_id and returns it base64-encoded.",
    inputSchema: { file_id: z.string() },
  },
  async ({ file_id }) => {
    const { file_path } = await call("getFile", { file_id });
    const response = await fetchWithRetry(`${files}/${file_path}`, {}, { label: `Telegram download ${file_path}` });
    if (!response.ok) throw new Error(`file ${file_path}: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    return { content: [{ type: "text", text: JSON.stringify({ data: bytes.toString("base64"), bytes: bytes.length }) }] };
  },
);

server.registerTool(
  "send_message",
  {
    title: "Send message to chat",
    description:
      "Sends a message to the configured chat. Used by any service that has something to report " +
      "— sink after a PR, the newsroom on failure.",
    inputSchema: { text: z.string().min(1) },
  },
  async ({ text }) => {
    await call("sendMessage", { chat_id: CHAT_ID, text, disable_web_page_preview: false });
    return { content: [{ type: "text", text: "sent" }] };
  },
);

await server.connect(new StdioServerTransport());
