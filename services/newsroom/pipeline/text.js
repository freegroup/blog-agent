/**
 * Unwrapping a one-line answer.
 *
 * Small models rarely answer with just the line: they prepend "Hier ist der
 * Titel:", wrap it in quotes, or fence it. The stage instruction asks them not
 * to, the validator would reject the extra length — but rejecting costs a round,
 * and stripping a leading label costs nothing.
 *
 * Deliberately narrow: only the wrappers, never the content.
 */
const LABEL = /^\s*(titel|title|beschreibung|description|slug)\s*[:\-–]\s*/i;

export function oneLine(raw) {
  let text = String(raw ?? "").trim();

  // A fenced block: take what is inside it.
  const fence = text.match(/^```[a-z]*\n([\s\S]*?)\n?```$/i);
  if (fence) text = fence[1].trim();

  // Preamble on its own line, answer below.
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1 && LABEL.test(lines[0]) && lines[0].replace(LABEL, "") === "") {
    text = lines[1];
  } else if (lines.length) {
    text = lines[0];
  }

  text = text.replace(LABEL, "").trim();

  // Matching quotes around the whole line.
  const quoted = text.match(/^["'„“»](.*)["'“”«]$/s);
  if (quoted) text = quoted[1].trim();

  return text.trim();
}
