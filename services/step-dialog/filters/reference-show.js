import { ack, ANSWER, askStructured } from "./verdict.js";
import { lastPublished, describePosting } from "../store.js";

/**
 * "zeige mir das letzte Posting" — a read-only request, not an article.
 *
 * The reception desk answers it directly: it looks up the most recent published
 * posting and hands back its title + link. Nothing is forwarded and nothing is
 * parked (ANSWER is terminal). This is the payoff of "published, not deleted": the
 * finished doc is still on disk to read back.
 *
 * Only a request to SEE a past posting fires. Anything else — including a request
 * to (re)post something — is not our business (ACK); the repost filter owns that.
 */
const SYSTEM =
  "Du bist ein Filter in einem Redaktions-Empfang und prüfst GENAU EINE Sache: Will der Nutzer ein " +
  "FRÜHERES/letztes Posting ANGEZEIGT bekommen — also nur sehen/nachlesen, was zuletzt veröffentlicht " +
  "wurde (z. B. „zeig mir das letzte Posting“, „was hast du zuletzt gepostet?“)? Ein Wunsch, etwas " +
  "(erneut) zu POSTEN, zählt NICHT. Gib dein Urteil über das Werkzeug `show_request` ab.";

const SHOW_TOOL = {
  name: "show_request",
  description: "Meldet, ob der Nutzer ein früheres Posting nur ANGEZEIGT bekommen will.",
  inputSchema: {
    type: "object",
    properties: {
      show: { type: "boolean", description: "true, wenn der Nutzer das letzte Posting sehen/nachlesen will." },
    },
    required: ["show"],
  },
};

export async function referenceShow(ctx) {
  const { envelope, llm, store = { lastPublished, describePosting }, queueDir } = ctx;
  const text = envelope.text ?? "";
  if (!text.trim()) return ack(); // nothing to read intent from (image only)

  const { show } = await askStructured(llm, {
    system: SYSTEM,
    instruction: `ANFRAGE:\n${text}\n\nWill der Nutzer nur ein früheres Posting sehen?`,
    tool: SHOW_TOOL,
  });
  if (show !== true) return ack();

  const last = store.lastPublished(queueDir);
  if (!last) return { type: ANSWER, response: "Ich finde kein früheres Posting." };
  return { type: ANSWER, response: store.describePosting(last) };
}
