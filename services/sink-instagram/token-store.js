import { readFileSync, writeFileSync, existsSync } from "node:fs";

/**
 * Upsert a single `KEY=value` line in a .env file, preserving every other line.
 * Copied from sink-pinterest — both sinks manage their own token state in .env.
 */
export function upsertEnvVar(path, key, value) {
  const line = `${key}=${value}`;
  let content = existsSync(path) ? readFileSync(path, "utf8") : "";
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
