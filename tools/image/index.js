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

/**
 * Envelope image encoding — the single source of truth for the format.
 *
 * Inside an envelope an image travels as a data URI: `data:<mime>;base64,<bytes>`.
 * That is self-describing (the mime rides with the bytes) and can be pasted straight
 * into a browser's address bar to view it — which makes envelopes and queue files
 * far easier to debug. These three helpers are the ONLY place that knows this shape:
 * build one, read its bytes, read its mime. Every producer and consumer goes through
 * them, so nobody else has to reason about data URIs, base64, or mime strings — the
 * format is fully encapsulated here.
 *
 * All three accept either the data-URI string or a media item (reads its `data`), and
 * tolerate a bare base64 string with no `data:` prefix (older envelopes, before the
 * format was normalized): `getImageData` returns it unchanged, `getImageMimeType`
 * falls back to the pipeline's WebP.
 */
const IMAGE_URI = /^data:([^;,]+);base64,([\s\S]*)$/;

const uriOf = (image) => (typeof image === "string" ? image : (image?.data ?? ""));

/** Build the canonical envelope image value from a mime type and base64 bytes. */
export function buildImageUri(mimeType, base64) {
  return `data:${mimeType};base64,${base64}`;
}

/** The base64 bytes of an envelope image value (a bare base64 string is returned as-is). */
export function getImageData(image) {
  const uri = uriOf(image);
  const m = IMAGE_URI.exec(uri);
  return m ? m[2] : uri;
}

/** The mime type of an envelope image value (defaults to image/webp for a bare base64 string). */
export function getImageMimeType(image) {
  const m = IMAGE_URI.exec(uriOf(image));
  return m ? m[1] : "image/webp";
}
