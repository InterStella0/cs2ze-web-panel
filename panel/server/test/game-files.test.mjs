import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const waitFor = async (predicate, timeoutMs = 3_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for game log update");
};

test("game logs list, safely read, tail, append, and rotate", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "cs2ze-game-logs-"));
  const logDir = path.join(dataDir, "game", "csgo", "logs");
  await fs.mkdir(logDir, { recursive: true });
  process.env.PANEL_CS2_DATA_DIR = dataDir;
  const game = await import(`../dist/logs/game-files.js?test=${Date.now()}`);
  t.after(async () => {
    game.closeGameLogStream();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const oldPath = path.join(logDir, "old.log");
  const activePath = path.join(logDir, "active.log");
  await fs.writeFile(oldPath, "old line\n");
  await fs.writeFile(activePath, "\x1b[31mfirst\x1b[0m\r\n");
  await fs.utimes(oldPath, new Date(Date.now() - 10_000), new Date(Date.now() - 10_000));

  const files = await game.listGameLogFiles();
  assert.equal(files.length, 2);
  assert.equal(files[0].name, "active.log");
  assert.equal(files[0].active, true);
  assert.equal((await game.readGameLogFile("active.log")).content, "first\n");
  assert.equal(await game.readGameLogFile("../active.log"), null);

  const seen = [];
  const unsubscribe = await game.openGameLogStream(100, (entry) => seen.push(entry.line));
  assert.ok(seen.includes("first"));
  await fs.appendFile(activePath, "second\n");
  await waitFor(() => seen.includes("second"));

  const rotatedPath = path.join(logDir, "rotated.log");
  await fs.writeFile(rotatedPath, "rotated first\n");
  await fs.utimes(rotatedPath, new Date(Date.now() + 1_000), new Date(Date.now() + 1_000));
  await waitFor(() => seen.includes("rotated first"));
  unsubscribe();

  await fs.writeFile(path.join(logDir, "large.log"), Buffer.alloc(4 * 1024 * 1024 + 256, 0x61));
  const result = await game.readGameLogFile("large.log");
  assert.equal(result.truncated, true);
  assert.equal(Buffer.byteLength(result.content), 4 * 1024 * 1024);
});
