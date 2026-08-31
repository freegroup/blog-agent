import { Stage } from "./stage.js";
import { askText, reviewNote } from "./converse.js";
import { oneLine } from "./text.js";
import { slugify } from "./slugify.js";

/**
 * Reads: plot, markdown — writes: title
 *
 * The slug is derived from this later, so the title must survive slugification.
 * That is checked here, where the model can still fix it, rather than in the
 * slug stage, which has no model to ask.
 */
const INSTRUCTION = `Schreibe den Titel für diesen Artikel.

Eine Zeile, 30 bis 80 Zeichen. Konkret statt allgemein — er soll die Frage
benennen, die der Artikel beantwortet. Keine Anführungszeichen, kein Präfix,
keine Erklärung — antworte ausschließlich mit dem Titel selbst.`;

const MIN = 20;
const MAX = 120;

export class TitleStage extends Stage {
  constructor() {
    super("title");
  }

  async run(doc, ctx) {
    const { text } = await askText(ctx, {
      stage: this.name,
      context: `DREHBUCH\n\n${doc.plot}\n\n---\n\nARTIKEL\n\n${doc.markdown}` + reviewNote(doc, "Titel", doc.title),
      instruction: INSTRUCTION,
      validate: (out) => {
        const line = oneLine(out);
        const problems = [];
        if (line.length < MIN) problems.push(`Zu kurz (${line.length} Zeichen, mindestens ${MIN}).`);
        if (line.length > MAX) problems.push(`Zu lang (${line.length} Zeichen, höchstens ${MAX}).`);
        if (out.includes("\n")) problems.push("Es soll genau eine Zeile sein.");
        if (line && !slugify(line)) {
          problems.push("Daraus lässt sich keine URL bilden — nimm mehr Buchstaben und Ziffern hinein.");
        }
        return problems;
      },
    });

    return { ...doc, title: oneLine(text) };
  }
}
