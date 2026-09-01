import { readFileSync, writeFileSync, existsSync } from "node:fs";

/**
 * Upsert a single `KEY=value` line in a .env file, preserving every other line
 * (comments, blank lines, other keys) and their order.
 *
 * The Pinterest sink calls this to persist its refresh token back into .env — the
 * same file the config loader reads on the next start. Pinterest may hand out a
 * rotated refresh token on any refresh, so the value has to survive restarts, and
 * a static .env line the sink never updates would eventually go stale.
 *
 * @param {string} path  path to the .env file
 * @param {string} key   the variable name, e.g. "PINTEREST_REFRESH_TOKEN"
 * @param {string} value the new value (written verbatim, unquoted)
 */
export function upsertEnvVar(path, key, value) {
  const line = `${key}=${value}`;
  let content = existsSync(path) ? readFileSync(path, "utf8") : "";

  // Match an existing assignment of this exact key (leading whitespace allowed),
  // and only that line — `^…$` with the `m` flag stays within one line.
  const assignment = new RegExp(`^[ \\t]*${escapeRegExp(key)}=.*$`, "m");
  if (assignment.test(content)) {
    content = content.replace(assignment, line);
  } else {
    if (content && !content.endsWith("\n")) content += "\n";
    content += `${line}\n`;
  }
  writeFileSync(path, content);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
