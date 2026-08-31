import { test } from "node:test";
import assert from "node:assert/strict";
import { extractUrl, lastUrl, buildContext, gather, enrich } from "../context.js";

const blogLive = (url) => ({ direction: "out", author: "watch-rss", meta: { kind: "blog-live", url } });
const said = (text) => ({ direction: "in", author: "user", text });

test("extractUrl finds a URL and strips trailing punctuation", () => {
  assert.equal(extractUrl("schau mal https://camper-elektrik-planer.de/blog/foo/."), "https://camper-elektrik-planer.de/blog/foo/");
  assert.equal(extractUrl("kein link hier"), null);
});

test("lastUrl prefers a structured blog-live entry over a URL in prose", () => {
  const recent = [said("hier https://example.com/alt"), blogLive("https://camper-elektrik-planer.de/blog/neu/")];
  assert.equal(lastUrl(recent), "https://camper-elektrik-planer.de/blog/neu/");
});

test("lastUrl falls back to the newest URL mentioned in any message", () => {
  const recent = [said("erst https://a.de/1"), said("dann https://a.de/2")];
  assert.equal(lastUrl(recent), "https://a.de/2");
});

test("an explicit URL in the pitch always wins", () => {
  const ctx = buildContext({ text: "pin https://a.de/x", recent: [blogLive("https://b.de/y")] });
  assert.equal(ctx.target_url, "https://a.de/x");
});

test("a back-reference resolves to the last URL from the conversation", () => {
  const ctx = buildContext({ text: "mach aus der letzten URL einen Pinterest-Pin", recent: [blogLive("https://b.de/y")] });
  assert.equal(ctx.target_url, "https://b.de/y");
});

test("no URL and no back-reference means no target", () => {
  assert.equal(buildContext({ text: "schreib was über Wago-Klemmen", recent: [blogLive("https://b.de/y")] }).target_url, null);
});

test("gather reads the (injected) history and resolves a back-reference", async () => {
  const ctx = await gather({ text: "nimm den letzten Blog und mach einen Pin" }, { getRecent: async () => [blogLive("https://b.de/live/")] });
  assert.equal(ctx.target_url, "https://b.de/live/");
});

test("gather survives a hub that is down — explicit URL still resolves", async () => {
  const ctx = await gather({ text: "pin https://a.de/z" }, { getRecent: async () => { throw new Error("hub down"); } });
  assert.equal(ctx.target_url, "https://a.de/z");
});

test("enrich attaches context to a fresh envelope", async () => {
  const env = { id: "1", text: "pin https://a.de/x", doc: null };
  const out = await enrich(env, { getRecent: async () => [] });
  assert.equal(out.context.target_url, "https://a.de/x");
  assert.deepEqual(out.context.reference_urls, []);
});

test("enrich leaves a revision untouched — its facts already live in doc", async () => {
  const env = { id: "1", text: "mach das Bild größer", doc: { slug: "x", context: { target_url: "https://keep.me/" } } };
  const out = await enrich(env, { getRecent: async () => [blogLive("https://other.de/")] });
  assert.equal(out, env, "same object, not re-enriched");
  assert.equal(out.context, undefined, "no top-level context added; doc.context is the truth");
});
