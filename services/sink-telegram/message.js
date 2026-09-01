// Telegram caps a text message at 4096 characters. We compose plain text
// (send_message takes no parse_mode), so the budget is characters, not markup.
export const TELEGRAM_LIMIT = 4096;

// A photo/media-group caption is capped far lower than a text message. When the
// article text fits here it rides along as the caption of the photo group;
// otherwise the photos go first and the full text follows as its own message.
export const TELEGRAM_CAPTION_LIMIT = 1024;

/**
 * Builds the chat message from a finished article. Plain text, no markup —
 * `send_message` sends exactly these characters. The article's image placeholders
 * (`![caption](foto-N.webp)`) are stripped: Telegram has no inline image markup,
 * and the pictures ride separately as a photo group (see planDelivery), so a raw
 * placeholder in the text would just be noise. Overlong articles are truncated
 * with a visible marker so the message never exceeds Telegram's limit.
 *
 * @param {{title?:string, description?:string, markdown?:string, revises?:string|null}} payload
 * @param {{limit?:number}} [opts]
 * @returns {string}
 */
export function composeMessage(payload, { limit = TELEGRAM_LIMIT } = {}) {
  const { title, description, markdown, revises } = payload ?? {};

  const header = revises ? "✏️ Artikel aktualisiert" : "✅ Neuer Artikel";
  const blocks = [header];
  if (title?.trim()) blocks.push(title.trim());
  if (description?.trim()) blocks.push(description.trim());
  const body = stripImageMarkers(markdown ?? "");
  if (body) blocks.push(body);

  let text = blocks.join("\n\n");
  if (text.length > limit) {
    const marker = "\n\n… (gekürzt)";
    text = text.slice(0, limit - marker.length).trimEnd() + marker;
  }
  return text;
}

/**
 * Remove `![caption](foto-N.webp)` image placeholders from the article body and
 * tidy the whitespace they leave behind. The images are delivered as a photo
 * group, not inline, so the marker has no place in the plain-text message.
 */
export function stripImageMarkers(markdown) {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // drop the ![...](...) markers
    .replace(/[ \t]+\n/g, "\n") // trailing spaces left where a marker sat
    .replace(/\n{3,}/g, "\n\n") // collapse the blank lines they leave behind
    .trim();
}

/**
 * Decides how to deliver an article to Telegram, given the composed text and how
 * many photos there are. Pure — no Telegram calls — so the branching is testable.
 *
 *  - No photos: one text message (or nothing, if there is no text either).
 *  - Photos + text that fits a caption: one photo group, the text as its caption.
 *  - Photos + text too long for a caption: the photo group first (no caption),
 *    then the full text as its own message.
 *  - Photos + no text: just the photo group.
 *
 * @param {{text:string, photoCount:number, captionLimit?:number}} arg
 * @returns {({kind:'photos', caption:boolean}|{kind:'message'})[]}
 */
export function planDelivery({ text, photoCount, captionLimit = TELEGRAM_CAPTION_LIMIT }) {
  const hasText = !!text?.trim();
  if (!photoCount) return hasText ? [{ kind: "message" }] : [];

  const asCaption = hasText && text.length <= captionLimit;
  const steps = [{ kind: "photos", caption: asCaption }];
  if (hasText && !asCaption) steps.push({ kind: "message" });
  return steps;
}
