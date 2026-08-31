import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "yaml";
import { deadletterRecord } from "../record.js";

/**
 * The whole point of the dead-letter file is that it IS a queue file: copy it
 * into var/queue/, delete `state`, and it runs again. So the record must name
 * itself `<id>.yaml` and round-trip byte-for-byte through the same YAML the
 * queue uses.
 */

const pitch = {
  id: "305f734e-8f4f-40d5-b252-26e5522fa802",
  envelope: {
    id: "305f734e-8f4f-40d5-b252-26e5522fa802",
    source: "telegram",
    source_ref: "chat:1058165278/msg:134",
    received_at: "2026-08-30T13:47:38.998Z",
    text: "Ich schreibe einen neuen Beitrag über Sinn und Unsinn von Wago-Klemmen.",
    media: [],
    revises: null,
  },
  jobs: [
    {
      briefing: "camper-blog",
      state: "failed",
      attempts: 3,
      reason: "Sink 500: GitHub POST /git/blobs → 403 Resource not accessible",
    },
  ],
  created_at: "2026-08-30T13:47:39.009Z",
};

test("names the file <id>.yaml like the queue", () => {
  const { filename } = deadletterRecord(pitch);
  assert.equal(filename, "305f734e-8f4f-40d5-b252-26e5522fa802.yaml");
});

test("round-trips through YAML unchanged — safe to copy back into the queue", () => {
  const { content } = deadletterRecord(pitch);
  assert.deepEqual(parse(content), pitch, "parsing the record yields the exact pitch again");
});

test("keeps the failure reason in the job, where the queue expects it", () => {
  const { content } = deadletterRecord(pitch);
  assert.match(content, /reason:/);
  assert.match(content, /403 Resource not accessible/);
});
