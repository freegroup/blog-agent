/**
 * Text to speech.
 *
 * Extension point, not yet implemented and no callers yet: no channel sends
 * audio back so far. The interface is here so a future provider (Piper, Coqui,
 * ElevenLabs, OpenAI) only needs a file next to this one — same pattern as
 * whisper-http.js for STT.
 *
 * @typedef {{text:string, voice?:string}} TtsRequest
 * @typedef {{audio:Buffer, mime:string}} TtsResult
 */

/** @abstract */
export class TtsProvider {
  /**
   * @param {TtsRequest} _req
   * @returns {Promise<TtsResult>}
   */
  async synthesize(_req) {
    throw new Error("synthesize() not implemented");
  }
}

export async function createTts(cfg) {
  throw new Error(
    `No TTS provider built (requested: ${cfg.str("provider", "—")}). ` +
      `Place an implementation next to this file and register it here.`,
  );
}
