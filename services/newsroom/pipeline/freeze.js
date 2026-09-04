import { Stage } from "./stage.js";
import { askTool, pitchText } from "./converse.js";

/**
 * Reads: text (pitch), images — writes: images (sources updated)
 *
 * Editorial gate that runs between `article` and `illustrate`. It reads the
 * original pitch and decides which user-supplied photos must stay exactly as
 * submitted by setting their source to "original". `illustrate` then skips those
 * images entirely — both at the LLM-instruction level (they appear as
 * "(User-Original — NICHT verändern)") and at the code level (hard guard).
 *
 * Only fires when at least one user image is present; otherwise it is a no-op
 * and adds no model call to the pipeline.
 */

const FREEZE = {
  name: "bild_einfrieren",
  description:
    "Markiert User-Fotos, die unverändert bleiben sollen (source: original). " +
    "Fotos, die aufgewertet werden dürfen, kommen NICHT in die Liste.",
  inputSchema: {
    type: "object",
    properties: {
      original: {
        type: "array",
        description:
          "Dateinamen der User-Fotos, die exakt so bleiben sollen wie vom Nutzer geliefert — " +
          "weil der Nutzer es ausdrücklich gesagt hat ('Bild so lassen', 'nicht verändern', " +
          "'original lassen' o. ä.). Alle anderen Fotos dürfen von der Redaktion aufgewertet werden.",
        items: { type: "string" },
      },
    },
    required: ["original"],
  },
};

export class FreezeStage extends Stage {
  constructor() {
    super("freeze");
  }

  async run(doc, ctx) {
    const userImages = (doc.images ?? []).filter((i) => i.source === "user");
    if (!userImages.length) return doc;

    const list = userImages.map((i) => `- ${i.name}`).join("\n");

    const { input } = await askTool(ctx, {
      stage: this.name,
      tool: FREEZE,
      context:
        `ORIGINALER PITCH DES NUTZERS\n\n${pitchText(doc)}\n\n---\n\n` +
        `USER-FOTOS (beiliegend):\n${list}`,
      instruction:
        "Prüfe den Pitch auf Hinweise, dass ein Foto unverändert bleiben soll " +
        "('Bild so lassen', 'nicht verändern', 'original', 'nicht bearbeiten' o. ä.). " +
        "Nimm nur solche Fotos in `original` auf. Gibt es keinen solchen Hinweis, bleibt die Liste leer.",
      validate: (inp) => (Array.isArray(inp?.original) ? [] : ["`original` muss eine Liste von Dateinamen sein."]),
    });

    const freeze = new Set(input.original ?? []);
    if (!freeze.size) return doc;

    const images = (doc.images ?? []).map((img) =>
      img.source === "user" && freeze.has(img.name) ? { ...img, source: "original" } : img,
    );
    return { ...doc, images };
  }
}
