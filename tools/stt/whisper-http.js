import { SttProvider } from "./index.js";
import { whyFetchFailed, fetchWithRetry } from "@blogagent/http";

/**
 * Speaks /v1/audio/transcriptions. Works without code changes for:
 * whisper.cpp server, faster-whisper-server, OpenAI, liteLLM.
 *
 * Telegram delivers voice messages as OGG/Opus — Whisper accepts that directly,
 * no ffmpeg required.
 */
export class WhisperHttpStt extends SttProvider {
  constructor({ baseUrl, model, language, apiKey }) {
    super();
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.model = model;
    this.language = language;
    this.apiKey = apiKey;
  }

  async transcribe({ audio, mime, language }) {
    const form = new FormData();
    form.append("file", new Blob([audio], { type: mime }), fileNameFor(mime));
    form.append("model", this.model);
    const lang = language ?? this.language;
    if (lang) form.append("language", lang);

    const url = `${this.baseUrl}/audio/transcriptions`;
    let response;
    try {
      response = await fetchWithRetry(
        url,
        {
          method: "POST",
          headers: { authorization: `Bearer ${this.apiKey}` },
          body: form,
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
    return { text: (json.text ?? "").trim() };
  }
}

function fileNameFor(mime) {
  const ext = { "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/mp4": "m4a" }[mime];
  return `audio.${ext ?? "ogg"}`;
}
