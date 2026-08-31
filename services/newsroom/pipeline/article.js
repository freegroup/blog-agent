import { Stage } from "./stage.js";
import { askTool, pitchText, reviewNote } from "./converse.js";
import { _intern } from "@blogagent/sink-github/validate.js";

/**
 * Reads: plot, text, images — writes: markdown, toolLog
 *
 * Writes the article AND places the images: wherever a picture belongs it puts a
 * `![Bildunterschrift](foto-N.webp)` reference — an attached photo under its own
 * name, or a fresh number for one that should be generated. It does NOT check
 * whether a referenced image exists; the next stage (`illustrate`) fulfils the
 * placeholders, and one it cannot fill just stays as a dead link (accepted). So
 * this stage owns the text and the image *placement*; `illustrate` owns the
 * image *bytes*.
 *
 * The only thing it still checks in-session is its own prose: links must be
 * absolute, because it does not know which channel the text lands in.
 */
const SUBMIT = {
  name: "artikel_abgeben",
  description:
    "Gibt den fertigen Artikel ab. Erst aufrufen, wenn der Text vollständig ist und " +
    "jede genannte Zahl entweder gerechnet oder belegt ist.",
  inputSchema: {
    type: "object",
    properties: {
      markdown: {
        type: "string",
        description:
          "Der Artikel. Reine Prosa ohne Frontmatter, ohne Titelzeile. Bilder als " +
          "![Bildunterschrift](foto-N.webp) an der passenden Stelle im Text — beiliegende Fotos " +
          "unter ihrem Namen, zusätzliche mit fortlaufender Nummer. Links immer absolut (https://…).",
      },
    },
    required: ["markdown"],
  },
};

const INSTRUCTION = `Schreibe jetzt den Artikel nach diesem Drehbuch und gib ihn über
\`artikel_abgeben\` ab.

Setze Bilder als ![Bildunterschrift](foto-N.webp) dorthin, wo sie in den Text gehören —
Anzahl und Auswahl nach Briefing. Ob ein Bild schon existiert, musst du nicht prüfen; ein
späterer Schritt erzeugt die fehlenden. Keine Überschrift und kein Titel im Text — die
entstehen später. Beginne direkt mit dem ersten Absatz.`;

export class ArticleStage extends Stage {
  constructor() {
    super("article");
  }

  async run(doc, ctx) {
    const attached = (doc.images ?? []).map((i) => i.name);

    const { input, toolLog } = await askTool(ctx, {
      stage: this.name,
      tool: SUBMIT,
      context:
        `DREHBUCH\n\n${doc.plot}\n\n---\n\n${pitchText(doc)}` +
        (attached.length
          ? `\n\nBEILIEGENDE FOTOS (unter genau diesen Namen einbaubar):\n${attached.map((n) => `- ${n}`).join("\n")}` +
            `\n\nZusätzliche, noch zu erzeugende Bilder nummerierst du fort ab foto-${attached.length + 1}.`
          : `\n\nEs liegt kein Foto bei. Zusätzliche, noch zu erzeugende Bilder beginnen bei foto-1.`) +
        reviewNote(doc, "Artikel (Markdown)", doc.markdown),
      instruction: INSTRUCTION,
      images: doc.images,
      validate: (out) => problemsWith(out),
    });

    return {
      ...doc,
      markdown: input.markdown.trim(),
      toolLog: [...(doc.toolLog ?? []), ...toolLog],
    };
  }
}

/**
 * In-session self-check on the prose only: links must be absolute. Image
 * references are deliberately NOT checked — `illustrate` fulfils them, and a
 * placeholder it cannot fill is accepted as a dead link, not an error.
 */
export function problemsWith(input) {
  const markdown = typeof input?.markdown === "string" ? input.markdown.trim() : "";
  if (!markdown) return ["Der Artikel fehlt."];

  const problems = [];
  for (const target of _intern.linkTargets(markdown)) {
    if (target.startsWith("#")) continue;
    if (!/^https?:\/\//.test(target)) problems.push(`Der Link '${target}' ist nicht absolut.`);
  }
  return problems;
}
