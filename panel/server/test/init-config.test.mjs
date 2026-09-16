import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const initScript = path.resolve(here, "../../../scripts/init-config.sh");

function runInit(defaultsDir, runtimeDir) {
  return new Promise((resolve, reject) => {
    const child = spawn("/bin/sh", [initScript, defaultsDir, runtimeDir], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`init-config exited ${code}:\n${output}`));
    });
  });
}

test("runtime config initialization copies missing defaults without replacing settings", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cs2ze-init-config-"));
  const defaultsDir = path.join(root, "defaults");
  const runtimeDir = path.join(root, "server-config");
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await fs.mkdir(path.join(defaultsDir, "cs2fixes"), { recursive: true });
  await fs.mkdir(path.join(runtimeDir, "cs2fixes"), { recursive: true });
  await fs.writeFile(path.join(defaultsDir, "cs2fixes", "maplist.jsonc"), "default map list\n");
  await fs.writeFile(path.join(defaultsDir, "cs2fixes", "admins.jsonc"), "default admins\n");
  await fs.writeFile(path.join(runtimeDir, "cs2fixes", "maplist.jsonc"), "operator map list\n");

  await runInit(defaultsDir, runtimeDir);
  assert.equal(await fs.readFile(path.join(runtimeDir, "cs2fixes", "maplist.jsonc"), "utf8"), "operator map list\n");
  assert.equal(await fs.readFile(path.join(runtimeDir, "cs2fixes", "admins.jsonc"), "utf8"), "default admins\n");

  await fs.writeFile(path.join(defaultsDir, "cs2fixes", "maplist.jsonc"), "new Git default\n");
  await fs.writeFile(path.join(defaultsDir, "cs2fixes", "admins.jsonc"), "new Git admins\n");
  await runInit(defaultsDir, runtimeDir);

  assert.equal(await fs.readFile(path.join(runtimeDir, "cs2fixes", "maplist.jsonc"), "utf8"), "operator map list\n");
  assert.equal(await fs.readFile(path.join(runtimeDir, "cs2fixes", "admins.jsonc"), "utf8"), "default admins\n");
});
