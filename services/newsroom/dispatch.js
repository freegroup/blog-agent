import { askTool } from "./pipeline/converse.js";

/**
 * The dispatcher: which briefings is a pitch actually for?
 *
 * Until now every fresh pitch was hung on every briefing — a camper pitch also
 * ran the Pinterest and Telegram-chat channels, burning LLM and image work on
 * articles nobody asked for. The dispatcher reads each briefing's `when` (its
 * remit) and the pitch, and picks only the channels that truly apply. No match
 * is a valid answer: the caller then writes nothing and tells the user.
 *
 * It reuses the newsroom's own conversation mechanics (`askTool`) with a
 * synthetic context: no MCP tools, so the model's only move is our terminal
 * channel-selection tool, and the "briefing" is just this prompt.
 */
const DISPATCH_SYSTEM =
  "Du bist der Dispatcher einer Redaktion. Du bekommst die verfügbaren Kanäle mit ihrer " +
  "Zuständigkeit und eine Anfrage. Wähle NUR die Kanäle, deren Zuständigkeit wirklich auf die " +
  "Anfrage zutrifft. Erzwinge keinen Treffer: passt kein Kanal, gib eine leere Liste zurück. " +
  "Gib das Ergebnis über das Werkzeug `choose_channels` ab.";

const CHOOSE_TOOL = {
  name: "choose_channels",
  description:
    "Gibt die Namen der zuständigen Kanäle zurück. Leere Liste, wenn kein Kanal zuständig ist.",
  inputSchema: {
    type: "object",
    properties: {
      channels: {
        type: "array",
        items: { type: "string" },
        description: "Die Namen der zuständigen Kanäle, exakt wie in der Liste geschrieben.",
      },
    },
    required: ["channels"],
  },
};

/**
 * Choose the briefings a pitch is for.
 *
 * @param {{text:string, briefings:{name:string, when?:string}[], llm:{complete:Function}}} arg
 * @returns {Promise<string[]>}  a subset of the briefing names (possibly empty)
 */
export async function chooseChannels({ text, briefings, llm }) {
  const known = new Set(briefings.map((b) => b.name));
  const roster = briefings
    .map((b) => `- ${b.name}: ${b.when?.trim() ? b.when.trim() : "(keine Zuständigkeit angegeben)"}`)
    .join("\n");

  const { input } = await askTool(
    { llm, mcpTools: [], briefing: { prompt: DISPATCH_SYSTEM } },
    {
      stage: "dispatch",
      tool: CHOOSE_TOOL,
      context: `KANÄLE\n\n${roster}`,
      instruction: `ANFRAGE\n\n${text}\n\nWelche Kanäle sind zuständig?`,
      validate: (i) => {
        if (!Array.isArray(i.channels)) return ["`channels` muss eine Liste von Namen sein."];
        const unknown = i.channels.filter((n) => !known.has(n));
        return unknown.length ? [`Unbekannte Kanäle: ${unknown.join(", ")}. Nur die gelisteten Namen verwenden.`] : [];
      },
    },
  );

  // De-duplicate in case the model names a channel twice; order follows the roster.
  return briefings.map((b) => b.name).filter((n) => input.channels.includes(n));
}
