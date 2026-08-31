/**
 * The contract every stage implements.
 *
 *     doc = await stage.run(doc, ctx)
 *
 * A stage receives its predecessor's result and returns the next one. It knows
 * nothing about which stages ran before it or come after — only which fields it
 * reads and which it adds. There is no shared mutable state and no merging done
 * behind its back: whatever it returns IS the next stage's input.
 *
 * That is what makes the pipeline a list. Inserting a translation step between
 * `article` and `description` is one new file returning `{...doc, markdown: …}`
 * and one new entry in `newsroom.pipeline` — no other stage changes.
 *
 * @typedef {{name:string, data:string}} Image  data = base64 WebP
 *
 * @typedef {Object} Doc  grows as it flows; every field is written by exactly one stage
 * @property {string} text            the pitch, verbatim
 * @property {Image[]} images         attached photos in; the final published set out (← illustrate)
 * @property {string} [plot]          ← plot
 * @property {string} [markdown]      ← article (also PLACES the image references)
 * @property {object[]} [toolLog]     ← article: the tool calls actually made
 * @property {Image[]} [imagesDropped] ← illustrate: attached photos the article did not reference
 * @property {string} [description]   ← description
 * @property {string} [title]         ← title
 * @property {string} [slug]          ← slug
 * @property {string} [created]       set by the newsroom, once — preserved across revisions
 * @property {string} [updated]       set by the newsroom on every run
 * @property {Comment[]} [review]     revision only: the comment history driving the change
 * @property {boolean} [revise]       revision only: stages then edit their field instead of writing fresh
 *
 * `article` places `![…](foto-N.webp)` references but owns no bytes; `illustrate`
 * then fulfils them — keeping attached photos, generating missing ones — and sets
 * `images` to exactly the referenced, path-safe pictures it has bytes for.
 *
 * `review`/`revise` are runtime-only: reconstructed from the envelope on every
 * run (so `blogagent.yaml` and the queue doc stay the article's truth), never
 * persisted by `persistable`.
 *
 * @typedef {Object} StageContext
 * @property {import('@blogagent/llm').LlmProvider|null} llm  resolved per stage, may be shared
 * @property {object[]} mcpTools      empty unless the stage asked for tools
 * @property {Function} callMcpTool
 * @property {import('@blogagent/image').ImageProvider|null} [image]  set only when configured; used by illustrate
 * @property {object} briefing        the channel's voice; same system prompt for every stage
 */
export class Stage {
  /** @param {string} name  must match the key in `newsroom.stages` */
  constructor(name) {
    this.name = name;
  }

  /**
   * @param {Doc} _doc   whatever the previous stage returned
   * @param {StageContext} _ctx
   * @returns {Promise<Doc>} the next stage's input
   */
  async run(_doc, _ctx) {
    throw new Error(`stage '${this.name}': run() not implemented`);
  }
}

/** Thrown when a stage cannot produce something usable. Ends the attempt. */
export class StageError extends Error {
  constructor(stage, message) {
    super(`stage '${stage}': ${message}`);
    this.stage = stage;
  }
}

/**
 * The document as it is stored in the queue file.
 *
 * Only the images are dropped — base64 belongs in no file meant for reading,
 * and the pictures are rebuilt from the envelope anyway. Their names stay,
 * because which ones the article kept is a decision, not payload.
 *
 * `imagesDropped` is a debugging aid for the file sink, not queue state, and its
 * base64 has no place in a readable file either — it is left out entirely.
 */
export function persistable({ images = [], imagesDropped, review, revise, ...rest }) {
  return { ...rest, image_names: images.map((i) => i.name) };
}

/** The reverse: a stored document plus freshly resized pictures. */
export function rehydrate(stored, images) {
  const { image_names = [], ...rest } = stored;
  return { ...rest, images: images.filter((i) => image_names.includes(i.name)) };
}
