/**
 * Validates what the newsroom submits.
 *
 * Lives here rather than in the prompt: slug and image names come from an LLM,
 * and both become file paths. `../../.github/workflows/deploy.yml` is a
 * realistic value, not paranoia.
 */
import { getImageData } from "@blogagent/image";

const SLUG = /^[a-z0-9][a-z0-9-]{2,60}$/;
const IMAGE_NAME = /^[a-z0-9][a-z0-9-]{0,60}\.webp$/;

/** Image references from the markdown: ![alt](name.webp) */
function imageRefs(markdown) {
  return [...markdown.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]);
}

/** All link targets from the markdown: [text](url) — excluding image syntax. */
function linkTargets(markdown) {
  return [...markdown.matchAll(/(?<!!)\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]);
}

/**
 * @returns {string[]} Errors; empty means valid.
 */
export function validatePublish(payload, { maxBildBytes }) {
  const errors = [];
  const { slug, title, description, markdown, images } = payload ?? {};

  if (typeof slug !== "string" || !SLUG.test(slug)) {
    errors.push(`slug must match ${SLUG}`);
  }
  if (typeof title !== "string" || !title.trim()) errors.push("title missing");
  if (typeof description !== "string" || !description.trim()) errors.push("description missing");
  if (typeof markdown !== "string" || !markdown.trim()) errors.push("markdown missing");
  if (!Array.isArray(images)) errors.push("images must be an array");

  if (errors.length) return errors;

  for (const [i, img] of images.entries()) {
    if (typeof img?.name !== "string" || !IMAGE_NAME.test(img.name)) {
      errors.push(`images[${i}].name must match ${IMAGE_NAME}`);
      continue;
    }
    if (typeof img.data !== "string" || !img.data) {
      errors.push(`images[${i}].data missing`);
      continue;
    }
    const bytes = Buffer.byteLength(getImageData(img.data), "base64");
    if (bytes > maxBildBytes) {
      errors.push(`images[${i}] is ${bytes} bytes, limit is ${maxBildBytes}`);
    }
  }

  // Bidirectional reference check — prevents broken image tags and orphaned blobs.
  const referenced = new Set(imageRefs(markdown));
  const delivered = new Set(images.map((b) => b?.name).filter(Boolean));

  for (const name of referenced) {
    if (!delivered.has(name)) errors.push(`markdown references '${name}' but it was not supplied`);
  }
  for (const name of delivered) {
    if (!referenced.has(name)) errors.push(`image '${name}' is not referenced in markdown`);
  }

  // Absolute links: the newsroom does not know which channel the text lands in.
  for (const target of linkTargets(markdown)) {
    if (target.startsWith("#")) continue;
    if (!/^https?:\/\//.test(target)) {
      errors.push(`link '${target}' is not absolute`);
    }
  }

  return errors;
}

export const _intern = { imageRefs, linkTargets, SLUG, IMAGE_NAME };
