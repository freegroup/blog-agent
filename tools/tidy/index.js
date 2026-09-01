/**
 * Tidy a user's request: fix typos and clumsy grammar, nothing else.
 *
 * A user dictates or thumb-types a request full of typos and half-formed
 * sentences. Before it becomes the envelope's text — and before it is mirrored
 * back so the sender can proofread — it is lightly cleaned up. This is a request
 * (an instruction), NOT article text: it must stay a request, and every directive
 * in it survives verbatim — especially channel/routing hints ("nur für den
 * Telegram-Kanal"), image wishes, names, URLs and numbers. The dispatcher reads
 * the tidied text to route the pitch, so mangling a routing directive here would
 * send the article to the wrong channel.
 *
 * It works against the LLM's `.complete` interface alone (same contract the
 * newsroom's conversation uses), so any configured provider fits and a fake one
 * makes it testable without a network.
 */

const TIDY_SYSTEM =
  "Du bekommst eine Anfrage an einen Schreib-Assistenten — eine Anweisung, KEIN Artikeltext. " +
  "Deine einzige Aufgabe: offensichtliche Tippfehler sowie Rechtschreib- und Grammatikfehler " +
  "korrigieren und den Satzbau nur dort minimal glätten, wo er wirklich holprig ist. Ändere so " +
  "wenig wie möglich. Behalte die Anfrage als Anfrage: Anweisungen bleiben Anweisungen (aus " +
  "„schreibe über …“ wird NICHT „Entdecke …“). Übernimm JEDE Angabe unverändert und vollständig — " +
  "besonders Anweisungen zum Kanal oder Ziel (z. B. „nur für den Telegram-Kanal“, „nicht in den " +
  "Blog“), Bildwünsche, Eigennamen, URLs und Zahlen. Nichts hinzufügen, nichts weglassen, nichts " +
  "zusammenfassen, nichts umdeuten, nichts umsortieren. Formuliere die Anfrage NICHT in Artikel- " +
  "oder Werbetext um. Antworte ausschließlich mit der korrigierten Anfrage — kein Kommentar, keine " +
  "Anführungszeichen.";

/**
 * @param {string} text  the raw request (typed text and/or a transcript)
 * @param {{complete: Function}} llm  any LLM provider (from @blogagent/llm)
 * @returns {Promise<string>}  the tidied text, or the input unchanged if the
 *   model returns nothing. Errors propagate — the caller decides whether to fall
 *   back to the raw text.
 */
export async function tidySentence(text, llm) {
  const reply = await llm.complete({
    system: TIDY_SYSTEM,
    messages: [{ role: "user", content: [{ type: "text", text }] }],
    tools: [],
  });
  return (reply.text ?? "").trim() || text;
}
