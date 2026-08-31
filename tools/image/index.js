/**
 * Text to image.
 *
 * Used by the newsroom's illustrate stage: when a pitch brings no picture, the
 * stage asks a provider here to draw a title image, then hands it into the
 * pipeline exactly as if it had come with the pitch. The newsroom only ever sees
 * `{name, data}` WebP images — where the pixels came from is a channel detail.
 *
 * @typedef {{prompt:string, size?:string}} ImageRequest
 * @typedef {{bytes:Buffer, mime:string}} ImageResult
 */

/** @abstract */
export class ImageProvider {
  /**
   * @param {ImageRequest} _req
   * @returns {Promise<ImageResult>}
   */
  async generate(_req) {
    throw new Error("generate() not implemented");
  }
}

export async function createImage(cfg) {
  const provider = cfg.str("provider", "google");

  if (provider === "google") {
    const { GoogleImage } = await import("./google.js");
    return new GoogleImage({
      baseUrl: cfg.str("base_url", "https://generativelanguage.googleapis.com/v1beta"),
      model: cfg.str("model", "gemini-2.5-flash-image"),
      apiKey: process.env.GEMINI_API_KEY ?? "not-needed",
    });
  }

  throw new Error(`Unknown image provider: ${provider}`);
}
