import { readFileSync, existsSync } from "node:fs";
import { parse } from "yaml";

// Node does not auto-load .env. Do it once on module load so every service
// finds its secrets without needing explicit exports.
// Already-set variables win — the environment overrides the file.
if (existsSync(".env")) process.loadEnvFile(".env");

const DEFAULT_PATH = "./settings.yaml";

/** Pre-YAML config file. Kept only to refuse startup rather than read it. */
const LEGACY_PATH = "./settings.ini";

/**
 * Reads settings.yaml. Operational parameters only — secrets come from the
 * environment. Values keep their YAML types; callers still go through
 * num()/str()/bool() so a hand-edited string does not become a silent NaN.
 */
export function loadSettings(path = DEFAULT_PATH) {
  // A left-over settings.ini next to the YAML would sit there unread while
  // someone edits it and wonders why nothing changes — refuse instead.
  if (path === DEFAULT_PATH && existsSync(LEGACY_PATH)) {
    throw new Error(
      `${LEGACY_PATH} still exists but is no longer read — the format is YAML now. ` +
        `Port any local changes into ${DEFAULT_PATH} and delete ${LEGACY_PATH}.`,
    );
  }

  const settings = parse(readFileSync(path, "utf8"));
  if (settings === null || typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error(`${path}: expected a mapping at the top level`);
  }
  return settings;
}

/**
 * Section with typed accessors. `name` may be a dotted path, so nested config
 * — `llm-profiles.default` — reaches the same accessors a top-level section gets,
 * and createLlm() does not need to know which of the two it was handed.
 *
 * A missing section is NOT tolerated: every caller names a section it expects to
 * exist, and swallowing the absence hides typos behind the per-key fallbacks.
 * That is exactly how `[redaktion]` stayed invisible while the code read
 * `newsroom` — every value silently came from a default that happened to match.
 */
export function section(settings, name) {
  let values = settings;
  for (const key of name.split(".")) {
    values = values?.[key];
    if (values === undefined) throw new Error(`settings.yaml: section '${name}' is missing`);
  }
  if (typeof values !== "object" || values === null || Array.isArray(values)) {
    throw new Error(`settings.yaml: '${name}' is not a mapping`);
  }

  const need = (key, fallback) => {
    const v = values[key] ?? fallback;
    if (v === undefined) throw new Error(`settings.yaml: ${name}.${key} missing`);
    return v;
  };
  return {
    str: (key, fallback) => String(need(key, fallback)),
    num: (key, fallback) => {
      const n = Number(need(key, fallback));
      if (Number.isNaN(n)) throw new Error(`settings.yaml: ${name}.${key} is not a number`);
      return n;
    },
    bool: (key, fallback) => {
      const v = need(key, fallback);
      return typeof v === "boolean" ? v : ["true", "1", "yes"].includes(String(v).toLowerCase());
    },
  };
}

/** Secret from the environment. Throws early rather than getting a 401 later. */
export function secret(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Environment variable ${name} missing — see .env.example`);
  return value;
}
