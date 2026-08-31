/**
 * Speech to text.
 *
 * Used by source-telegram: a voice message is transcribed before the envelope
 * is built. The newsroom only ever sees text — audio is a channel
 * detail, not a system concern.
 *
 * @typedef {{audio:Buffer, mime:string, language?:string}} SttRequest
 * @typedef {{text:string}} SttResult
 */

/** @abstract */
export class SttProvider {
  /**
   * @param {SttRequest} _req
   * @returns {Promise<SttResult>}
   */
  async transcribe(_req) {
    throw new Error("transcribe() not implemented");
  }
}

export async function createStt(cfg) {
  const provider = cfg.str("provider", "whisper-http");

  if (provider === "whisper-http") {
    const { WhisperHttpStt } = await import("./whisper-http.js");
    return new WhisperHttpStt({
      baseUrl: cfg.str("base_url"),
      model: cfg.str("model", "whisper-1"),
      language: cfg.str("language", "de"),
      apiKey: process.env.STT_API_KEY ?? "not-needed",
    });
  }

  if (provider === "google") {
    const { GoogleStt } = await import("./google.js");
    return new GoogleStt({
      baseUrl: cfg.str("base_url", "https://generativelanguage.googleapis.com/v1beta"),
      model: cfg.str("model", "gemini-3.5-flash"),
      language: cfg.str("language", "de"),
      apiKey: process.env.GEMINI_API_KEY ?? "not-needed",
    });
  }

  throw new Error(`Unknown STT provider: ${provider}`);
}
