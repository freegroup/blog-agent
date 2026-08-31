import { Stage, StageError } from "./stage.js";
import { askText, reviewNote } from "./converse.js";
import { oneLine } from "./text.js";
import { slugify } from "./slugify.js";

/**
 * Reads: title, (on a revision) slug — writes: slug
 *
 * A fresh run needs no model: the slug is derived from the title, which removes a
 * whole class of failure — the sink rejects slugs that are not path-safe, and a
 * model that invents them will eventually invent a bad one.
 *
 * On a revision the slug is identity — the URL and the file path — so it stays as
 * it was UNLESS the review explicitly asks to rename it. That decision is the one
 * thing here that needs judgement, so the stage asks its (quick) model only then;
 * a fresh run still never calls it. A rename downstream moves the article's
 * directory, which the sink cleans up (it deletes the old one).
 */
const REVISE_INSTRUCTION = `Es geht um den Slug — die URL und den Dateinamen des Artikels.
Er ist Identität und bleibt normalerweise unverändert.

Verlangen die Rückmeldungen aus dem Review ausdrücklich einen anderen Slug, Dateinamen
oder eine andere URL? Wenn ja, antworte mit dem neuen Slug (nur Kleinbuchstaben, Ziffern
und Bindestriche). Wenn nicht, antworte mit genau dem Wort KEEP.

Antworte nur mit dem Slug oder mit KEEP, ohne Vorrede.`;

export class SlugStage extends Stage {
  constructor() {
    super("slug");
  }

  async run(doc, ctx) {
    if (doc.revise && doc.slug) {
      const { text } = await askText(ctx, {
        stage: this.name,
        context:
          `AKTUELLER SLUG\n\n${doc.slug}\n\n---\n\nAKTUELLER TITEL\n\n${doc.title ?? ""}` +
          reviewNote(doc, "Slug (URL/Dateiname)", doc.slug),
        instruction: REVISE_INSTRUCTION,
        validate: (out) => {
          const line = oneLine(out);
          if (/^keep$/i.test(line)) return [];
          if (!slugify(line)) return ["Daraus lässt sich keine URL bilden — nur Kleinbuchstaben, Ziffern, Bindestriche."];
          return [];
        },
      });

      const line = oneLine(text);
      if (/^keep$/i.test(line)) return doc; // the review does not touch the slug
      return { ...doc, slug: slugify(line) };
    }

    const slug = slugify(doc.title ?? "");
    if (!slug) throw new StageError(this.name, `aus dem Titel '${doc.title}' lässt sich keine URL bilden`);
    return { ...doc, slug };
  }
}
