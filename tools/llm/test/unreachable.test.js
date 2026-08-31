import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { OpenAiCompatibleLlm } from "../openai-compatible.js";

/**
 * A dead endpoint is the most common failure in a local setup — Ollama simply
 * is not running. Node answers that with a bare `TypeError: fetch failed` and
 * hides the reason in `cause`, which already cost one debugging session.
 */

/** A port that was free and is closed again, so the refusal is certain. */
async function closedPort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

const ask = (llm) =>
  llm.complete({ system: "s", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] });

// Both spellings, because they fail differently: an IP gives a plain Error,
// `localhost` gives an AggregateError with an EMPTY message — and settings.yaml
// uses `localhost`, so that is the case that actually reaches an operator.
for (const host of ["127.0.0.1", "localhost"]) {
  test(`names the endpoint, the model and the real reason (${host})`, async () => {
    const port = await closedPort();
    const llm = new OpenAiCompatibleLlm({
      baseUrl: `http://${host}:${port}/v1`,
      model: "gemma4:26b",
      maxTokens: 10,
      apiKey: "not-needed",
      retries: 0, // the connection is certainly refused; no point waiting out backoff
    });

    await assert.rejects(ask(llm), (err) => {
      assert.match(err.message, /unreachable/, "says it could not be reached");
      assert.match(err.message, new RegExp(`${host.replace(/\./g, "\\.")}:${port}`), "names the endpoint");
      assert.match(err.message, /gemma4:26b/, "names the model");
      assert.match(err.message, /ECONNREFUSED/, "keeps the underlying reason");
      return true;
    });
  });
}
