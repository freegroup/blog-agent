import { Stage } from "./stage.js";
import { askText, reviewNote } from "./converse.js";
import { oneLine } from "./text.js";

/**
 * Reads: plot, markdown — writes: description
 *
 * Written against the finished article rather than alongside it, which is the
 * point: a search-result line can only promise what the text actually delivers.
 */
const INSTRUCTION = `Schreibe die Beschreibung für die Suchergebnisliste.

Ein Satz, 120 bis 160 Zeichen. Kein Auszug aus dem Artikel, sondern der Grund,
warum jemand klickt. Keine Anführungszeichen, kein Präfix, keine Erklärung —
antworte ausschließlich mit der Zeile selbst.`;

/** Generous band: a hard 120–160 gate makes a weak model loop until it gives up. */
const MIN = 80;
const MAX = 200;

export class DescriptionStage extends Stage {
  constructor() {
    super("description");
  }

  async run(doc, ctx) {
    const { text } = await askText(ctx, {
      stage: this.name,
      context: `DREHBUCH\n\n${doc.plot}\n\n---\n\nARTIKEL\n\n${doc.markdown}` + reviewNote(doc, "Beschreibung", doc.description),
      instruction: INSTRUCTION,
      validate: (out) => {
        const line = oneLine(out);
        const problems = [];
        if (line.length < MIN) problems.push(`Zu kurz (${line.length} Zeichen, mindestens ${MIN}).`);
        if (line.length > MAX) problems.push(`Zu lang (${line.length} Zeichen, höchstens ${MAX}).`);
        if (out.includes("\n")) problems.push("Es soll genau eine Zeile sein.");
        return problems;
      },
    });

    return { ...doc, description: oneLine(text) };
  }
}
