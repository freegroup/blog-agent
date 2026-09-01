import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseChannels } from "../dispatch.js";

/**
 * Fake LLM answering in sequence. Each reply is a canonical `Reply`; a
 * tool_use reply carries the channel selection the way an adapter would.
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

/** A tool_use reply choosing the given channel names. */
function chose(channels, id = "t1") {
  return {
    text: "",
    toolCalls: [{ type: "tool_use", id, name: "choose_channels", input: { channels } }],
    stopReason: "tool_use",
  };
}

const BRIEFINGS = [
  { name: "camper-blog", when: "Wohnmobil, 12-V-Elektrik, Kabelquerschnitt." },
  { name: "telegram-chat", when: "Nur wenn der User ausdrücklich eine kurze Chat-Fassung will." },
  { name: "pinterest-01", when: "Wenn ein Pin aus einer URL gemacht werden soll." },
];

test("returns exactly the chosen subset", async () => {
  const llm = fakeLlm([chose(["camper-blog"])]);
  const out = await chooseChannels({ text: "Artikel über Kabelquerschnitt", briefings: BRIEFINGS, llm });
  assert.deepEqual(out, ["camper-blog"]);
});

test("no matching channel yields an empty list", async () => {
  const llm = fakeLlm([chose([])]);
  const out = await chooseChannels({ text: "völlig fremdes Thema", briefings: BRIEFINGS, llm });
  assert.deepEqual(out, []);
});

test("an unknown name is rejected and the model is asked again", async () => {
  const llm = fakeLlm([chose(["camper-blogg"]), chose(["camper-blog"])]);
  const out = await chooseChannels({ text: "Kabelquerschnitt", briefings: BRIEFINGS, llm });
  assert.deepEqual(out, ["camper-blog"]);
  assert.equal(llm.seen.length, 2, "should re-ask after the invalid name");
});

test("result follows roster order and de-duplicates", async () => {
  const llm = fakeLlm([chose(["pinterest-01", "camper-blog", "camper-blog"])]);
  const out = await chooseChannels({ text: "mach einen Pin und einen Artikel", briefings: BRIEFINGS, llm });
  assert.deepEqual(out, ["camper-blog", "pinterest-01"]);
});

test("offers only the terminal tool (no MCP tools)", async () => {
  const llm = fakeLlm([chose(["camper-blog"])]);
  await chooseChannels({ text: "x", briefings: BRIEFINGS, llm });
  const req = llm.seen[0];
  assert.equal(req.tools.length, 1);
  assert.equal(req.tools[0].name, "choose_channels");
});

test("the roster lists every briefing's remit", async () => {
  const llm = fakeLlm([chose([])]);
  await chooseChannels({ text: "x", briefings: BRIEFINGS, llm });
  const firstUserText = llm.seen[0].messages[0].content.at(-1).text;
  assert.ok(firstUserText.includes("camper-blog"));
  assert.ok(firstUserText.includes("telegram-chat"));
  assert.ok(firstUserText.includes("pinterest-01"));
});
