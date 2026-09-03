import { test } from "node:test";
import assert from "node:assert/strict";
import { tidySentence, mergeSentences } from "../index.js";

/** Fake LLM: returns the queued reply and records the request it saw. */
function fakeLlm(reply) {
  const seen = [];
  return {
    seen,
    complete: async (req) => {
      seen.push(req);
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
}

test("returns the model's tidied text", async () => {
  const llm = fakeLlm({ text: "Hallo, ich hätte gern einen Artikel über Kabelquerschnitt." });
  const out = await tidySentence("hallo ich hätte gern nen artikl über kabelquershnitt", llm);
  assert.equal(out, "Hallo, ich hätte gern einen Artikel über Kabelquerschnitt.");
});

test("passes the raw text as the only user turn and no tools", async () => {
  const llm = fakeLlm({ text: "sauber" });
  await tidySentence("roh", llm);
  const req = llm.seen[0];
  assert.equal(req.messages[0].content[0].text, "roh");
  assert.deepEqual(req.tools, []);
  assert.ok(req.system.length > 0);
});

test("keeps a URL and a number verbatim (the model is trusted to)", async () => {
  const clean = "Mach einen Pin aus https://camper-elektrik-planer.de/ mit 16 mm².";
  const llm = fakeLlm({ text: clean });
  const out = await tidySentence("mach ein pin aus https://camper-elektrik-planer.de/ mit 16 mm2", llm);
  assert.ok(out.includes("https://camper-elektrik-planer.de/"));
  assert.ok(out.includes("16"));
});

test("falls back to the raw text when the model returns nothing", async () => {
  const llm = fakeLlm({ text: "   " });
  const out = await tidySentence("original", llm);
  assert.equal(out, "original");
});

test("falls back when the reply has no text field", async () => {
  const llm = fakeLlm({ toolCalls: [], stopReason: "end" });
  const out = await tidySentence("original", llm);
  assert.equal(out, "original");
});

test("propagates a provider error for the caller to handle", async () => {
  const llm = fakeLlm(new Error("LLM down"));
  await assert.rejects(() => tidySentence("original", llm), /LLM down/);
});

test("mergeSentences folds several questions into the model's one sentence", async () => {
  const llm = fakeLlm({ text: "Schick mir bitte das Bild und den Link für die Story." });
  const out = await mergeSentences(["Schick mir das Bild.", "Hast du den Link vergessen?"], llm);
  assert.equal(out, "Schick mir bitte das Bild und den Link für die Story.");
  // Both questions are handed to the model as the single user turn.
  assert.match(llm.seen[0].messages[0].content[0].text, /Bild/);
  assert.match(llm.seen[0].messages[0].content[0].text, /Link/);
});

test("mergeSentences returns the single question unchanged and never calls the model", async () => {
  const llm = fakeLlm(new Error("must not be called"));
  const out = await mergeSentences(["Hast du den Link vergessen?"], llm);
  assert.equal(out, "Hast du den Link vergessen?");
  assert.equal(llm.seen.length, 0);
});

test("mergeSentences ignores blank entries before deciding whether to merge", async () => {
  const llm = fakeLlm(new Error("must not be called"));
  const out = await mergeSentences(["", "  ", "Nur diese zählt."], llm);
  assert.equal(out, "Nur diese zählt.");
  assert.equal(llm.seen.length, 0);
});

test("mergeSentences falls back to joining the inputs when the model returns nothing", async () => {
  const llm = fakeLlm({ text: "   " });
  const out = await mergeSentences(["Erste Frage.", "Zweite Frage."], llm);
  assert.equal(out, "Erste Frage. Zweite Frage.");
});
