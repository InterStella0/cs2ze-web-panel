import assert from "node:assert/strict";
import test from "node:test";
import { parseSetupProgress } from "../dist/docker/setup-progress.js";

test("parses the latest first-run game download progress", () => {
  const progress = parseSetupProgress([
    "\x1b[0m Update state (0x61) downloading, progress: 67.28 (47835334226 / 71099106130)",
    "\x1b[0m Update state (0x61) downloading, progress: 72.16 (51308392121 / 71099106130)",
  ].join("\n"));
  assert.deepEqual(progress, {
    phase: "downloading",
    percentage: 72.16,
    downloadedBytes: 51_308_392_121,
    totalBytes: 71_099_106_130,
  });
});

test("parses SteamCMD self-update download and install stages", () => {
  assert.deepEqual(parseSetupProgress([
    "[  0%] Checking for available updates...",
    "[----] Downloading update (0 of 40,371 KB)...",
    "[ 56%] Downloading update (25,640 of 40,371 KB)...",
  ].join("\n")), {
    phase: "updating-steamcmd",
    percentage: 56,
    downloadedBytes: 25_640 * 1024,
    totalBytes: 40_371 * 1024,
  });
  assert.deepEqual(parseSetupProgress([
    "[100%] Download complete.",
    "[----] Installing update...",
  ].join("\n")), {
    phase: "updating-steamcmd",
    percentage: null,
    downloadedBytes: null,
    totalBytes: null,
  });
});

test("reports configuration after download and ignores unrelated logs", () => {
  assert.deepEqual(parseSetupProgress([
    "Update state (0x61) downloading, progress: 99.90 (71028007023 / 71099106130)",
    "Success! App '730' fully installed.",
  ].join("\n")), {
    phase: "configuring",
    percentage: null,
    downloadedBytes: null,
    totalBytes: null,
  });
  assert.equal(parseSetupProgress("Starting game server"), null);
  assert.equal(parseSetupProgress([
    "Update state (0x61) downloading, progress: 100.00 (71099106130 / 71099106130)",
    "Success! App '730' fully installed.",
    "SV: Connection to Steam servers successful.",
  ].join("\n")), null);
});
