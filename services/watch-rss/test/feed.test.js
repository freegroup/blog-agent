import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFeed, slugOf, freshItems } from "../feed.js";

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Camper Elektrik Planer – Blog</title>
    <item>
      <title>Wohnmobil-Elektrik: W, A und Ah in Wh umrechnen</title>
      <link>https://camper-elektrik-planer.de/blog/wohnmobil-elektrik-w-a-ah/</link>
      <guid isPermaLink="true">https://camper-elektrik-planer.de/blog/wohnmobil-elektrik-w-a-ah/</guid>
      <pubDate>Mon, 31 Aug 2026 08:51:23 GMT</pubDate>
    </item>
    <item>
      <title>Wago-Klemmen &amp; Vibration im Camper</title>
      <link>https://camper-elektrik-planer.de/blog/wago-klemmen-vibration/</link>
      <guid isPermaLink="true">https://camper-elektrik-planer.de/blog/wago-klemmen-vibration/</guid>
    </item>
  </channel>
</rss>`;

test("parseFeed reads title, link and guid from each item", () => {
  const items = parseFeed(FEED);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, "Wohnmobil-Elektrik: W, A und Ah in Wh umrechnen");
  assert.equal(items[0].link, "https://camper-elektrik-planer.de/blog/wohnmobil-elektrik-w-a-ah/");
  assert.equal(items[0].guid, items[0].link);
  assert.equal(items[1].title, "Wago-Klemmen & Vibration im Camper", "entities decoded");
});

test("slugOf takes the last blog path segment", () => {
  assert.equal(slugOf("https://camper-elektrik-planer.de/blog/wago-klemmen-vibration/"), "wago-klemmen-vibration");
  assert.equal(slugOf("https://camper-elektrik-planer.de/blog/foo"), "foo");
  assert.equal(slugOf("https://example.com/"), null);
});

test("freshItems returns only what the seen-set does not contain", () => {
  const items = parseFeed(FEED);
  const seen = new Set([items[0].guid]);
  assert.deepEqual(
    freshItems(items, seen).map((i) => i.guid),
    [items[1].guid],
    "only the unseen post is fresh",
  );
  assert.deepEqual(freshItems(items, new Set(items.map((i) => i.guid))), [], "nothing new once all are seen");
});
