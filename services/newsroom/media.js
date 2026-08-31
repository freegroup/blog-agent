import sharp from "sharp";

/**
 * Normalising pictures for the pipeline.
 *
 * Every image — whether it arrived with the pitch or was generated later —
 * passes through here, so the model and the sink always see the same encoding.
 * Resizing once, early, also keeps a raw phone JPEG out of a vision model.
 */

/** Enough material for any sink to cut its own format from. */
export const LONG_EDGE = 2048;

/** @param {Buffer} buffer  any format sharp reads @returns {Promise<Buffer>} WebP */
export async function resizeToWebp(buffer) {
  return sharp(buffer)
    .resize({ width: LONG_EDGE, height: LONG_EDGE, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer();
}
