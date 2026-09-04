import { StageError } from "./stage.js";
import { getImageData, getImageMimeType } from "@blogagent/image";

/**
 * The conversation mechanics every LLM-backed stage shares.
 *
 * Two ways to finish, because they fail differently:
 *
 *   askText  — the model answers in prose. Fine for a headline or a summary,
 *              where the whole reply IS the answer and unwrapping one line is
 *              trivial.
 *   askTool  — the model answers by calling a terminal tool. Needed whenever the
 *              answer has structure, because `stopReason === 'end'` fires the
 *              first time the model doesn't call a tool — including mid-narration
 *              ("Let me work out the cross-section first."). A structured
 *              terminator cannot be confused with thinking out loud.
 *
 * Both feed problems back into the OPEN session instead of throwing: a correction
 * costs one more round, a thrown error costs the whole attempt and a fresh run.
 */

/** The system prompt is the briefing, byte-identical for every stage.
 *
 * Not just tidiness: an OpenAI-compatible server sees the same leading system
 * message on all stage calls and can reuse the prompt KV cache across them.
 * Splicing per-stage text in here would break the shared prefix and pay full
 * prompt processing once per stage. Stage instructions go in the user turn. */
const systemOf = (ctx) => ctx.briefing.prompt;

/** The pitch, as it goes to the model. */
export function pitchText(draft) {
  return `PITCH DER CHEFREDAKTION\n\n${draft.text}`;
}

/**
 * The revision half of a stage's user turn, or "" for a fresh run.
 *
 * On a revision every stage sees the same thing: the comment history and its own
 * current output, plus the one rule — if the feedback does not concern your field,
 * return it UNCHANGED; otherwise change only what is asked. No stage is told what
 * the others do; each reads the review and decides for itself.
 *
 * @param {object} doc         the running document (doc.revise / doc.review)
 * @param {string} fieldLabel  what this stage owns, e.g. "Drehbuch", "Artikel (Markdown)"
 * @param {string} current     this stage's current value from the published article
 */
export function reviewNote(doc, fieldLabel, current) {
  if (!doc.revise) return "";
  const history =
    (doc.review ?? [])
      .map((c) => `- ${c.author ?? "?"}: ${(c.body ?? "").trim()}`)
      .join("\n") || "(kein Kommentar)";
  return (
    `\n\n---\n\nÜBERARBEITUNG. Rückmeldungen aus dem Review:\n${history}\n\n` +
    `Dein bisheriger Stand (${fieldLabel}):\n${current?.trim() ? current.trim() : "(leer)"}\n\n` +
    `Betrifft die Rückmeldung deinen Teil nicht, gib deinen bisherigen Stand UNVERÄNDERT zurück. ` +
    `Sonst ändere nur das, was die Rückmeldung verlangt — so wenig wie möglich.`
  );
}

function firstTurn({ context, instruction, images }) {
  // The LLM layer wants bare base64 + a separate mime; unpack the data URI here.
  const blocks = (images ?? []).map((i) => ({ type: "image", mime: getImageMimeType(i), data: getImageData(i) }));
  blocks.push({ type: "text", text: [context, instruction].filter(Boolean).join("\n\n---\n\n") });
  return [{ role: "user", content: blocks }];
}

/** Runs the MCP calls in one response and records them. Failures come back as results. */
async function runTools(calls, ctx, toolLog) {
  const results = [];
  for (const call of calls) {
    try {
      const content = await ctx.callMcpTool(call.name, call.input);
      toolLog.push({ name: call.name, input: call.input, output: content });
      results.push({ type: "tool_result", tool_use_id: call.id, content });
    } catch (err) {
      // Handed back, never swallowed — otherwise the model waits for a result
      // that never arrives and burns every remaining round.
      results.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: `Fehler: ${err.message}`,
        is_error: true,
      });
    }
  }
  return results;
}

/**
 * Prose answer.
 *
 * @param {import('./stage.js').StageContext} ctx
 * @param {{stage:string, context?:string, instruction:string, images?:object[],
 *          validate?:(text:string)=>string[], maxRounds?:number}} opts
 * @returns {Promise<{text:string, toolLog:object[]}>}
 */
export async function askText(ctx, { stage, context, instruction, images, validate, maxRounds = 6 }) {
  const messages = firstTurn({ context, instruction, images });
  const tools = ctx.mcpTools ?? [];
  const toolLog = [];

  for (let round = 0; round < maxRounds; round++) {
    const reply = await ctx.llm.complete({ system: systemOf(ctx), messages, tools });

    if (reply.stopReason === "tool_use" && reply.toolCalls.length) {
      messages.push({ role: "assistant", content: [...(reply.text ? [{ type: "text", text: reply.text }] : []), ...reply.toolCalls] });
      messages.push({ role: "user", content: await runTools(reply.toolCalls, ctx, toolLog) });
      continue;
    }

    const text = (reply.text ?? "").trim();
    const problems = text ? (validate?.(text) ?? []) : ["Die Antwort ist leer."];
    if (!problems.length) return { text, toolLog };

    messages.push({ role: "assistant", content: [{ type: "text", text: reply.text ?? "" }] });
    messages.push({
      role: "user",
      content: [{ type: "text", text: `So nicht: ${problems.join(" ")} Antworte erneut, nur mit dem korrigierten Ergebnis.` }],
    });
  }

  throw new StageError(stage, `nach ${maxRounds} Runden keine brauchbare Antwort`);
}

/**
 * Structured answer via a terminal tool.
 *
 * @param {import('./stage.js').StageContext} ctx
 * @param {{stage:string, tool:object, context?:string, instruction:string, images?:object[],
 *          validate?:(input:object)=>string[], maxRounds?:number}} opts
 * @returns {Promise<{input:object, toolLog:object[]}>}
 */
export async function askTool(ctx, { stage, tool, context, instruction, images, validate, maxRounds = 12 }) {
  const messages = firstTurn({ context, instruction, images });
  const tools = [...(ctx.mcpTools ?? []), tool];
  const toolLog = [];

  for (let round = 0; round < maxRounds; round++) {
    const reply = await ctx.llm.complete({ system: systemOf(ctx), messages, tools });

    if (reply.stopReason !== "tool_use" || !reply.toolCalls.length) {
      // Prose where a tool call belongs: ask again rather than parse it.
      messages.push({ role: "assistant", content: [{ type: "text", text: reply.text ?? "" }] });
      messages.push({
        role: "user",
        content: [{ type: "text", text: `Bitte das Ergebnis über das Werkzeug \`${tool.name}\` abgeben.` }],
      });
      continue;
    }

    messages.push({ role: "assistant", content: [...(reply.text ? [{ type: "text", text: reply.text }] : []), ...reply.toolCalls] });

    const results = [];
    let done = null;
    for (const call of reply.toolCalls) {
      if (call.name !== tool.name) continue;
      const problems = validate?.(call.input) ?? [];
      if (!problems.length) {
        done = call.input;
        break;
      }
      results.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: `Nicht angenommen: ${problems.join(" ")} Korrigiere das und rufe \`${tool.name}\` erneut auf.`,
        is_error: true,
      });
    }
    if (done) return { input: done, toolLog };

    const others = reply.toolCalls.filter((c) => c.name !== tool.name);
    messages.push({ role: "user", content: [...results, ...(await runTools(others, ctx, toolLog))] });
  }

  throw new StageError(stage, `nach ${maxRounds} Runden kein gültiger \`${tool.name}\`-Aufruf`);
}
