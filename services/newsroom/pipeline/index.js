import { section } from "@blogagent/config";
import { createLlm } from "@blogagent/llm";
import { createImage } from "@blogagent/image";
import { PlotStage } from "./plot.js";
import { IllustrateStage } from "./illustrate.js";
import { ArticleStage } from "./article.js";
import { DescriptionStage } from "./description.js";
import { TitleStage } from "./title.js";
import { SlugStage } from "./slug.js";

export { Stage, StageError, persistable, rehydrate } from "./stage.js";

/**
 * Assembling and running the pipeline.
 *
 * The order lives in `newsroom.pipeline`, not in code, so a step can be moved,
 * removed, or inserted without touching another stage. A new stage means: one
 * file exporting a Stage, one line in KINDS, one entry in the config.
 */
const KINDS = {
  plot: PlotStage,
  illustrate: IllustrateStage,
  article: ArticleStage,
  description: DescriptionStage,
  title: TitleStage,
  slug: SlugStage,
};

/**
 * @param {{settings:object, cfg:object, mcp:{tools:object[], call:Function}}} arg
 * @returns {Promise<{stages:object[], contextFor:Function, describe:string}>}
 */
export async function buildPipeline({ settings, mcp }) {
  const order = settings.newsroom?.pipeline;
  if (!Array.isArray(order) || !order.length) {
    throw new Error("settings.yaml: newsroom.pipeline must list at least one stage");
  }

  // One instance per profile, reused: providers hold no conversation state.
  const llms = new Map();
  const llmFor = async (profile) => {
    if (!llms.has(profile)) llms.set(profile, await createLlm(section(settings, `llm-profiles.${profile}`)));
    return llms.get(profile);
  };

  // Optional: only built when configured. A stage that needs no image generator
  // (all but `illustrate`) simply never reads it.
  const image = settings.image ? await createImage(section(settings, "image")) : null;

  const stages = [];
  const contexts = new Map();

  for (const name of order) {
    const Kind = KINDS[name];
    if (!Kind) throw new Error(`settings.yaml: newsroom.pipeline names unknown stage '${name}' — known: ${Object.keys(KINDS).join(", ")}`);

    const conf = settings.newsroom?.stages?.[name] ?? {};
    const stage = new Kind();

    contexts.set(name, {
      // A stage that never calls a model gets none — asking for one it cannot use
      // would only invite a config that looks meaningful and is not.
      llm: conf.llm === null ? null : await llmFor(conf.llm ?? "default"),
      // Tools are opt-in per stage: a headline has no business calculating.
      mcpTools: conf.tools === true ? mcp.tools : [],
      callMcpTool: mcp.call,
      // Injected everywhere like the tools above; only `illustrate` uses it.
      image,
    });
    stages.push(stage);
  }

  const describe = order
    .map((n) => {
      const c = settings.newsroom?.stages?.[n] ?? {};
      return `${n}${c.llm ? `(${c.llm})` : ""}${c.tools === true ? "+tools" : ""}`;
    })
    .join(" → ");

  return {
    stages,
    contextFor: (name, briefing) => ({ ...contexts.get(name), briefing }),
    // Exposed so callers outside the pipeline (the dispatcher) can build a
    // provider from a configured profile without knowing about llm-profiles or
    // duplicating a second instance — same memoised map the stages use.
    llmFor,
    describe,
  };
}

/**
 * Runs the stages in order, each on its predecessor's result.
 *
 * `onSave` sees the whole document after every stage — that IS what goes into
 * the queue file, growing step by step. No one merges anything afterwards.
 *
 * `resumeAfter` names the last stage that already finished on an earlier run of
 * the process; the pipeline then continues with the one after it. An unknown
 * name (the pipeline was reordered under a half-done job) falls back to running
 * everything — re-doing work is safe, skipping it is not.
 *
 * @param {object[]} stages
 * @param {object} doc  the initial document, or a rehydrated partial one
 * @param {{contextFor:Function, briefing:object, resumeAfter?:string, onSave?:Function}} arg
 */
export async function runPipeline(stages, doc, { contextFor, briefing, resumeAfter, onSave }) {
  const from = resumeAfter ? stages.findIndex((s) => s.name === resumeAfter) + 1 : 0;
  for (let i = from; i < stages.length; i++) {
    const stage = stages[i];
    doc = await stage.run(doc, contextFor(stage.name, briefing));
    await onSave?.(stage.name, doc);
  }
  return doc;
}
