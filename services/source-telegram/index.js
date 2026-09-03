#!/usr/bin/env node
import { makeEnvelope, forwardEnvelope } from "@blogagent/envelope";
import { createStt } from "@blogagent/stt";
import { createLlm } from "@blogagent/llm";
import { tidySentence } from "@blogagent/tidy";
import { connectOne } from "@blogagent/mcp";
import { postMessage } from "@blogagent/chat";
import { config } from "./config.js";

/**
 * Accepts photo, text, or voice message and pitches to the newsroom.
 *
 * This process never sees the Telegram token — it lives in mcp-telegram.
 * Transcription happens here; the newsroom only ever sees text.
 * Voice is a channel detail, not a system concern.
 *
 * The request is tidied first (typos and clumsy sentence structure, nothing more):
 * that cleaned form is what the envelope carries downstream AND what is mirrored
 * back into the chat, so the sender can proofread what actually arrived. The final
 * result — the PR link — still comes later from the sink, not here.
 */
const stt = await createStt(config.stt);
const llm = await createLlm(config.llm);
const telegram = await connectOne(config.mcp, "source-telegram");

async function toEnvelope(msg) {
  const media = [];
  let text = msg.text ?? "";

  if (msg.photo) {
    const { data } = await telegram.callJson("load_file", { file_id: msg.photo });
    media.push({ kind: "image", mime: "image/jpeg", data });
  }

  if (msg.audio) {
    // If transcription fails, skip this message rather than blocking the loop —
    // a missing Whisper instance would otherwise stall everything downstream.
    try {
      const { data } = await telegram.callJson("load_file", { file_id: msg.audio.file_id });
      const { text: heard } = await stt.transcribe({
        audio: Buffer.from(data, "base64"),
        mime: msg.audio.mime,
      });
      text = [text, heard].filter(Boolean).join("\n\n");
      console.log(`[source-telegram] transcribed: ${heard.slice(0, 80)}…`);
    } catch (err) {
      console.error(`[source-telegram] voice message ${msg.message_id} not transcribed: ${err.message}`);
      if (!text.trim() && !media.length) return null;
    }
  }

  if (!text.trim() && !media.length) return null;

  // Smooth typos and clumsy phrasing before anything else sees the text. This
  // cleaned form becomes the envelope AND the receipt — never the raw input. A
  // tidy failure must not drop the message, so we keep the raw text then.
  let request = text;
  if (text.trim()) {
    try {
      request = await tidySentence(text, llm);
    } catch (err) {
      console.error(`[source-telegram] tidy failed, using raw text: ${err.message}`);
    }
  }

  const envelope = makeEnvelope({
    source: "telegram",
    source_ref: `chat:${msg.chat_id}/msg:${msg.message_id}`,
    text: request,
    media,
  });
  return { envelope, request };
}

/**
 * Mirror the tidied request back into the chat so the sender can proofread what
 * actually arrived — the one point where a dictated or thumb-typed message can be
 * caught if it came out wrong. What follows ("Ich schreibe … für die Briefings")
 * comes later from the newsroom, which knows the channels; this only confirms the
 * request. Never throws: a failed courtesy must not drop the message from the poll
 * loop. No chat-history write here — mcp-telegram records every outbound message.
 */
async function acknowledge(request) {
  if (!request?.trim()) return;
  const text = `🎙️ Verstanden: „${request}“`;
  try {
    await telegram.call("send_message", { text });
  } catch (err) {
    console.error(`[source-telegram] acknowledgement not sent: ${err.message}`);
  }
}

let offset = 0;

async function poll() {
  const { messages, next_offset } = await telegram.callJson("read_messages", {
    offset,
    timeout: 30,
  });

  for (const msg of messages) {
    const result = await toEnvelope(msg);
    if (!result) continue;
    const id = await forwardEnvelope(result.envelope, config.out);
    // Record the user's (tidied) message in the chat history, tied to the pitch it
    // became. Inbound stays here — mcp-telegram never sees the transcript or the id.
    await postMessage({
      direction: "in",
      author: "user",
      text: result.envelope.text,
      chat_id: msg.chat_id,
      message_id: msg.message_id,
      meta: { pitch_id: id },
    });
    await acknowledge(result.request);
    console.log(`[source-telegram] pitched ${id} (msg ${msg.message_id})`);
  }

  // Advance only after a successful pitch: otherwise the message is considered
  // delivered by Telegram and will never be re-delivered.
  offset = next_offset;
}

console.log(`[source-telegram] long-polling → ${config.out}`);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await telegram.close();
    process.exit(0);
  });
}

while (true) {
  try {
    await poll();
  } catch (err) {
    console.error(`[source-telegram] ${err.message}`);
    await new Promise((r) => setTimeout(r, config.pollMs));
  }
}
