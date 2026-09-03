import { makeEnvelope } from "@blogagent/envelope";
import { ack, USER_REQUEST, ANSWER, REACTIVATE, askStructured } from "./verdict.js";
import { lastPublished, read, titleOf } from "../store.js";

/**
 * "poste das letzte noch mal auf xyz" — repost a finished posting to a channel.
 *
 * Two turns, because reposting publishes something visible and expensive:
 *
 *   1. First contact. The message asks to repost the last posting somewhere. We
 *      resolve "das letzte" (newest published), and ask the user to confirm —
 *      USER-REQUEST plus a `reactivation` marker the handler parks. Nothing forwards
 *      yet.
 *   2. The reply. A parked reactivation is waiting, so this message is the yes/no.
 *      On YES we build a FRESH pitch from the retained posting (new id, its original
 *      text + image, plus the target channel) and REACTIVATE it down the normal
 *      chain — the pipeline rebuilds the article channel-native, and the original
 *      published entry stays as history. On NO we drop it with a short reply.
 *      Anything that is not a clear yes/no is treated as a new request (ACK).
 *
 * "das letzte" is deterministic, so no model call resolves it — the model only
 * classifies intent (turn 1) and reads the confirmation (turn 2).
 */
const REPOST_SYSTEM =
  "Du bist ein Filter in einem Redaktions-Empfang und prüfst GENAU EINE Sache: Will der Nutzer ein " +
  "FRÜHERES/letztes Posting ERNEUT posten (z. B. „poste das letzte noch mal auf den Blog“)? Wenn ja, " +
  "nenne zusätzlich den Zielkanal, falls er genannt ist. Ein reiner Wunsch, ein Posting nur ANZUSEHEN, " +
  "zählt NICHT. Gib dein Urteil über das Werkzeug `repost_request` ab.";

const REPOST_TOOL = {
  name: "repost_request",
  description: "Meldet, ob der Nutzer ein früheres Posting erneut posten will, und wohin.",
  inputSchema: {
    type: "object",
    properties: {
      repost: { type: "boolean", description: "true, wenn ein früheres Posting erneut gepostet werden soll." },
      target: {
        type: ["string", "null"],
        description: "Der genannte Zielkanal (z. B. „Blog“, „Pinterest“, „Instagram“); null, wenn keiner genannt ist.",
      },
    },
    required: ["repost"],
  },
};

const CONFIRM_SYSTEM =
  "Du bist ein Filter in einem Redaktions-Empfang. Dem Nutzer wurde eine Ja/Nein-Frage gestellt. " +
  "Lies seine Antwort und entscheide, ob er zugestimmt hat. Gib das Ergebnis über das Werkzeug " +
  "`confirmation` ab: `yes` = klare Zustimmung, `no` = klare Ablehnung, `other` = weder noch " +
  "(er meint etwas anderes).";

const CONFIRM_TOOL = {
  name: "confirmation",
  description: "Meldet, wie der Nutzer auf die Ja/Nein-Rückfrage geantwortet hat.",
  inputSchema: {
    type: "object",
    properties: {
      answer: { type: "string", enum: ["yes", "no", "other"] },
    },
    required: ["answer"],
  },
};

/**
 * A fresh pitch that reposts a retained posting to `target`. New id so the original
 * published entry survives as history; `doc: null` so the pipeline rebuilds the
 * article channel-native rather than copying the old one. Carries the original text
 * and image; the target channel is stated in the text for the dispatcher to route.
 */
export function reactivationEnvelope(sourceEnvelope, target) {
  return makeEnvelope({
    source: "step-dialog",
    source_ref: `reactivate:${sourceEnvelope.id}`,
    text: `Poste den folgenden Beitrag erneut auf ${target}:\n\n${sourceEnvelope.text ?? ""}`.trim(),
    media: sourceEnvelope.media ?? [],
  });
}

export async function referenceRepost(ctx) {
  const { envelope, pending, llm, store = { lastPublished, read }, queueDir } = ctx;
  const text = envelope.text ?? "";

  // Turn 2: a repost is awaiting the user's yes/no.
  if (pending?.reactivation) {
    const { answer } = await askStructured(llm, {
      system: CONFIRM_SYSTEM,
      instruction: `FRAGE AN DEN NUTZER:\n${pending.question}\n\nSEINE ANTWORT:\n${text}\n\nHat er zugestimmt?`,
      tool: CONFIRM_TOOL,
    });
    if (answer === "yes") {
      const source = store.read(queueDir, pending.reactivation.source_id);
      if (!source) return { type: ANSWER, response: "Das Posting finde ich nicht mehr — es ist wohl abgelaufen." };
      return { type: REACTIVATE, envelope: reactivationEnvelope(source.envelope, pending.reactivation.target) };
    }
    if (answer === "no") return { type: ANSWER, response: "Ok, dann lasse ich das." };
    return ack(); // not a clear yes/no → treat the message as a fresh request
  }

  // Turn 1: is this a request to repost the last posting somewhere?
  if (!text.trim()) return ack();
  const { repost, target } = await askStructured(llm, {
    system: REPOST_SYSTEM,
    instruction: `ANFRAGE:\n${text}\n\nWill der Nutzer ein früheres Posting erneut posten?`,
    tool: REPOST_TOOL,
  });
  if (repost !== true) return ack();

  const last = store.lastPublished(queueDir);
  if (!last) return { type: ANSWER, response: "Ich finde kein früheres Posting, das ich erneut posten könnte." };

  const channel = typeof target === "string" ? target.trim() : "";
  if (!channel) {
    return {
      type: ANSWER,
      response: "Sag mir bitte, wohin ich das letzte Posting erneut posten soll (z. B. „poste das letzte auf den Blog“).",
    };
  }

  return {
    type: USER_REQUEST,
    response: `Meinst du „${titleOf(last)}“? Den poste ich dann auf ${channel}.`,
    reactivation: { source_id: last.id, target: channel },
  };
}
