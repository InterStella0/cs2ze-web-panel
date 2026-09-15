import assert from "node:assert/strict";
import test from "node:test";
import { LogBuffer } from "../dist/logs/buffer.js";

test("LogBuffer joins fragmented UTF-8, normalizes line endings, and sanitizes output", () => {
  const buffer = new LogBuffer("docker");
  const seen = [];
  const { cursor } = buffer.snapshot(10);
  const unsubscribe = buffer.subscribeAfter(cursor, (entry) => seen.push(entry));
  const encoded = Buffer.from("first 🧟\r\n\x1b[31msecond\x1b[0m\rthird", "utf8");
  buffer.push(encoded.subarray(0, 9));
  buffer.push(encoded.subarray(9));
  buffer.flush();
  unsubscribe();
  assert.deepEqual(seen.map((entry) => entry.line), ["first 🧟", "second", "third"]);
  assert.ok(seen.every((entry) => entry.source === "docker" && entry.receivedAt));
});

test("LogBuffer keeps a bounded 2,000-line ring and backfills from a cursor", () => {
  const buffer = new LogBuffer("game");
  for (let index = 0; index < 2_050; index += 1) buffer.push(`line-${index}\n`);
  const snapshot = buffer.snapshot(2_000);
  assert.equal(snapshot.entries.length, 2_000);
  assert.equal(snapshot.entries[0].line, "line-50");
  const seen = [];
  const unsubscribe = buffer.subscribeAfter(snapshot.cursor, (entry) => seen.push(entry.line));
  buffer.push("next\n");
  unsubscribe();
  buffer.push("ignored\n");
  assert.deepEqual(seen, ["next"]);
});
