/**
 * Title → URL slug, satisfying the sink's rule `^[a-z0-9][a-z0-9-]{2,60}$`
 * (services/sink-github/validate.js).
 *
 * German first: `ä → ae` reads correctly, while the generic accent-stripping
 * that follows would turn it into a bare `a`. Order matters.
 *
 * @returns {string} the slug, or "" when the title yields nothing usable —
 *          the caller decides what that means, this function does not invent one.
 */
const GERMAN = { ä: "ae", ö: "oe", ü: "ue", ß: "ss" };

const MAX = 61;
const MIN = 3;

export function slugify(title) {
  const slug = String(title ?? "")
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => GERMAN[c])
    // Everything else that carries a diacritic: é → e, å → a.
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX)
    // The cut may have landed on a separator.
    .replace(/-+$/, "");

  return slug.length >= MIN ? slug : "";
}
