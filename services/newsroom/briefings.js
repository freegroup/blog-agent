import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

/**
 * Loads all briefings from the folder. All are active; each is a channel.
 *
 * Frontmatter carries `name` and the sink roles; the body is the system prompt.
 * A channel has one authoritative destination and may fan out to helpers:
 *   - `target-sink`     (required) the real publication — GitHub, a blog, ….
 *                       Its failure retries the job and eventually dead-letters.
 *   - `logging-sink`    (optional) a best-effort debug copy — e.g. the file sink.
 *                       Gets the same payload; its failure never blocks publishing.
 *   - `deadletter-sink` (optional) where a permanently failed pitch is reported.
 * Tone and form are set by the channel, so its target URLs live in the same file
 * as the voice.
 *
 * @typedef {{name:string, when:string|null, targetSink:string, loggingSink:string|null, deadletterSink:string|null, prompt:string, file:string}} Briefing
 */
export function loadBriefings(dir) {
  const briefings = [];

  for (const file of readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
    const raw = readFileSync(path.join(dir, file), "utf8");
    const { meta, body } = splitFrontmatter(raw);

    if (!meta.name) throw new Error(`${file}: 'name' missing from frontmatter`);
    if (!meta["target-sink"]) throw new Error(`${file}: 'target-sink' missing from frontmatter`);
    if (!body.trim()) throw new Error(`${file}: briefing is empty`);

    briefings.push({
      name: meta.name,
      // The channel's own responsibility rule, in the first person, phrased against
      // the user's TEXT (not the destination): dispatch reads it to decide whether
      // this channel applies to a pitch. Optional for now — dispatch is not built yet.
      when: meta.when ?? null,
      targetSink: meta["target-sink"],
      loggingSink: meta["logging-sink"] ?? null,
      deadletterSink: meta["deadletter-sink"] ?? null,
      prompt: body.trim(),
      file,
    });
  }

  if (!briefings.length) throw new Error(`No briefings in ${dir} — the newsroom would have nothing to do`);
  return briefings;
}

/** Frontmatter is real YAML, so a value can be a multiline block scalar (`when: |`). */
function splitFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: text };
  const meta = parse(match[1]) ?? {};
  return { meta, body: match[2] };
}
