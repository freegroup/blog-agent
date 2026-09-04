import { ImageProvider, getImageData, getImageMimeType } from "./index.js";
import { whyFetchFailed, fetchWithRetry } from "@blogagent/http";

/**
 * Draws an image with Google's Generative Language API (Gemini image models,
 * e.g. `gemini-2.5-flash-image`). The model returns the picture inline as base64
 * inside a content part; we hand back the raw bytes and let the newsroom resize.
 *
 * The API is in flux (older Imagen `:predict` models were retired mid-2026, and
 * the image-capable Gemini models answer via `:generateContent`). If Google moves
 * the endpoint or response shape again, only this file changes.
 *
 * The pro image model is in high demand and answers 503 under load; `fetchWithRetry`
 * retries those transient failures with backoff before we give up.
 */
export class GoogleImage extends ImageProvider {
  constructor({ baseUrl, model, apiKey }) {
    super();
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.model = model;
    this.apiKey = apiKey;
  }

  async generate({ prompt, image }) {
    const url = `${this.baseUrl}/models/${this.model}:generateContent`;
    // A source image turns text-to-image into image-to-image: the model reworks the
    // given picture instead of drawing from scratch (how a user photo gets enriched).
    const reqParts = [{ text: prompt }];
    if (image) reqParts.push({ inlineData: { mimeType: getImageMimeType(image), data: getImageData(image) } });
    let response;
    try {
      response = await fetchWithRetry(
        url,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": this.apiKey,
          },
          // Force image output: without it the model may answer in text (a
          // refusal or a description), which then surfaces as "no image".
          body: JSON.stringify({
            contents: [{ parts: reqParts }],
            generationConfig: { responseModalities: ["IMAGE"] },
          }),
        },
        { label: `image ${this.model}` },
      );
    } catch (err) {
      throw new Error(`Image generation unreachable at ${url}: ${whyFetchFailed(err)}`);
    }

    if (!response.ok) {
      throw new Error(`Image generation ${response.status} from ${url}: ${await response.text()}`);
    }

    const json = await response.json();
    const candidate = json?.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const inline = parts.find((p) => p.inlineData?.data ?? p.inline_data?.data);
    const blob = inline?.inlineData ?? inline?.inline_data;
    if (!blob?.data) {
      // Say why — a safety block or a text reply reads very differently in the log.
      const text = parts.map((p) => p.text).filter(Boolean).join(" ").slice(0, 200);
      const why = [candidate?.finishReason && `finishReason=${candidate.finishReason}`, text && `text: ${text}`]
        .filter(Boolean)
        .join(", ");
      throw new Error(`Image generation returned no image from ${url}${why ? ` (${why})` : ""}`);
    }

    return {
      bytes: Buffer.from(blob.data, "base64"),
      mime: blob.mimeType ?? blob.mime_type ?? "image/png",
    };
  }
}

