import { SttProvider } from "./index.js";
import { whyFetchFailed, fetchWithRetry } from "@blogagent/http";

/**
 * Transcribes with Gemini's native `:generateContent`: the audio goes inline and
 * the model writes back the text. Same key and endpoint family as the `gemini`
 * LLM and the image generator — no separate service, no Cloud credentials.
 *
 * Why native and not the OpenAI-compatible `input_audio`: that path only accepts
 * wav/mp3, but Telegram voice notes are OGG/Opus. `generateContent` takes the OGG
 * directly (mime `audio/ogg`), so there is nothing to transcode.
 *
 * Voice notes are small (a few hundred KB), so the audio is sent inline as base64
 * — one request, nothing to upload or clean up.
 */
export class GoogleStt extends SttProvider {
  constructor({ baseUrl, model, language, apiKey }) {
    super();
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.model = model;
    this.language = language;
    this.apiKey = apiKey;
  }

  async transcribe({ audio, mime, language }) {
    const lang = language ?? this.language;
    const instruction =
      `Transkribiere diese Sprachnachricht wortgetreu${lang ? ` auf ${langName(lang)}` : ""}. ` +
      `Gib AUSSCHLIESSLICH den transkribierten Text zurück — keine Vorrede, keine Erklärung, keine Anführungszeichen. ` +
      `Ist keine Sprache zu hören, gib einen leeren Text zurück.`;

    const body = {
      contents: [
        {
          parts: [
            { inline_data: { mime_type: mime || "audio/ogg", data: audio.toString("base64") } },
            { text: instruction },
          ],
        },
      ],
    };

    const url = `${this.baseUrl}/models/${this.model}:generateContent`;
    let response;
    try {
      response = await fetchWithRetry(
        url,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
          body: JSON.stringify(body),
        },
        { label: `STT ${this.model}` },
      );
    } catch (err) {
      throw new Error(`STT unreachable at ${url}: ${whyFetchFailed(err)}`);
    }

    if (!response.ok) {
      throw new Error(`STT ${response.status} from ${url}: ${await response.text()}`);
    }

    const json = await response.json();
    const parts = json?.candidates?.[0]?.content?.parts ?? [];
    // Thinking parts (thought: true) are the model reasoning, not the transcript.
    const text = parts
      .filter((p) => !p.thought)
      .map((p) => p.text ?? "")
      .join("")
      .trim();
    return { text };
  }
}

/** A few common codes to a German language name; anything else passes through. */
function langName(code) {
  return { de: "Deutsch", en: "Englisch", fr: "Französisch", it: "Italienisch", es: "Spanisch" }[code] ?? code;
}
