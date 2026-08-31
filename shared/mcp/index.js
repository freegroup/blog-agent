import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * MCP as a process boundary — not just for the model.
 *
 * Everything that holds secrets or can cause damage lives behind an MCP server:
 * the GitHub PAT, the Telegram token, the calculation logic. Callers invoke
 * narrowly scoped operations and never see the secret.
 */

async function spawn(command, name = "blogagent") {
  const [cmd, ...args] = command.split(/\s+/);
  const client = new Client({ name, version: "0.1.0" });
  await client.connect(new StdioClientTransport({ command: cmd, args }));
  return client;
}

function unpack(res) {
  const text = (res.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
  if (res.isError) throw new Error(text || "tool reported an error");
  return text;
}

/** One server, used directly. For services that need exactly one capability. */
export async function connectOne(command, name) {
  const client = await spawn(command, name);
  return {
    call: async (tool, input = {}) => unpack(await client.callTool({ name: tool, arguments: input })),
    /** Like `call`, but parses and returns the JSON. */
    callJson: async (tool, input = {}) =>
      JSON.parse(unpack(await client.callTool({ name: tool, arguments: input }))),
    close: () => client.close().catch(() => {}),
  };
}

/**
 * Multiple servers whose tools are offered to the model together.
 * If one goes down the rest keep running — without the calculator the newsroom
 * must cite its numbers rather than computing them, which the briefing
 * already requires.
 */
export async function connectMany(server) {
  const clients = new Map();
  const tools = [];

  for (const [name, command] of Object.entries(server)) {
    try {
      const client = await spawn(command, "newsroom");
      for (const tool of (await client.listTools()).tools) {
        clients.set(tool.name, client);
        tools.push({ name: tool.name, description: tool.description ?? "", inputSchema: tool.inputSchema });
      }
      console.log(`[mcp] '${name}' connected (${(await client.listTools()).tools.length} tools)`);
    } catch (err) {
      console.error(`[mcp] '${name}' not connected: ${err.message}`);
    }
  }

  return {
    tools,
    call: async (tool, input) => {
      const client = clients.get(tool);
      if (!client) throw new Error(`Unknown tool: ${tool}`);
      return unpack(await client.callTool({ name: tool, arguments: input }));
    },
    close: async () => {
      for (const client of new Set(clients.values())) await client.close().catch(() => {});
    },
  };
}
