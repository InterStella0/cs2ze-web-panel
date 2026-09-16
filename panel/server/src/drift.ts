import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ENV_SCHEMA_BY_KEY, requiresRestart, unescapeEnvSlashes, type DriftResponse } from "@cs2ze/shared";
import { config } from "./config.js";
import { dockerInspect } from "./docker/cli.js";
import { readEnvRecord } from "./files/dotenv-edit.js";
import { getProject } from "./project.js";

interface ContainerInspect {
  Config?: { Env?: string[] };
  State?: { StartedAt?: string };
}

const HOT_RELOADABLE = new Set([
  "server-config/cs2fixes/maplist.jsonc",
  "server-config/cs2fixes/admins.jsonc",
  "server-config/cs2fixes/cvar_whitelist.jsonc",
  "server-config/cs2fixes/discordbots.jsonc",
]);

function parseContainerEnv(lines: string[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of lines ?? []) {
    const split = line.indexOf("=");
    if (split > 0) {
      const key = line.slice(0, split);
      const value = line.slice(split + 1);
      out[key] = ENV_SCHEMA_BY_KEY[key]?.slashEscaped ? unescapeEnvSlashes(value) : value;
    }
  }
  return out;
}

async function walkFiles(directory: string, prefix: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const relative = path.posix.join(prefix, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(absolute, relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

function livePathFor(relative: string): string | null {
  if (relative.startsWith("server-config/cs2fixes/maps/")) {
    return path.join(config.cs2DataDir, "game/csgo/cfg/cs2fixes/maps", relative.slice("server-config/cs2fixes/maps/".length));
  }
  if (relative.startsWith("server-config/cs2fixes/")) {
    return path.join(config.cs2DataDir, "game/csgo/addons/cs2fixes/configs", relative.slice("server-config/cs2fixes/".length));
  }
  if (relative.startsWith("server-config/stripper/")) {
    return path.join(config.cs2DataDir, "game/csgo/addons/StripperCS2/maps", relative.slice("server-config/stripper/".length));
  }
  return null;
}

async function filesMatch(left: string, right: string | null): Promise<boolean> {
  if (!right) return false;
  try {
    const [a, b] = await Promise.all([fs.readFile(left), fs.readFile(right)]);
    return crypto.createHash("sha256").update(a).digest("hex") === crypto.createHash("sha256").update(b).digest("hex");
  } catch {
    return false;
  }
}

function validStartedAt(value: string | undefined): string | null {
  if (!value || value.startsWith("0001-") || Number.isNaN(Date.parse(value))) return null;
  return value;
}

export async function getDrift(): Promise<DriftResponse> {
  const inspect = await dockerInspect<ContainerInspect>(config.cs2ContainerName);
  const current = await readEnvRecord();
  const running = parseContainerEnv(inspect?.Config?.Env);
  // Only schema-managed game-server settings feed this banner. Panel-only and
  // extension variables may also be present because Compose passes the whole
  // .env through env_file, but recreating cs2-server cannot apply them.
  const keys = [...new Set([...Object.keys(current), ...Object.keys(running)])]
    .filter((key) => key in ENV_SCHEMA_BY_KEY)
    .sort();
  const envDrift = keys.filter((key) => (current[key] ?? null) !== (running[key] ?? null)).map((key) => {
    const isSecret = ENV_SCHEMA_BY_KEY[key]?.secret === true || !(key in ENV_SCHEMA_BY_KEY);
    return {
      key,
      running: isSecret ? null : running[key] ?? null,
      current: isSecret ? null : current[key] ?? null,
      isSecret,
      restartRequired: requiresRestart(key),
    };
  });

  const containerStartedAt = validStartedAt(inspect?.State?.StartedAt);
  const startedMs = containerStartedAt ? Date.parse(containerStartedAt) : 0;
  const { workingDir } = getProject();
  const configRoot = path.join(workingDir, "server-config");
  const relativeFiles = await walkFiles(configRoot, "server-config");
  const configDrift: DriftResponse["configDrift"] = [];
  for (const relative of relativeFiles) {
    const absolute = path.join(workingDir, relative);
    const stat = await fs.stat(absolute);
    if (containerStartedAt && stat.mtimeMs <= startedMs) continue;
    const liveMatches = await filesMatch(absolute, livePathFor(relative));
    // Matching live content is already effective and should not create noise.
    if (liveMatches) continue;
    configDrift.push({
      path: relative,
      modifiedAt: stat.mtime.toISOString(),
      liveMatches,
      hotReloadable: HOT_RELOADABLE.has(relative),
    });
  }

  return {
    envDrift,
    configDrift,
    containerStartedAt,
    needsRestart: envDrift.some((item) => item.restartRequired) || configDrift.some((item) => !item.hotReloadable),
  };
}
