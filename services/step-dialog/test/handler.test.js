import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Readable } from "node:stream";
import { makeHandler } from "../handler.js";
import { ACK, USER_REQUEST, DECLINE, ANSWER, REACTIVATE } from "../filters/verdict.js";

// A real downstream so the forward/reactivate paths exercise the network hop.
const received = [];
const downstream = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    received.push(JSON.parse(body));
    res.writeHead(202, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "down" }));
  });
});
await new Promise((r) => downstream.listen(0, "127.0.0.1", r));
const out = `http://127.0.0.1:${downstream.address().port}/pitches`;
after(() => downstream.close());

const envelope = (over = {}) => ({
  id: "in-1",
  source: "telegram",
  source_ref: "chat:7/msg:1",
  received_at: new Date().toISOString(),
  text: "hallo",
  media: [],
  ...over,
});

/** Drive one request through the handler and capture the response. */
async function run({ filter, store, envelope: env = envelope() }) {
  const telegram = { sent: [], call: async (_name, { text }) => telegram.sent.push(text) };
  const handler = makeHandler({ out, queueDir: "/unused", telegram, llm: { complete: async () => ({}) }, store, filters: [() => filter] });

  const req = Readable.from([Buffer.from(JSON.stringify(env))]);
  req.method = "POST";
  req.url = "/pitches";
  const res = { writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } };

  await handler(req, res);
  return { res, telegram };
}

const store = (over = {}) => ({
  pendingForChat: () => null,
  park: () => {},
  discard: () => {},
  ...over,
});

test("decline: tells the user, forwards nothing", async () => {
  const { res, telegram } = await run({ filter: { type: DECLINE, response: "verstößt gegen die Vorgaben" }, store: store() });
  assert.equal(res.status, 202);
  assert.deepEqual(res.body, { status: "declined" });
  assert.deepEqual(telegram.sent, ["verstößt gegen die Vorgaben"]);
});

test("answer: replies directly, forwards nothing", async () => {
  const { res, telegram } = await run({ filter: { type: ANSWER, response: "Das letzte war X" }, store: store() });
  assert.equal(res.status, 202);
  assert.deepEqual(res.body, { status: "answered" });
  assert.deepEqual(telegram.sent, ["Das letzte war X"]);
});

test("ask: parks the request (with reactivation) and sends the question", async () => {
  const parked = [];
  const s = store({ park: (...args) => parked.push(args) });
  const { res, telegram } = await run({
    filter: { type: USER_REQUEST, response: "Meinst du „X“?", reactivation: { source_id: "p1", target: "Blog" } },
    store: s,
  });
  assert.equal(res.status, 202);
  assert.deepEqual(res.body, { status: "clarifying" });
  assert.deepEqual(telegram.sent, ["Meinst du „X“?"]);
  assert.equal(parked.length, 1);
  const [, env, question, opts] = parked[0];
  assert.equal(env.id, "in-1");
  assert.equal(question, "Meinst du „X“?");
  assert.deepEqual(opts.reactivation, { source_id: "p1", target: "Blog" });
});

test("forward: hands a complete request to the next hop and mirrors its status", async () => {
  received.length = 0;
  const { res, telegram } = await run({ filter: { type: ACK, response: null }, store: store() });
  assert.equal(res.status, 202);
  assert.deepEqual(res.body, { id: "down" });
  assert.equal(telegram.sent.length, 0, "a plain forward says nothing to the user");
  assert.equal(received.at(-1).id, "in-1");
});

test("reactivate: forwards the fresh pitch and discards the parked confirmation", async () => {
  received.length = 0;
  const discarded = [];
  const s = store({
    pendingForChat: () => ({ id: "confirm-1", reactivation: { source_id: "p1", target: "Blog" } }),
    discard: (dir, id) => discarded.push(id),
  });
  const fresh = { id: "repost-1", text: "Poste erneut auf Blog: …", media: [] };
  const { res } = await run({ filter: { type: REACTIVATE, envelope: fresh }, store: s, envelope: envelope({ text: "ja" }) });
  assert.equal(res.status, 202);
  assert.equal(received.at(-1).id, "repost-1", "the NEW pitch is forwarded, not the reply");
  assert.deepEqual(discarded, ["confirm-1"], "the parked confirmation is cleaned up");
});

test("a malformed body is the caller's fault (400)", async () => {
  const telegram = { sent: [], call: async () => {} };
  const handler = makeHandler({ out, queueDir: "/unused", telegram, llm: { complete: async () => ({}) }, store: store(), filters: [() => ({ type: ACK })] });
  const req = Readable.from([Buffer.from("{ not json")]);
  req.method = "POST";
  req.url = "/pitches";
  const res = { writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } };
  await handler(req, res);
  assert.equal(res.status, 400);
});
