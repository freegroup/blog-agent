/**
 * Minimal RSS parsing — pure, so it is testable without the network.
 *
 * The feed is our own site's, small and stable, so a regex over <item> blocks is
 * enough; we do not pull in an XML dependency for four fields. Each item yields
 * its permalink (guid, the dedup key), title, and link.
 */
export function parseFeed(xml) {
  return [...xml.matchAll(/<item\b[\s\S]*?<\/item>/g)]
    .map((m) => m[0])
    .map((block) => {
      const link = tag(block, "link");
      return {
        guid: tag(block, "guid") || link,
        title: decodeEntities(tag(block, "title")),
        link,
      };
    })
    .filter((it) => it.link);
}

/** The slug is the last path segment of a `…/blog/<slug>/` URL — or null. */
export function slugOf(link) {
  const m = (link ?? "").match(/\/blog\/([^/?#]+)\/?(?:[?#]|$)/);
  return m ? m[1] : null;
}

/** Items whose guid is not in `seen`, newest-first as the feed lists them. */
export function freshItems(items, seen) {
  return items.filter((it) => !seen.has(it.guid));
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  if (!m) return "";
  return m[1]
    .replace(/^\s*<!\[CDATA\[/, "")
    .replace(/\]\]>\s*$/, "")
    .trim();
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'");
}
