import assert from "node:assert/strict";
import test from "node:test";
import { PacketFramer, PacketType, encodePacket } from "../dist/rcon/protocol.js";

test("encodePacket writes the Source RCON wire layout", () => {
  const packet = encodePacket(42, PacketType.EXECCOMMAND, "status");
  assert.equal(packet.readInt32LE(0), packet.length - 4);
  assert.equal(packet.readInt32LE(4), 42);
  assert.equal(packet.readInt32LE(8), PacketType.EXECCOMMAND);
  assert.equal(packet.subarray(12, -2).toString("utf8"), "status");
  assert.deepEqual([...packet.subarray(-2)], [0, 0]);
});

test("PacketFramer handles fragmented and coalesced packets", () => {
  const first = encodePacket(2, 0, "first");
  const second = encodePacket(3, 0, "second");
  const combined = Buffer.concat([first, second]);
  const framer = new PacketFramer();
  assert.deepEqual(framer.push(combined.subarray(0, 7)), []);
  assert.equal(framer.pending, 7);
  assert.deepEqual(framer.push(combined.subarray(7)), [
    { id: 2, type: 0, body: "first" },
    { id: 3, type: 0, body: "second" },
  ]);
  assert.equal(framer.pending, 0);
});

test("PacketFramer preserves a CS2-sized 700 KB single-frame response", () => {
  const body = "x".repeat(700 * 1024);
  const packet = encodePacket(7, 0, body);
  const framer = new PacketFramer();
  const result = framer.push(packet);
  assert.equal(result.length, 1);
  assert.equal(result[0].body.length, body.length);
  assert.equal(result[0].body, body);
});

test("PacketFramer rejects invalid and over-cap length prefixes", () => {
  const tooSmall = Buffer.alloc(4);
  tooSmall.writeInt32LE(9);
  assert.throws(() => new PacketFramer().push(tooSmall), /out of range/);
  const tooLarge = Buffer.alloc(4);
  tooLarge.writeInt32LE(101);
  assert.throws(() => new PacketFramer(100).push(tooLarge), /out of range/);
});
