import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { upsertEnvVar } from "../token-store.js";

function withEnvFile(initial, fn) {
  const dir = mkdtempSync(join(tmpdir(), "pin-env-"));
  const path = join(dir, ".env");
  writeFileSync(path, initial);
  try {
    fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("upsertEnvVar replaces an existing key and leaves the rest untouched", () => {
  withEnvFile("# comment\nPINTEREST_APP_ID=abc\nPINTEREST_REFRESH_TOKEN=old\nOTHER=keep\n", (path) => {
    upsertEnvVar(path, "PINTEREST_REFRESH_TOKEN", "new");
    const out = readFileSync(path, "utf8");
    assert.equal(out, "# comment\nPINTEREST_APP_ID=abc\nPINTEREST_REFRESH_TOKEN=new\nOTHER=keep\n");
  });
});

test("upsertEnvVar appends the key when it is absent, keeping a trailing newline", () => {
  withEnvFile("PINTEREST_APP_ID=abc\n", (path) => {
    upsertEnvVar(path, "PINTEREST_REFRESH_TOKEN", "tok");
    assert.equal(readFileSync(path, "utf8"), "PINTEREST_APP_ID=abc\nPINTEREST_REFRESH_TOKEN=tok\n");
  });
});

test("upsertEnvVar adds a newline before appending when the file lacks one", () => {
  withEnvFile("PINTEREST_APP_ID=abc", (path) => {
    upsertEnvVar(path, "PINTEREST_REFRESH_TOKEN", "tok");
    assert.equal(readFileSync(path, "utf8"), "PINTEREST_APP_ID=abc\nPINTEREST_REFRESH_TOKEN=tok\n");
  });
});

test("upsertEnvVar only replaces the exact key, not a similarly-named one", () => {
  withEnvFile("PINTEREST_REFRESH_TOKEN_BACKUP=keep\nPINTEREST_REFRESH_TOKEN=old\n", (path) => {
    upsertEnvVar(path, "PINTEREST_REFRESH_TOKEN", "new");
    const out = readFileSync(path, "utf8");
    assert.ok(out.includes("PINTEREST_REFRESH_TOKEN_BACKUP=keep"));
    assert.ok(out.includes("PINTEREST_REFRESH_TOKEN=new"));
    assert.ok(!out.includes("PINTEREST_REFRESH_TOKEN=old"));
  });
});
