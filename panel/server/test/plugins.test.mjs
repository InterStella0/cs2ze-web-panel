import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_PLUGIN_UPDATE_SETTINGS,
  ENV_SCHEMA_BY_KEY,
  PLUGIN_SPECS,
  buildDownloadCandidates,
  buildDownloadUrl,
  checkCompatibility,
  compareVersions,
  isNewerVersion,
  pluginUpdateRequestSchema,
  pluginUpdateSettingsSchema,
  pluginVersion,
  versionFromDownloadUrl,
} from "../../shared/dist/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const installerPath = path.resolve(here, "../../../scripts/install-mods.sh");

test("version ordering handles release tags, Metamod builds and pre-releases", () => {
  assert.ok(isNewerVersion("v1.20.2", "v1.20.1"));
  assert.ok(isNewerVersion("v1.21", "v1.20.9"));
  assert.ok(isNewerVersion("v2.0", "v1.99.99"));
  assert.ok(!isNewerVersion("v1.20.1", "v1.20.1"));
  assert.ok(!isNewerVersion("v1.19.9", "v1.20.0"));

  // Metamod versions differ only in the git build counter.
  assert.ok(isNewerVersion("2.0.0-git1461", "2.0.0-git1411"));
  assert.ok(!isNewerVersion("2.0.0-git1411", "2.0.0-git1461"));
  assert.equal(compareVersions("2.0.0-git1411", "2.0.0-git1411"), 0);

  // A plain release outranks a pre-release of the same numbers.
  assert.ok(isNewerVersion("v1.21", "v1.21-rc1"));
  assert.ok(!isNewerVersion("v1.21-rc1", "v1.21"));
});

test("download URLs reproduce exactly what install-mods.sh would fetch", async () => {
  const installer = await fs.readFile(installerPath, "utf8");
  // Evaluate the installer's own URL expressions instead of restating them, so
  // this test fails the moment the two definitions drift apart. The lists are
  // multi-line, hence the continuation-aware slice.
  const lines = installer.split("\n");
  const start = lines.findIndex((line) => /^\s{2}metamod_version=/.test(line));
  const end = lines.findIndex((line, index) => index > start && /^\s*$/.test(line));
  const assignments = lines.slice(start, end).join("\n");
  assert.ok(assignments.includes("metamod_urls="), "installer URL block not found");
  assert.ok(assignments.includes("stripper_urls="), "installer URL block is truncated");

  const cases = [
    { id: "metamod", version: "2.0.0-git1461", env: { METAMOD_VERSION: "2.0.0-git1461" }, variable: "metamod_urls" },
    { id: "cs2fixes", version: "v1.21.0", runtime: "steamrt4", env: { CS2FIXES_VERSION: "v1.21.0", CS2FIXES_RUNTIME: "steamrt4" }, variable: "cs2fixes_urls" },
    { id: "multiaddonmanager", version: "v1.6", env: { MULTIADDONMANAGER_VERSION: "v1.6" }, variable: "mam_urls" },
    { id: "strippercs2", version: "v1.1.3", env: { STRIPPERCS2_VERSION: "v1.1.3" }, variable: "stripper_urls" },
    { id: "strippercs2", version: "v2.0.1", env: { STRIPPERCS2_VERSION: "v2.0.1" }, variable: "stripper_urls" },
  ];
  for (const testCase of cases) {
    const script = `set -eu\n${assignments}\nprintf '%s' "$${testCase.variable}"\n`;
    const expected = execFileSync("bash", ["-c", script], { env: { PATH: process.env.PATH, ...testCase.env }, encoding: "utf8" });
    const spec = PLUGIN_SPECS.find((candidate) => candidate.id === testCase.id);
    assert.deepEqual(
      buildDownloadCandidates(spec, testCase.version, testCase.runtime),
      expected.split("\n"),
      `${testCase.id} ${testCase.version} candidate list mismatch`,
    );
    assert.equal(buildDownloadUrl(spec, testCase.version, testCase.runtime), expected.split("\n")[0]);
  }
});

test("the installer picks an archive format from the resolved URL", async () => {
  const installer = await fs.readFile(installerPath, "utf8");
  // StripperCS2 renamed its assets at v1.1.4: a runtime-less .zip became a
  // per-runtime .tar.gz. Both must stay installable.
  assert.match(installer, /\*\.tar\.gz\|\*\.tgz\) printf 'tar\.gz'/);
  assert.match(installer, /\*\.zip\) printf 'zip'/);
  assert.match(installer, /install_archive strippercs2 "\$stripper_urls"/);
  assert.doesNotMatch(installer, /install_archive \w+ "\$\w+" (tar\.gz|zip)/, "format is no longer passed positionally");

  const spec = PLUGIN_SPECS.find((candidate) => candidate.id === "strippercs2");
  assert.ok(buildDownloadCandidates(spec, "v2.0.1").some((url) => url.endsWith("StripperCS2-v2.0.1-steamrt3.tar.gz")));
  assert.ok(buildDownloadCandidates(spec, "v1.1.3").some((url) => url.endsWith("StripperCS2-1.1.3.zip")));
});

test("catalog defaults match the installer and the .env schema", async () => {
  const installer = await fs.readFile(installerPath, "utf8");
  for (const spec of PLUGIN_SPECS) {
    for (const key of [spec.installKey, spec.versionKey, spec.urlKey, spec.runtimeKey].filter(Boolean)) {
      assert.ok(ENV_SCHEMA_BY_KEY[key], `${key} is missing from the .env schema`);
    }
    assert.equal(ENV_SCHEMA_BY_KEY[spec.versionKey].default, spec.defaultVersion, `${spec.versionKey} default drifted`);
    assert.ok(installer.includes(`${spec.versionKey}:-${spec.defaultVersion}`), `${spec.versionKey} default differs from install-mods.sh`);
    // install_archive() names the marker file after the archive it installed.
    assert.ok(installer.includes(`install_archive ${spec.marker} `), `no install_archive call for ${spec.marker}`);
  }
});

test("marker URLs resolve back to the installed version", () => {
  assert.equal(
    versionFromDownloadUrl("https://github.com/Source2ZE/CS2Fixes/releases/download/v1.20.1/CS2Fixes-v1.20.1-steamrt3.tar.gz"),
    "v1.20.1",
  );
  assert.equal(
    versionFromDownloadUrl("https://github.com/Source2ZE/StripperCS2/releases/download/v1.1.3/StripperCS2-1.1.3.zip"),
    "v1.1.3",
  );
  assert.equal(
    versionFromDownloadUrl("https://mms.alliedmods.net/mmsdrop/2.0/mmsource-2.0.0-git1411-linux.tar.gz"),
    "2.0.0-git1411",
  );
  assert.equal(versionFromDownloadUrl("https://example.invalid/custom-archive.tar.gz"), null);

  // Every spec's own URL round-trips, including StripperCS2's asset renaming.
  for (const spec of PLUGIN_SPECS) {
    assert.equal(versionFromDownloadUrl(buildDownloadUrl(spec, spec.defaultVersion)), spec.defaultVersion);
  }
});

test("a selection that cannot boot is rejected by the same rules as the installer", () => {
  // The panel's own pin: CS2Fixes v1.20.1 cannot load a Metamod newer than 1411.
  const findings = checkCompatibility({
    METAMOD_VERSION: "2.0.0-git1461",
    CS2FIXES_VERSION: "v1.20.1",
    INSTALL_METAMOD: "1",
    INSTALL_CS2FIXES: "1",
  });
  assert.ok(findings.some((finding) => finding.severity === "error" && finding.message.includes("Metamod build 1411 or earlier")));

  // Updating both together is fine.
  assert.equal(
    checkCompatibility({ METAMOD_VERSION: "2.0.0-git1461", CS2FIXES_VERSION: "v1.21.0", INSTALL_METAMOD: "1", INSTALL_CS2FIXES: "1" })
      .filter((finding) => finding.severity === "error").length,
    0,
  );
});

test("version strings that could corrupt .env are refused", () => {
  for (const bad of ["", "v1.0 && rm -rf /", "$(id)", "v1.0\nCS2_RCONPW=x", "-leading-dash", "v".repeat(70)]) {
    assert.equal(pluginVersion.safeParse(bad).success, false, `accepted ${JSON.stringify(bad)}`);
  }
  for (const good of ["v1.20.1", "2.0.0-git1411", "1.1.3", "v2.0.0+build.5"]) {
    assert.equal(pluginVersion.safeParse(good).success, true, `rejected ${good}`);
  }
});

test("updater settings and update requests validate", () => {
  assert.equal(pluginUpdateSettingsSchema.safeParse(DEFAULT_PLUGIN_UPDATE_SETTINGS).success, true);
  assert.equal(DEFAULT_PLUGIN_UPDATE_SETTINGS.autoApply, false, "automatic applies must be opt-in");
  assert.equal(DEFAULT_PLUGIN_UPDATE_SETTINGS.applyWhenPlayersOnline, false);
  assert.equal(pluginUpdateSettingsSchema.safeParse({ ...DEFAULT_PLUGIN_UPDATE_SETTINGS, checkIntervalHours: 0 }).success, false);
  assert.equal(pluginUpdateSettingsSchema.safeParse({ ...DEFAULT_PLUGIN_UPDATE_SETTINGS, autoApplyPlugins: ["nope"] }).success, false);

  assert.equal(pluginUpdateRequestSchema.safeParse({ selections: [] }).success, false);
  const parsed = pluginUpdateRequestSchema.safeParse({ selections: [{ id: "cs2fixes", version: "v1.20.2" }] });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.apply, false, "applying must be explicit");
});
