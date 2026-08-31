#!/usr/bin/env node
import { loadSettings, section } from "@blogagent/config";
import { makeEnvelope } from "@blogagent/envelope";
import { createStt } from "@blogagent/stt";
import { connectOne } from "@blogagent/mcp";
import { postMessage } from "@blogagent/chat";

/**
 * Accepts photo, text, or voice message and pitches to the newsroom.
 *
 * This process never sees the Telegram token — it lives in mcp-telegram.
 * Transcription happens here; the newsroom only ever sees text.
 * Voice is a channel detail, not a system concern.
 *
 * The sender gets an immediate receipt back in the chat (and, for a voice
 * message, the transcript to gegenlesen). The final result — the PR link —
 * still comes later from the sink, not here.
 */
const settings = loadSettings();
const cfg = section(settings, "source-telegram");
const POLL_S = cfg.num("poll_seconds", 5);
// Where a fresh pitch goes next. Required, and normally the research filter
// (which enriches and forwards to the newsroom) — but it is just a URL, so this
// source can also point straight at the newsroom, or at any other filter.
const OUT = cfg.str("out");

const stt = await createStt(section(settings, "stt"));
const telegram = await connectOne(cfg.str("mcp", "node services/mcp-telegram/index.js"), "source-telegram");

async function toEnvelope(msg) {
  const media = [];
  let text = msg.text ?? "";
  let transcript = null;

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
      transcript = heard;
      text = [text, heard].filter(Boolean).join("\n\n");
      console.log(`[source-telegram] transcribed: ${heard.slice(0, 80)}…`);
    } catch (err) {
      console.error(`[source-telegram] voice message ${msg.message_id} not transcribed: ${err.message}`);
      if (!text.trim() && !media.length) return null;
    }
  }

  if (!text.trim() && !media.length) return null;

  const envelope = makeEnvelope({
    source: "telegram",
    source_ref: `chat:${msg.chat_id}/msg:${msg.message_id}`,
    text,
    media,
  });
  return { envelope, transcript };
}

/**
 * A receipt back into the chat so the sender knows the impulse landed and work
 * has begun. For a voice message it also echoes the transcript — the one case
 * where the sender cannot see what actually arrived and wants to catch a
 * misheard word early. Never throws: a failed courtesy must not drop the
 * message from the poll loop.
 */
async function acknowledge(transcript) {
  const lines = [];
  if (transcript) lines.push(`🎙️ Verstanden: „${transcript}“`);
  lines.push("✍️ Ich schreibe den Artikel …");
  const text = lines.join("\n\n");
  try {
    await telegram.call("send_message", { text });
  } catch (err) {
    console.error(`[source-telegram] acknowledgement not sent: ${err.message}`);
  }
  await postMessage({ direction: "out", author: "source-telegram", text });
}

async function pitch(envelope) {
  const response = await fetch(OUT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(envelope),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body.errors ?? [response.statusText]).join("; "));
  return body.id;
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
    const id = await pitch(result.envelope);
    // Record the user's message in the hub, tied to the pitch it became.
    await postMessage({
      direction: "in",
      author: "user",
      text: result.envelope.text,
      chat_id: msg.chat_id,
      message_id: msg.message_id,
      meta: { pitch_id: id },
    });
    await acknowledge(result.transcript);
    console.log(`[source-telegram] pitched ${id} (msg ${msg.message_id})`);
  }

  // Advance only after a successful pitch: otherwise the message is considered
  // delivered by Telegram and will never be re-delivered.
  offset = next_offset;
}

console.log(`[source-telegram] long-polling → ${OUT}`);

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
    await new Promise((r) => setTimeout(r, POLL_S * 1000));
  }
}
