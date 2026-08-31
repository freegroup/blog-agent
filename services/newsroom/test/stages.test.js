import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { PlotStage } from "../pipeline/plot.js";
import { IllustrateStage } from "../pipeline/illustrate.js";
import { ArticleStage, problemsWith } from "../pipeline/article.js";
import { DescriptionStage } from "../pipeline/description.js";
import { TitleStage } from "../pipeline/title.js";
import { SlugStage } from "../pipeline/slug.js";
import { pitchText, reviewNote } from "../pipeline/converse.js";
import { persistable } from "../pipeline/stage.js";

/**
 * Fake LLM: answers in sequence. `seen` snapshots each request, because the
 * conversation keeps mutating the same messages array — a stored reference
 * would only ever show the final state.
 */
function fakeLlm(replies) {
  const seen = [];
  return {
    seen,
    complete: async (req) => {
      seen.push({ ...req, messages: structuredClone(req.messages) });
      const next = replies.shift();
      if (!next) throw new Error("fake LLM out of replies");
      return next;
    },
  };
}

const prose = (text) => ({ text, stopReason: "end", toolCalls: [] });
const submits = (input) => ({
  text: "",
  stopReason: "tool_use",
  toolCalls: [{ type: "tool_use", id: "t1", name: "artikel_abgeben", input }],
});
/** An illustrate reply: prompts for the placeholders to (re)draw — [{name, prompt}]. */
const bilds = (items) => ({
  text: "",
  stopReason: "tool_use",
  toolCalls: [{ type: "tool_use", id: "i1", name: "bild_prompts", input: { images: items } }],
});

const ctxWith = (llm, over = {}) => ({
  llm,
  mcpTools: [],
  callMcpTool: async () => "",
  briefing: { prompt: "Du schreibst." },
  ...over,
});

const DOC = (over = {}) => ({ text: "5 m, 40 A, 12 V — welcher Querschnitt?", images: [], ...over });

// ------------------------------------------------------------------ plot

test("plot writes a treatment and keeps the pitch out of it", async () => {
  const llm = fakeLlm([prose("- Fall: Rechenfrage\n- Querschnitt aus Strom und Länge\n- Rechner verlinken\n- 35 mm² gerechnet")]);
  const out = await new PlotStage().run(DOC(), ctxWith(llm));
  assert.match(out.plot, /Rechenfrage/);
  assert.equal(out.markdown, undefined, "plot writes nothing but the plot");
});

test("plot rejects an answer that only echoes the pitch", async () => {
  const pitch = "Mich hat jemand gefragt: fünf Meter Kabel zur Sitzbank, vierzig Ampere, zwölf Volt, welcher Querschnitt denn nun";
  const llm = fakeLlm([prose(pitch), prose("- Fall: Rechenfrage\n- Rechenweg zeigen\n- Rechner verlinken\n- Absicherung erwähnen")]);
  const out = await new PlotStage().run(DOC({ text: pitch }), ctxWith(llm));
  assert.equal(llm.seen.length, 2, "asked again");
  assert.match(llm.seen[1].messages.at(-1).content[0].text, /wiederholt nur den Pitch/);
  assert.match(out.plot, /Rechenweg/);
});

// --------------------------------------------------------------- article

test("article returns the markdown from the tool call", async () => {
  const llm = fakeLlm([submits({ markdown: "Ein Absatz." })]);
  const out = await new ArticleStage().run(DOC({ plot: "Drehbuch" }), ctxWith(llm));
  assert.equal(out.markdown, "Ein Absatz.");
});

test("article sees the plot, not just the pitch", async () => {
  const llm = fakeLlm([submits({ markdown: "Text." })]);
  await new ArticleStage().run(DOC({ plot: "DAS-DREHBUCH" }), ctxWith(llm));
  assert.match(llm.seen[0].messages[0].content.at(-1).text, /DAS-DREHBUCH/);
});

test("article is asked again when it narrates instead of submitting", async () => {
  const llm = fakeLlm([prose("Zuerst rechne ich mal…"), submits({ markdown: "Text." })]);
  const out = await new ArticleStage().run(DOC({ plot: "p" }), ctxWith(llm));
  assert.match(llm.seen[1].messages.at(-1).content[0].text, /artikel_abgeben/);
  assert.equal(out.markdown, "Text.");
});

test("article does not check image references — illustrate fulfils them", () => {
  // A reference to a not-yet-generated image is fine; filling it is the next stage's job.
  assert.deepEqual(problemsWith({ markdown: "Text ![Klemme](foto-9.webp) mehr." }), []);
});

test("article leaves the attached photos untouched (no filtering here anymore)", async () => {
  const llm = fakeLlm([submits({ markdown: "Text mit ![eins](foto-1.webp)." })]);
  const out = await new ArticleStage().run(
    DOC({ plot: "p", images: [{ name: "foto-1.webp", data: "AAA" }, { name: "foto-2.webp", data: "BBB" }] }),
    ctxWith(llm),
  );
  assert.deepEqual(out.images.map((i) => i.name), ["foto-1.webp", "foto-2.webp"], "illustrate reconciles later, not article");
  assert.equal(out.imagesDropped, undefined, "dropping is illustrate's job now");
});

test("article still requires absolute links in its own prose", () => {
  assert.match(problemsWith({ markdown: "[Rechner](/de/rechner/)" })[0], /nicht absolut/);
  assert.deepEqual(problemsWith({ markdown: "[R](https://x.de/) und [runter](#quellen)" }), []);
});

test("a broken article is corrected in the same session, not passed on", async () => {
  const llm = fakeLlm([
    submits({ markdown: "[Rechner](/de/)" }),
    submits({ markdown: "[Rechner](https://camper-elektrik-planer.de/de/)" }),
  ]);
  const out = await new ArticleStage().run(DOC({ plot: "p" }), ctxWith(llm));
  const handback = llm.seen[1].messages.at(-1).content[0];
  assert.equal(handback.is_error, true);
  assert.match(handback.content, /nicht absolut/);
  assert.match(out.markdown, /^\[Rechner\]\(https/);
});

// --------------------------------------------------------------- illustrate

const PNG = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toBuffer();

/** An image provider that hands back a real (tiny) picture and records its use. */
function fakeImage() {
  const calls = [];
  return { calls, generate: async (req) => (calls.push(req), { bytes: PNG, mime: "image/png" }) };
}

const boom = { generate: async () => { throw new Error("generate should not be called"); } };

test("illustrate fills a placeholder the article left, and never touches the markdown", async () => {
  const image = fakeImage();
  const doc = DOC({ markdown: "Absatz.\n\n![Klemme](foto-1.webp)\n\nmehr." });
  const out = await new IllustrateStage().run(doc, ctxWith(fakeLlm([bilds([{ name: "foto-1.webp", prompt: "a wago clamp" }])]), { image }));
  assert.deepEqual(out.images.map((i) => i.name), ["foto-1.webp"]);
  assert.equal(image.calls[0].prompt, "a wago clamp");
  const meta = await sharp(Buffer.from(out.images[0].data, "base64")).metadata();
  assert.equal(meta.format, "webp", "stored as WebP like any pipeline image");
  assert.equal(out.markdown, doc.markdown, "the prose is never rewritten");
});

test("illustrate keeps a referenced attached photo without a model call", async () => {
  const llm = fakeLlm([]); // nothing missing, not a revision → no decision needed
  const doc = DOC({ markdown: "![](foto-1.webp)", images: [{ name: "foto-1.webp", data: "USER" }] });
  const out = await new IllustrateStage().run(doc, ctxWith(llm, { image: boom }));
  assert.deepEqual(out.images, [{ name: "foto-1.webp", data: "USER" }]);
  assert.equal(llm.seen.length, 0, "nothing to draw → no model call, no generation");
});

test("illustrate keeps the photo and fills only the extra placeholder", async () => {
  const image = fakeImage();
  const doc = DOC({ markdown: "![](foto-1.webp)\n\n![](foto-2.webp)", images: [{ name: "foto-1.webp", data: "USER" }] });
  const out = await new IllustrateStage().run(doc, ctxWith(fakeLlm([bilds([{ name: "foto-2.webp", prompt: "detail" }])]), { image }));
  assert.deepEqual(out.images.map((i) => i.name), ["foto-1.webp", "foto-2.webp"]);
  assert.equal(out.images[0].data, "USER", "the sender's picture is untouched");
  assert.equal(image.calls.length, 1, "only the missing one is drawn");
});

test("illustrate is a no-op without an image provider — dead refs stay, no model call", async () => {
  const llm = fakeLlm([]);
  const out = await new IllustrateStage().run(DOC({ markdown: "![](foto-1.webp)" }), ctxWith(llm)); // ctx.image undefined
  assert.deepEqual(out.images, []);
  assert.equal(llm.seen.length, 0, "the provider gate comes before the model");
});

test("illustrate ignores a path-unsafe reference — never fulfilled, never delivered", async () => {
  const llm = fakeLlm([]);
  const out = await new IllustrateStage().run(DOC({ markdown: "![x](../../secret.webp)" }), ctxWith(llm, { image: boom }));
  assert.deepEqual(out.images, [], "an unsafe name is not a placeholder to fill");
  assert.equal(llm.seen.length, 0);
});

test("a failed generation leaves the placeholder as a dead link", async () => {
  const doc = DOC({ markdown: "![](foto-1.webp)" });
  const out = await new IllustrateStage().run(doc, ctxWith(fakeLlm([bilds([{ name: "foto-1.webp", prompt: "p" }])]), { image: boom }));
  assert.deepEqual(out.images, [], "no bytes → no image published");
  assert.equal(out.markdown, "![](foto-1.webp)", "the reference stays; markdown untouched");
});

test("an attached photo the article never referenced is dropped", async () => {
  const doc = DOC({ markdown: "Kein Bild hier.", images: [{ name: "foto-1.webp", data: "USER" }] });
  const out = await new IllustrateStage().run(doc, ctxWith(fakeLlm([]), { image: boom }));
  assert.deepEqual(out.images, []);
  assert.deepEqual(out.imagesDropped.map((i) => i.name), ["foto-1.webp"]);
});

// ----------------------------------------------------- description / title

test("description unwraps a labelled, quoted answer", async () => {
  const llm = fakeLlm([prose('Beschreibung: "Zu dünne Leitungen sind der häufigste Fehler im Camper-Ausbau — so rechnest du richtig."')]);
  const out = await new DescriptionStage().run(DOC({ plot: "p", markdown: "m" }), ctxWith(llm));
  assert.equal(out.description, "Zu dünne Leitungen sind der häufigste Fehler im Camper-Ausbau — so rechnest du richtig.");
});

test("description is asked again when it is too short", async () => {
  const llm = fakeLlm([prose("Zu kurz."), prose("Zu dünne Leitungen sind der häufigste Fehler im Camper-Ausbau — so rechnest du den Querschnitt richtig aus.")]);
  const out = await new DescriptionStage().run(DOC({ plot: "p", markdown: "m" }), ctxWith(llm));
  assert.match(llm.seen[1].messages.at(-1).content[0].text, /Zu kurz/);
  assert.ok(out.description.length >= 80);
});

test("title rejects what cannot become a URL", async () => {
  const llm = fakeLlm([prose("？？？ ＄＄ ！！ ——— ,,, ;;; ((( ))) ***"), prose("Kabelquerschnitt bei 40 A und 5 m Länge")]);
  const out = await new TitleStage().run(DOC({ plot: "p", markdown: "m" }), ctxWith(llm));
  assert.equal(out.title, "Kabelquerschnitt bei 40 A und 5 m Länge");
});

test("description and title get no tools", async () => {
  for (const Kind of [DescriptionStage, TitleStage]) {
    const llm = fakeLlm([prose("Zu dünne Leitungen sind der häufigste Fehler im Camper-Ausbau — so rechnest du das sauber aus.")]);
    await new Kind().run(DOC({ plot: "p", markdown: "m" }), ctxWith(llm));
    assert.deepEqual(llm.seen[0].tools, [], `${Kind.name} was offered tools`);
  }
});

// ------------------------------------------------------------------ slug

test("slug needs no model at all", async () => {
  const out = await new SlugStage().run(DOC({ title: "Kabelquerschnitt im Wohnmobil: 40 A über 5 m" }), { llm: null });
  assert.equal(out.slug, "kabelquerschnitt-im-wohnmobil-40-a-ueber-5-m");
});

test("slug fails loudly rather than inventing one", async () => {
  await assert.rejects(new SlugStage().run(DOC({ title: "!!!" }), { llm: null }), /keine URL/);
});

// ----------------------------------------------------- revision (review mode)

const REVIEW = [{ author: "chef", body: "Mach den zweiten Absatz kürzer." }];
const REVDOC = (over = {}) => DOC({ revise: true, review: REVIEW, ...over });

test("reviewNote is empty on a fresh run and carries history + own state on a revision", () => {
  assert.equal(reviewNote(DOC(), "Artikel", "x"), "", "nothing added when not revising");
  const note = reviewNote(REVDOC(), "Drehbuch", "ALTES DREHBUCH");
  assert.match(note, /ÜBERARBEITUNG/);
  assert.match(note, /Mach den zweiten Absatz kürzer/);
  assert.match(note, /ALTES DREHBUCH/);
  assert.match(note, /UNVERÄNDERT/);
});

test("persistable strips runtime-only review/revise (blogagent.yaml stays the article's truth)", () => {
  const meta = persistable(REVDOC({ plot: "P", slug: "s", images: [{ name: "foto-1.webp", data: "AA" }] }));
  assert.equal(meta.revise, undefined);
  assert.equal(meta.review, undefined);
  assert.equal(meta.plot, "P");
  assert.deepEqual(meta.image_names, ["foto-1.webp"]);
});

test("plot on a revision sees the review and its old treatment, and may pass it through", async () => {
  const OLD = "- Fall: Rechenfrage\n- Querschnitt aus Strom und Länge herleiten\n- durchgerechnetes Beispiel: 35 mm²\n- am Ende den Rechner verlinken";
  const llm = fakeLlm([prose(OLD)]); // model decides nothing needs changing
  const out = await new PlotStage().run(REVDOC({ plot: OLD }), ctxWith(llm));
  assert.equal(out.plot, OLD, "passthrough is allowed — no 'repeats the pitch' rejection on a revision");
  assert.equal(llm.seen.length, 1);
  assert.match(llm.seen[0].messages[0].content.at(-1).text, /ÜBERARBEITUNG/);
});

test("illustrate keeps the existing image when the review does not ask for a new one", async () => {
  const image = fakeImage();
  const doc = REVDOC({ markdown: "![](foto-1.webp)", images: [{ name: "foto-1.webp", data: "OLD" }] });
  const out = await new IllustrateStage().run(doc, ctxWith(fakeLlm([bilds([])]), { image }));
  assert.deepEqual(out.images, [{ name: "foto-1.webp", data: "OLD" }], "image untouched");
  assert.equal(image.calls.length, 0, "no redraw for a text-only review");
});

test("illustrate redraws only when the review asks to change the image", async () => {
  const image = fakeImage();
  const doc = REVDOC({ markdown: "![](foto-1.webp)", review: [{ author: "chef", body: "Nimm ein anderes Titelbild." }], images: [{ name: "foto-1.webp", data: "OLD" }] });
  const out = await new IllustrateStage().run(doc, ctxWith(fakeLlm([bilds([{ name: "foto-1.webp", prompt: "a brighter camper photo" }])]), { image }));
  assert.equal(image.calls.length, 1, "the review asked for a new image");
  assert.equal(out.images[0].name, "foto-1.webp", "replaced in place so the markdown reference still holds");
  assert.notEqual(out.images[0].data, "OLD");
});

test("slug stays fixed on a revision unless the review asks to rename", async () => {
  const keep = await new SlugStage().run(REVDOC({ slug: "alt-slug", title: "Neuer Titel" }), ctxWith(fakeLlm([prose("KEEP")])));
  assert.equal(keep.slug, "alt-slug", "identity — the URL does not move for a text edit");

  const renamed = await new SlugStage().run(
    REVDOC({ slug: "alt-slug", title: "x", review: [{ author: "chef", body: "Bitte den Dateinamen ändern." }] }),
    ctxWith(fakeLlm([prose("Besserer Name")])),
  );
  assert.equal(renamed.slug, "besserer-name", "a requested rename is slugified");
});

// ----------------------------------------------------------------- pitchText

test("the pitch reaches the model as an editorial pitch", () => {
  const text = pitchText({ text: "Mach was draus" });
  assert.match(text, /CHEFREDAKTION/);
  assert.match(text, /Mach was draus/);
});
