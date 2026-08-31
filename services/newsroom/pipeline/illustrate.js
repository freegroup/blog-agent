import { Stage } from "./stage.js";
import { askTool } from "./converse.js";
import { resizeToWebp } from "../media.js";
import { _intern } from "@blogagent/sink-github/validate.js";

/**
 * Reads: markdown, images, (revision) review — writes: images, imagesDropped
 *
 * Runs AFTER `article`, and fulfils the image placeholders it left in the text.
 * For every `![…](foto-N.webp)` reference: if a picture with that name is already
 * there (an attached photo, or one carried over on a revision) it is kept;
 * otherwise it is generated, using the whole article as context so the image fits
 * the passage it sits in. On a revision it also redraws an existing image if the
 * review asks for it — otherwise the picture stays, so editing the text never
 * changes the images.
 *
 * It NEVER touches the markdown: a placeholder it cannot fill (generation failed,
 * or the feature is off) stays as a dead link — accepted, not fatal. Attached
 * photos the article did not reference are moved to `imagesDropped` (for a debug
 * sink), never published.
 *
 * Only path-safe names (`foto-1.webp` …) are fulfilled and delivered — a stray
 * `![](../secret)` is ignored, so the sink can trust every name it receives and
 * needs no validation of its own.
 */
const SAFE_NAME = _intern.IMAGE_NAME; // ^[a-z0-9][a-z0-9-]{0,60}\.webp$
const MAX_IMAGES = 5;

const BILD_PROMPTS = {
  name: "bild_prompts",
  description: "Gibt für die neu zu erzeugenden Titelbilder je einen Generator-Prompt ab (leere Liste, wenn keins neu erzeugt werden muss).",
  inputSchema: {
    type: "object",
    properties: {
      images: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Der Bildname aus dem Platzhalter, z. B. foto-2.webp." },
            prompt: {
              type: "string",
              description:
                "Ein bildgeneratortauglicher Prompt auf Englisch, der EIN Foto beschreibt — passend zu dem Absatz, " +
                "in dem der Platzhalter im Artikel steht, und zu den Bildvorgaben des Briefings. Kein Text im Bild, keine Logos.",
            },
          },
          required: ["name", "prompt"],
        },
      },
    },
    required: ["images"],
  },
};

export class IllustrateStage extends Stage {
  constructor() {
    super("illustrate");
  }

  async run(doc, ctx) {
    const have = new Map((doc.images ?? []).map((i) => [i.name, i]));
    // Referenced placeholders, in order of appearance, path-safe, unique.
    const referenced = [...new Set(_intern.imageRefs(doc.markdown ?? ""))].filter((n) => SAFE_NAME.test(n));
    const missing = referenced.filter((n) => !have.has(n));

    // A model call is only needed when something might be drawn: a missing image,
    // or a revision where the review might ask to redraw an existing one.
    let drawn = new Map();
    if (ctx.image && (missing.length || doc.revise)) {
      drawn = await draw(doc, ctx, referenced, have);
    }

    // Final set, in the article's order: a freshly drawn image wins over an
    // existing one of the same name; otherwise keep what we already had.
    const images = referenced
      .map((n) => drawn.get(n) ?? have.get(n))
      .filter(Boolean);
    const kept = new Set(images.map((i) => i.name));
    const imagesDropped = (doc.images ?? []).filter((i) => !kept.has(i.name));

    return { ...doc, images, imagesDropped };
  }
}

/**
 * One model call turns the placeholders + the article into prompts, then draws
 * each. Returns a name→image map of what was successfully generated. The model is
 * asked for a prompt for every image that needs a NEW picture: all missing ones,
 * plus — on a revision — any existing one whose change the review demands.
 */
async function draw(doc, ctx, referenced, have) {
  const list = referenced.map((n) => `- ${n} ${have.has(n) ? "(Bild vorhanden)" : "(fehlt)"}`).join("\n");
  const review = doc.revise
    ? `\n\n---\n\nÜBERARBEITUNG. Rückmeldungen aus dem Review:\n${(doc.review ?? []).map((c) => `- ${c.author ?? "?"}: ${(c.body ?? "").trim()}`).join("\n") || "(kein Kommentar)"}`
    : "";

  const { input } = await askTool(ctx, {
    stage: "illustrate",
    tool: BILD_PROMPTS,
    context: `ARTIKEL (mit Bild-Platzhaltern)\n\n${doc.markdown}\n\n---\n\nPLATZHALTER:\n${list}${review}`,
    instruction:
      "Gib über `bild_prompts` für JEDES Bild, das NEU erzeugt werden muss, einen Prompt ab: jedes fehlende " +
      "Bild, und — bei einer Überarbeitung — jedes vorhandene, dessen Änderung der Review ausdrücklich verlangt. " +
      "Für Bilder, die unverändert bleiben, gib KEINEN Prompt ab. Jeder Prompt beschreibt EIN Foto passend zum Absatz.",
    validate: (inp) => (Array.isArray(inp?.images) ? [] : ["`images` muss eine Liste von {name, prompt} sein."]),
  });

  const wanted = new Set(referenced);
  const out = new Map();
  for (const item of input.images ?? []) {
    const name = item?.name;
    if (!wanted.has(name) || !SAFE_NAME.test(name) || !item.prompt || out.size >= MAX_IMAGES) continue;
    try {
      const { bytes } = await ctx.image.generate({ prompt: item.prompt });
      const data = (await resizeToWebp(bytes)).toString("base64");
      out.set(name, { name, data });
    } catch (err) {
      // A missing image is a shame, not a reason to fail the article — leave the
      // placeholder as a dead link and move on.
      console.error(`[newsroom] illustrate: ${name} not generated: ${err.message}`);
    }
  }
  return out;
}
