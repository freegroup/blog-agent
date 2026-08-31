import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const serverPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "index.js");

async function connect() {
  const client = new Client({ name: "test", version: "0" });
  await client.connect(new StdioClientTransport({ command: "node", args: [serverPath] }));
  return client;
}

test("registers the tool", async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((t) => t.name),
    ["wire_cross_section"],
  );
  await client.close();
});

test("computes via stdio and returns the same value as the website", async () => {
  const client = await connect();
  const res = await client.callTool({
    name: "wire_cross_section",
    arguments: { length_cm: 500, current_a: 40, voltage_v: 12 },
  });
  const out = JSON.parse(res.content[0].text);
  assert.equal(out.recommendation_mm2, 35);
  assert.equal(out.computed_mm2, 29.76);
  await client.close();
});

test("rejects nonsensical input rather than guessing", async () => {
  const client = await connect();
  const res = await client.callTool({
    name: "wire_cross_section",
    arguments: { length_cm: -5, current_a: 40, voltage_v: 12 },
  });
  assert.equal(res.isError, true);
  await client.close();
});
