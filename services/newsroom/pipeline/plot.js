import { Stage } from "./stage.js";
import { askText, pitchText, reviewNote } from "./converse.js";

/**
 * Reads: text, images — writes: plot
 *
 * The pre-editorial step. A Telegram message is rarely an article brief; it is a
 * photo and half a sentence. This stage decides what the piece should become
 * before anyone writes a word, so the article stage gets a brief instead of a
 * fragment.
 */
const INSTRUCTION = `Schreibe das Drehbuch für diesen Artikel — noch nicht den Artikel.

Lege fest:
- Welcher Fall liegt vor (Fehlerbild, Bauteil, Rechenfrage)?
- Was ist die konkrete Frage, die der Artikel beantwortet?
- In welcher Reihenfolge wird sie beantwortet — vier bis sechs Stichpunkte.
- Welche Zahlen müssen gerechnet werden? Rechne sie jetzt mit den Werkzeugen
  und notiere die Ergebnisse; der Artikel übernimmt sie später.
- Welche der verlinkbaren Ziele passen?

Höchstens 250 Wörter, Stichpunkte statt Prosa. Kein Fließtext, keine Überschrift.`;

export class PlotStage extends Stage {
  constructor() {
    super("plot");
  }

  async run(doc, ctx) {
    const { text, toolLog } = await askText(ctx, {
      stage: this.name,
      context: pitchText(doc) + imageNote(doc) + reviewNote(doc, "Drehbuch", doc.plot),
      instruction: INSTRUCTION,
      images: doc.images,
      validate: (out) => {
        const problems = [];
        if (out.length < 80) problems.push("Das ist zu kurz für ein Drehbuch.");
        if (out.length > 4000) problems.push("Das ist zu lang — höchstens 250 Wörter.");
        // A plot that merely repeats the pitch has decided nothing. On a revision
        // the plot may legitimately stay as it was, so this only guards fresh runs.
        if (!doc.revise && out.replace(/\s+/g, " ").includes(doc.text.replace(/\s+/g, " ").trim()) && doc.text.length > 60) {
          problems.push("Das wiederholt nur den Pitch, statt etwas festzulegen.");
        }
        return problems;
      },
    });

    return { ...doc, plot: text, toolLog: [...(doc.toolLog ?? []), ...toolLog] };
  }
}

function imageNote(doc) {
  return doc.images?.length
    ? `\n\nBEILIEGENDE BILDER (genau diese Namen kann der Artikel verwenden):\n` +
        doc.images.map((i) => `- ${i.name}`).join("\n")
    : `\n\nEs liegt kein Bild bei.`;
}
