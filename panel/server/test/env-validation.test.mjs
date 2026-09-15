import assert from "node:assert/strict";
import test from "node:test";
import { validateEnvPatch, validateEnvRecord } from "../../shared/dist/index.js";

const valid = {
  INSTALL_METAMOD: "1",
  INSTALL_CS2FIXES: "1",
  INSTALL_MULTIADDONMANAGER: "1",
  INSTALL_STRIPPERCS2: "1",
  METAMOD_VERSION: "2.0.0-git1411",
  CS2FIXES_VERSION: "v1.20.1",
  MULTIADDONMANAGER_VERSION: "v1.5.4",
  STRIPPERCS2_VERSION: "v1.1.3",
  CS2_PUBLISHED_PORT: "27015",
  CS2_RCON_PUBLISHED_PORT: "27050",
  TV_PUBLISHED_PORT: "27020",
};

test("shared env validation accepts the supported release set", () => {
  assert.deepEqual(validateEnvRecord(valid), []);
});

test("shared env validation rejects boot blockers, unsafe values, ranges, and port collisions", () => {
  const findings = validateEnvPatch(valid, {
    METAMOD_VERSION: "2.0.0-git1500",
    CS2_MAXPLAYERS: "100",
    CS2_SERVERNAME: "bad$value",
    CS2_RCON_PUBLISHED_PORT: "27015",
  });
  assert.ok(findings.some((finding) => /CS2Fixes v1\.20\.1/.test(finding.message)));
  assert.ok(findings.some((finding) => /at most 64/.test(finding.message)));
  assert.ok(findings.some((finding) => /interpolate/.test(finding.message)));
  assert.ok(findings.some((finding) => /assigned more than once/.test(finding.message)));
});

test("shared env validation refuses unknown and panel-managed keys", () => {
  assert.match(validateEnvPatch(valid, { UNKNOWN_KEY: "value" })[0].message, /Unknown/);
  assert.match(validateEnvPatch(valid, { CS2_ADMIN_STEAMID: "76561198000000000" })[0].message, /managed/);
});
