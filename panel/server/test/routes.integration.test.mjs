import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { PacketFramer, PacketType, encodePacket } from "../dist/rcon/protocol.js";
import { DEFAULT_PLUGIN_UPDATE_SETTINGS, buildGflPlayerClasses } from "../../shared/dist/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const serverEntry = path.resolve(here, "../dist/index.js");

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = address.port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function startRcon() {
  const sockets = new Set();
  const commands = [];
  const cvars = Array.from({ length: 1_200 }, (_, index) => `test_cvar_${String(index).padStart(5, "0")} : 0 : sv`).join("\n");
  const responses = {
    status: `hostname : Integration Test\nversion : 1.0\nudp/ip : 0.0.0.0:27015 (public ip 127.0.0.1:27015)\nmap : ze_integration\nplayers : 1 humans, 0 bots (64 max)\n# 0 12 "Route Player" STEAM_1:1:42 02:03 31 0 active 786432 10.0.0.1:27005`,
    c_timeleft: "[CS2Fixes] Timeleft: 12:34",
    c_nextmap: "Next map is: ze_next",
    c_who: "Admin #12 76561190000000000",
    "meta list": "[01] CS2Fixes (1.20.1) by Vauff\n[02] StripperCS2 (1.1.3) by Vauff\n[03] MultiAddonManager (1.5.4) by Source2ZE",
    cvarlist: cvars,
  };
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    const framer = new PacketFramer();
    socket.on("data", (chunk) => {
      for (const packet of framer.push(chunk)) {
        if (packet.type === PacketType.AUTH) socket.write(encodePacket(packet.id, PacketType.AUTH_RESPONSE, ""));
        else if (packet.body === "") socket.write(encodePacket(packet.id, PacketType.RESPONSE_VALUE, ""));
        else {
          commands.push(packet.body);
          socket.write(encodePacket(packet.id, PacketType.RESPONSE_VALUE, responses[packet.body] ?? `executed: ${packet.body}`));
        }
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    port: server.address().port,
    commands,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function waitForHealth(baseUrl, output) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Panel did not start:\n${output()}`);
}

function cookieOf(response) {
  const header = response.headers.get("set-cookie");
  assert.ok(header);
  return header.split(";", 1)[0];
}

test("Step 3/4/5 routes enforce auth and safely manage runtime plus catalog data", { timeout: 30_000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cs2ze-step3-routes-"));
  const projectDir = path.join(root, "project");
  const dataDir = path.join(root, "panel-data");
  const cs2DataDir = path.join(root, "cs2-data");
  const binDir = path.join(root, "bin");
  const logDir = path.join(cs2DataDir, "game", "csgo", "logs");
  const configDir = path.join(projectDir, "server-config", "cs2fixes");
  const liveConfigDir = path.join(cs2DataDir, "game", "csgo", "addons", "cs2fixes", "configs");
  const classConfigDir = path.join(configDir, "zr");
  const liveClassConfigDir = path.join(liveConfigDir, "zr");
  await Promise.all([projectDir, dataDir, binDir, logDir, configDir, liveConfigDir, classConfigDir, liveClassConfigDir].map((directory) => fs.mkdir(directory, { recursive: true })));
  const composeFile = path.join(projectDir, "compose.yaml");
  await fs.writeFile(composeFile, "services: {}\n");
  await fs.writeFile(path.join(projectDir, ".env"), "# preserved comment\nCS2_RCONPW=secret\nZE_ROUND_TIME=60\nZE_ROUND_MONEY=16000\nCS2_MAXPLAYERS=32\nCS2_HOST_WORKSHOP_COLLECTION=3222748625\nMETAMOD_VERSION=2.0.0-git1411\nCS2FIXES_VERSION=v1.20.1\n");
  await fs.writeFile(path.join(logDir, "L-test.log"), "\x1b[32mgame ready\x1b[0m\r\n");
  const initialMaps = '{"Groups":{},"Maps":{"ze_integration":{"enabled":true,"workshop_id":123}}}\n';
  const initialAdmins = '{"Groups":{},"Admins":{"0":{"name":"Unconfigured placeholder","flags":"","immunity":0}}}\n';
  const initialClasses = `${JSON.stringify(buildGflPlayerClasses("both"), null, 2)}\n`;
  await fs.writeFile(path.join(configDir, "maplist.jsonc"), initialMaps);
  await fs.writeFile(path.join(configDir, "admins.jsonc"), initialAdmins);
  await fs.writeFile(path.join(classConfigDir, "playerclass.jsonc"), initialClasses);
  await fs.writeFile(path.join(liveConfigDir, "maplist.jsonc"), initialMaps);
  await fs.writeFile(path.join(liveConfigDir, "admins.jsonc"), initialAdmins);
  await fs.writeFile(path.join(liveClassConfigDir, "playerclass.jsonc"), initialClasses);

  const dockerPath = path.join(binDir, "docker");
  const panelInspect = [{ Config: { Labels: {
    "com.docker.compose.project": "integration",
    "com.docker.compose.project.working_dir": projectDir,
    "com.docker.compose.project.config_files": composeFile,
  } } }];
  const serverInspect = [{ Config: { Image: "fake/cs2:test", Env: ["CS2_RCONPW=secret", "ZE_ROUND_TIME=60", "CS2_MAXPLAYERS=32", "METAMOD_VERSION=2.0.0-git1411", "CS2FIXES_VERSION=v1.20.1"] }, State: {
    Status: "running", Running: true, StartedAt: "2026-09-15T12:00:00Z", Health: { Status: "healthy" },
  } }];
  const dockerScript = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
if (args[0] === "version") console.log("29.8.0");
else if (args[0] === "inspect") console.log(JSON.stringify(args[1] === "test-panel" ? ${JSON.stringify(panelInspect)} : ${JSON.stringify(serverInspect)}));
else if (args[0] === "logs") { process.stdout.write("\\x1b[31m[cs2ze]\\x1b[0m installer ready\\r\\n"); setInterval(() => {}, 10000); }
else if (args[0] === "cp") { const destination = args[2].slice(args[2].indexOf(":") + 1); const target = path.join(${JSON.stringify(cs2DataDir)}, destination.replace("/home/steam/cs2-dedicated/", "")); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(args[1], target); }
else { console.error("unsupported", args.join(" ")); process.exit(1); }
`;
  await fs.writeFile(dockerPath, dockerScript, { mode: 0o755 });

  const rcon = await startRcon();
  const panelPort = await freePort();
  const baseUrl = `http://127.0.0.1:${panelPort}`;
  let output = "";
  const child = spawn(process.execPath, [serverEntry], {
    cwd: path.join(repoRoot, "panel"),
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      PANEL_PORT: String(panelPort),
      PANEL_HOST: "127.0.0.1",
      PANEL_DATA_DIR: dataDir,
      PANEL_CS2_DATA_DIR: cs2DataDir,
      PANEL_CONTAINER_NAME: "test-panel",
      CS2_CONTAINER_NAME: "test-server",
      CS2ZE_PROJECT_DIR: projectDir,
      PANEL_RCON_HOST: "127.0.0.1",
      PANEL_RCON_PORT: String(rcon.port),
      PANEL_ADMIN_USER: "testowner",
      PANEL_ADMIN_PASSWORD: "temporary-test-password",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  t.after(async () => {
    child.kill("SIGTERM");
    if (child.exitCode === null) await new Promise((resolve) => child.once("exit", resolve));
    await rcon.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  await waitForHealth(baseUrl, () => output);

  for (const endpoint of ["/api/rcon/status", "/api/rcon/commands", "/api/logs/files", "/api/logs/stream?source=docker", "/api/env", "/api/drift", "/api/maps", "/api/admins", "/api/players", "/api/player-classes", "/api/plugins"]) {
    assert.equal((await fetch(baseUrl + endpoint)).status, 401);
  }

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "testowner", password: "temporary-test-password" }),
  });
  assert.equal(login.status, 200);
  let cookie = cookieOf(login);
  let auth = await login.json();
  const changed = await fetch(`${baseUrl}/api/auth/password`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, "x-cs2ze-csrf": auth.csrfToken },
    body: JSON.stringify({ currentPassword: "temporary-test-password", newPassword: "permanent-test-password-123" }),
  });
  assert.equal(changed.status, 200);
  cookie = cookieOf(changed);
  auth = await changed.json();
  const get = (route) => fetch(baseUrl + route, { headers: { cookie } });

  const status = await (await get("/api/rcon/status")).json();
  assert.equal(status.connected, true);
  assert.equal(status.game.currentMap, "ze_integration");
  assert.equal(status.game.timeleftSeconds, 754);
  assert.equal(status.game.nextMap, "ze_next");
  assert.equal(status.players[0].name, "Route Player");
  assert.equal(status.players[0].isAdmin, true);
  assert.equal(status.plugins.length, 3);

  const serverStatus = await (await get("/api/server/status")).json();
  assert.equal(serverStatus.rcon.connected, true);
  assert.equal(serverStatus.game.currentMap, "ze_integration");
  assert.equal(serverStatus.plugins.length, 3);

  const commands = await (await get("/api/rcon/commands")).json();
  assert.equal(commands.commands.length, 1_200);
  assert.equal(commands.commands.at(-1), "test_cvar_01199");

  assert.equal((await fetch(`${baseUrl}/api/rcon/exec`, {
    method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ command: "status" }),
  })).status, 403);
  const executedResponse = await fetch(`${baseUrl}/api/rcon/exec`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, "x-cs2ze-csrf": auth.csrfToken },
    body: JSON.stringify({ command: "status" }),
  });
  assert.equal(executedResponse.status, 200);
  const executed = await executedResponse.json();
  assert.match(executed.output, /map : ze_integration/);
  assert.ok(executed.output.includes("\nplayers : 1 humans"));

  const files = await (await get("/api/logs/files")).json();
  assert.equal(files[0].name, "L-test.log");
  const file = await (await get("/api/logs/files/L-test.log")).json();
  assert.equal(file.content, "game ready\n");

  const streamController = new AbortController();
  const stream = await fetch(`${baseUrl}/api/logs/stream?source=docker&tail=5`, { headers: { cookie }, signal: streamController.signal });
  assert.equal(stream.status, 200);
  const reader = stream.body.getReader();
  let sse = "";
  while (!sse.includes("installer ready")) sse += new TextDecoder().decode((await reader.read()).value);
  assert.ok(sse.includes("[cs2ze] installer ready"));
  assert.ok(!sse.includes("\\x1b[31m"));
  streamController.abort();
  await new Promise((resolve) => setTimeout(resolve, 100));

  const controllers = Array.from({ length: 5 }, () => new AbortController());
  const openStreams = await Promise.all(controllers.map((controller) => fetch(
    `${baseUrl}/api/logs/stream?source=game&tail=1`, { headers: { cookie }, signal: controller.signal },
  )));
  assert.ok(openStreams.every((response) => response.status === 200));
  assert.equal((await get("/api/logs/stream?source=game&tail=1")).status, 429);
  controllers.forEach((controller) => controller.abort());

  const envResponse = await (await get("/api/env")).json();
  assert.equal(envResponse.values.find((item) => item.key === "CS2_RCONPW").value, null);
  assert.equal(envResponse.values.find((item) => item.key === "CS2_RCONPW").hasValue, true);
  assert.ok((await get("/api/env/schema")).ok);

  const invalid = await fetch(`${baseUrl}/api/env/validate`, {
    method: "POST", headers: { "content-type": "application/json", cookie, "x-cs2ze-csrf": auth.csrfToken },
    body: JSON.stringify({ changes: { METAMOD_VERSION: "2.0.0-git1500" }, applyLive: true }),
  });
  assert.equal(invalid.status, 200);
  const invalidResult = await invalid.json();
  assert.equal(invalidResult.valid, false);
  assert.match(invalidResult.findings[0].message, /CS2Fixes v1\.20\.1/);

  assert.equal((await fetch(`${baseUrl}/api/env`, {
    method: "PATCH", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ changes: { ZE_ROUND_TIME: "45" }, applyLive: true }),
  })).status, 403);
  const saved = await fetch(`${baseUrl}/api/env`, {
    method: "PATCH", headers: { "content-type": "application/json", cookie, "x-cs2ze-csrf": auth.csrfToken },
    body: JSON.stringify({ changes: { ZE_ROUND_TIME: "45", ZE_ROUND_MONEY: "15000", CS2_MAXPLAYERS: "40", CS2_BOT_QUOTA: "8", CS2_BOT_QUOTA_MODE: "normal" }, applyLive: true }),
  });
  assert.equal(saved.status, 200);
  const savedResult = await saved.json();
  assert.deepEqual(savedResult.written.sort(), ["CS2_BOT_QUOTA", "CS2_BOT_QUOTA_MODE", "CS2_MAXPLAYERS", "ZE_ROUND_MONEY", "ZE_ROUND_TIME"]);
  assert.equal(savedResult.appliedLive[0].key, "ZE_ROUND_TIME");
  assert.equal(savedResult.appliedLive[0].ok, true);
  assert.deepEqual(savedResult.pendingRestart, ["CS2_MAXPLAYERS"]);
  assert.ok(rcon.commands.includes("mp_roundtime 45"));
  assert.ok(rcon.commands.includes("mp_afterroundmoney 15000"));
  assert.ok(rcon.commands.includes("mp_maxmoney 15000"));
  assert.ok(rcon.commands.includes("mp_startmoney 15000"));
  assert.ok(rcon.commands.includes("bot_quota 8"));
  assert.ok(rcon.commands.includes("bot_quota_mode normal"));
  const writtenEnv = await fs.readFile(path.join(projectDir, ".env"), "utf8");
  assert.match(writtenEnv, /^# preserved comment/m);
  assert.match(writtenEnv, /^ZE_ROUND_TIME=45$/m);
  assert.match(writtenEnv, /^ZE_ROUND_MONEY=15000$/m);
  assert.match(writtenEnv, /^CS2_MAXPLAYERS=40$/m);
  assert.match(writtenEnv, /^CS2_BOT_QUOTA=8$/m);
  assert.match(writtenEnv, /^CS2_BOT_QUOTA_MODE=normal$/m);
  assert.ok((await fs.readdir(path.join(dataDir, "backups", ".env"))).length >= 1);

  const drift = await (await get("/api/drift")).json();
  assert.equal(drift.needsRestart, true);
  assert.equal(drift.envDrift.find((item) => item.key === "ZE_ROUND_TIME").restartRequired, false);
  assert.equal(drift.envDrift.find((item) => item.key === "CS2_MAXPLAYERS").restartRequired, true);

  const revealed = await (await get("/api/env/reveal/CS2_RCONPW")).json();
  assert.equal(revealed.value, "secret");

  const mutate = (route, body) => fetch(baseUrl + route, {
    method: "POST", headers: { "content-type": "application/json", cookie, "x-cs2ze-csrf": auth.csrfToken }, body: JSON.stringify(body),
  });
  const mutateWith = (method, route, body) => fetch(baseUrl + route, {
    method, headers: { "content-type": "application/json", cookie, "x-cs2ze-csrf": auth.csrfToken }, body: JSON.stringify(body),
  });
  const classesBefore = await (await get("/api/player-classes")).json();
  assert.equal(classesBefore.presets.length, 20);
  assert.equal(classesBefore.liveOutOfSync, false);
  assert.equal(classesBefore.activation, "next_map");
  const invalidClasses = structuredClone(classesBefore.classes);
  invalidClasses.Human.RandomHuman.models[0].modelname = "../unsafe.vmdl";
  assert.equal((await mutateWith("PUT", "/api/player-classes", { classes: invalidClasses })).status, 400);
  const updatedClasses = structuredClone(classesBefore.classes);
  updatedClasses.Human.RandomHuman.health = 101;
  const classesSaved = await mutateWith("PUT", "/api/player-classes", { classes: updatedClasses });
  assert.equal(classesSaved.status, 200);
  assert.equal((await classesSaved.json()).write.liveSynced, true);
  const sourceClasses = await fs.readFile(path.join(classConfigDir, "playerclass.jsonc"), "utf8");
  const liveClasses = await fs.readFile(path.join(liveClassConfigDir, "playerclass.jsonc"), "utf8");
  assert.equal(sourceClasses, liveClasses);
  assert.ok((await fs.readdir(path.join(dataDir, "backups", "server-config__cs2fixes__zr__playerclass.jsonc"))).length >= 1);

  const mapsBefore = await (await get("/api/maps")).json();
  assert.equal(mapsBefore.maps[0].name, "ze_integration");
  assert.equal(mapsBefore.liveOutOfSync, false);
  assert.equal((await mutate("/api/maps/reload", { confirmMapRestart: false })).status, 400);
  const mapAdded = await mutate("/api/maps", { name: "ze_workshop_test", workshop_id: 456, display_name: "Workshop Test", enabled: true, groups: [] });
  assert.equal(mapAdded.status, 201);
  assert.equal((await mapAdded.json()).write.liveSynced, true);
  const sourceMaps = await fs.readFile(path.join(configDir, "maplist.jsonc"), "utf8");
  const liveMaps = await fs.readFile(path.join(liveConfigDir, "maplist.jsonc"), "utf8");
  assert.equal(sourceMaps, liveMaps);
  assert.match(sourceMaps, /ze_workshop_test/);
  assert.ok((await fs.readdir(path.join(dataDir, "backups", "server-config__cs2fixes__maplist.jsonc"))).length >= 1);
  assert.equal((await mutate("/api/maps/next", { map: "ze_workshop_test" })).status, 200);
  assert.equal((await mutate("/api/maps/current", { map: "ze_workshop_test", confirmMapChange: true })).status, 200);
  assert.equal((await mutate("/api/maps/reload", { confirmMapRestart: true })).status, 200);
  assert.ok(rcon.commands.includes("c_setnextmap ze_workshop_test"));
  assert.ok(rcon.commands.includes("c_map ze_workshop_test"));
  assert.ok(rcon.commands.includes("c_reload_map_list"));

  const adminAdded = await mutate("/api/admins", { steamid: "76561190000000001", name: "Route Admin", flags: "bc", immunity: 10, groups: [] });
  assert.equal(adminAdded.status, 201);
  assert.equal((await adminAdded.json()).admins.some((item) => item.isPlaceholder), false);
  assert.equal((await mutate("/api/admins/reload", {})).status, 200);
  assert.ok(rcon.commands.includes("c_reload_admins"));

  assert.equal((await mutate("/api/players/12/kick", { action: "kick" })).status, 400);
  assert.equal((await mutate("/api/players/12/kick", { action: "kick", reason: "integration test" })).status, 200);
  assert.ok(rcon.commands.includes("c_kick #12"));
  assert.equal((await mutate("/api/players/12/ban", { action: "kick", reason: "mismatch" })).status, 400);

  const migrateEnv = await fs.readFile(path.join(projectDir, ".env"), "utf8");
  await fs.writeFile(path.join(projectDir, ".env"), `${migrateEnv}\nCS2_ADMIN_STEAMID=76561190000000002\nCS2_ADMIN_NAME=Legacy Owner\nCS2_ADMIN_FLAGS=z\n`);
  assert.equal((await mutate("/api/admins", { steamid: "76561190000000003", name: "Blocked", flags: "b", immunity: 0, groups: [] })).status, 409);
  const migratedResponse = await mutate("/api/admins/migrate-env-steamid", { confirm: true });
  assert.equal(migratedResponse.status, 200);
  const migrated = await migratedResponse.json();
  assert.equal(migrated.envOverrideActive, false);
  assert.equal(migrated.admins.find((item) => item.steamid === "76561190000000002").name, "Legacy Owner");
  assert.match(await fs.readFile(path.join(projectDir, ".env"), "utf8"), /^CS2_ADMIN_STEAMID=$/m);
  assert.ok((await fs.readdir(path.join(dataDir, "backups", "server-config__cs2fixes__admins.jsonc"))).length >= 1);

  // install-mods.sh records what it actually downloaded; the panel reads those
  // markers to tell "configured" apart from "on disk".
  await fs.mkdir(path.join(cs2DataDir, ".cs2ze-mods"), { recursive: true });
  await fs.writeFile(
    path.join(cs2DataDir, ".cs2ze-mods", "cs2fixes.url"),
    "https://github.com/Source2ZE/CS2Fixes/releases/download/v1.19.0/CS2Fixes-v1.19.0-steamrt3.tar.gz",
  );
  const pluginsResponse = await (await get("/api/plugins")).json();
  assert.equal(pluginsResponse.plugins.length, 4);
  const cs2fixesPlugin = pluginsResponse.plugins.find((item) => item.id === "cs2fixes");
  assert.equal(cs2fixesPlugin.configuredVersion, "v1.20.1");
  assert.equal(cs2fixesPlugin.installedVersion, "v1.19.0");
  assert.equal(cs2fixesPlugin.pendingInstall, true);
  assert.equal(cs2fixesPlugin.loadedVersion, "1.20.1");
  // Nothing has been fetched from upstream in this test, so no version may be
  // offered and no update may be claimed.
  assert.equal(cs2fixesPlugin.latestVersion, null);
  assert.equal(cs2fixesPlugin.updateAvailable, false);
  assert.equal(pluginsResponse.plugins.find((item) => item.id === "metamod").installedVersion, null);
  assert.equal(pluginsResponse.settings.autoApply, false);

  // Fail-closed: a version the panel has not seen upstream is refused rather
  // than written, because install-mods.sh aborts the boot on a 404.
  const unseen = await mutate("/api/plugins/update", { selections: [{ id: "cs2fixes", version: "v9.9.9" }], apply: false });
  assert.equal(unseen.status, 400);
  assert.match((await unseen.json()).error, /not a release the panel has seen/);
  assert.equal((await fetch(`${baseUrl}/api/plugins/update`, {
    method: "POST", headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ selections: [{ id: "cs2fixes", version: "v1.20.1" }], apply: false }),
  })).status, 403);
  assert.match(await fs.readFile(path.join(projectDir, ".env"), "utf8"), /^CS2FIXES_VERSION=v1\.20\.1$/m);

  const savedUpdater = await mutateWith("PUT", "/api/plugins/settings", {
    checkEnabled: true, checkIntervalHours: 6, autoApply: true,
    autoApplyPlugins: ["cs2fixes"], applyWhenPlayersOnline: false, includePrereleases: false,
  });
  assert.equal(savedUpdater.status, 200);
  assert.equal((await savedUpdater.json()).checkIntervalHours, 6);
  assert.equal((await mutateWith("PUT", "/api/plugins/settings", { ...DEFAULT_PLUGIN_UPDATE_SETTINGS, checkIntervalHours: 0 })).status, 400);
  assert.equal((await (await get("/api/plugins")).json()).settings.autoApplyPlugins[0], "cs2fixes");

  await fs.writeFile(path.join(projectDir, ".env"), writtenEnv.replace("METAMOD_VERSION=2.0.0-git1411", "METAMOD_VERSION=2.0.0-git1500"));
  const blockedApply = await fetch(`${baseUrl}/api/server/apply`, {
    method: "POST", headers: { cookie, "x-cs2ze-csrf": auth.csrfToken },
  });
  assert.equal(blockedApply.status, 400);
  assert.match((await blockedApply.json()).error, /CS2Fixes v1\.20\.1/);

  const database = new DatabaseSync(path.join(dataDir, "panel.db"), { readOnly: false });
  const audit = database.prepare("SELECT target, detail FROM audit WHERE action = 'rcon.exec' ORDER BY id DESC LIMIT 1").get();
  assert.equal(audit.target, "status");
  assert.equal(audit.detail, null);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit WHERE action = 'env.update'").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit WHERE action = 'env.reveal'").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit WHERE action = 'playerclasses.update'").get().count, 1);
  database.prepare("UPDATE users SET role = 'operator' WHERE username = 'testowner'").run();
  assert.equal((await get("/api/rcon/commands")).status, 403);
  assert.equal((await get("/api/player-classes")).status, 403);
  database.close();
});
