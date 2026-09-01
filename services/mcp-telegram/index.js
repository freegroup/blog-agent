#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { secret } from "@blogagent/config";
import { fetchWithRetry } from "@blogagent/http";
import { postMessage } from "@blogagent/chat";

/**
 * The only place the Telegram token lives.
 *
 * source-telegram reads here; sink-github and the newsroom write here.
 * None of the three ever see the token.
 *
 * As the single bridge to the user, this is also where every OUTBOUND message is
 * recorded into the chat history: whatever any service sends via `send_message`
 * (or the caption of a `send_photos` group) lands there automatically, so no
 * sender has to mirror it itself. Images themselves are never recorded — the chat
 * history is a text transcript. (Inbound stays with source-telegram, which owns
 * the transcript and the pitch it became.)
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

// Multipart variant for methods that upload file bytes (sendPhoto,
// sendMediaGroup). No content-type header — fetch derives the multipart boundary
// from the FormData itself; setting it by hand would break the boundary.
async function callForm(method, form) {
  const response = await fetchWithRetry(
    `${api}/${method}`,
    { method: "POST", body: form },
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
    // Record it in the chat history so every outbound message lands there through the
    // one bridge. Best-effort: the message already reached the user, so a chat-history
    // outage must not turn a delivered message into a tool error.
    await postMessage({ direction: "out", author: "telegram", text }).catch((err) =>
      console.error(`[mcp-telegram] chat-history not updated: ${err.message}`),
    );
    return { content: [{ type: "text", text: "sent" }] };
  },
);

server.registerTool(
  "send_photos",
  {
    title: "Send photo(s) to chat",
    description:
      "Sends 1–10 photos to the configured chat — a single photo, or a media group — with an " +
      "optional caption on the first one. Each photo is raw image bytes, base64-encoded, and must " +
      "be JPEG or PNG (Telegram does not accept WebP as a photo). Used by the Telegram sink to " +
      "deliver an illustrated article.",
    inputSchema: {
      photos: z
        .array(z.object({ data: z.string().min(1).describe("base64 JPEG/PNG bytes"), name: z.string().optional() }))
        .min(1)
        .max(10),
      caption: z.string().optional().describe("Caption on the first photo (Telegram caps it at 1024 chars)"),
    },
  },
  async ({ photos, caption }) => {
    const form = new FormData();
    form.set("chat_id", CHAT_ID);
    const parts = photos.map((p, i) => ({
      field: `file${i}`,
      name: p.name ?? `foto-${i + 1}.jpg`,
      blob: new Blob([Buffer.from(p.data, "base64")], { type: "image/jpeg" }),
    }));

    if (parts.length === 1) {
      form.set("photo", parts[0].blob, parts[0].name);
      if (caption) form.set("caption", caption);
      await callForm("sendPhoto", form);
    } else {
      for (const part of parts) form.set(part.field, part.blob, part.name);
      const media = parts.map((part, i) => ({
        type: "photo",
        media: `attach://${part.field}`,
        ...(i === 0 && caption ? { caption } : {}),
      }));
      form.set("media", JSON.stringify(media));
      await callForm("sendMediaGroup", form);
    }

    // Record only the caption — the photos themselves never enter the chat history
    // (it is a text transcript). Best-effort, like send_message.
    if (caption) {
      await postMessage({ direction: "out", author: "telegram", text: caption }).catch((err) =>
        console.error(`[mcp-telegram] chat-history not updated: ${err.message}`),
      );
    }
    return { content: [{ type: "text", text: "sent" }] };
  },
);

await server.connect(new StdioServerTransport());
