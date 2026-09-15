import { z } from "zod";
import { parse, type ParseError } from "jsonc-parser";
import { config } from "../config.js";
import { docker, dockerInspect } from "../docker/cli.js";
import { projectPath } from "../project.js";
import { readLiveFile, readProjectFile, safeWrite } from "./safe-write.js";

export const MANAGED_CONFIGS = {
  maps: {
    source: "config/cs2fixes/maplist.jsonc",
    liveRel: "game/csgo/addons/cs2fixes/configs/maplist.jsonc",
    containerPath: "/home/steam/cs2-dedicated/game/csgo/addons/cs2fixes/configs/maplist.jsonc",
  },
  admins: {
    source: "config/cs2fixes/admins.jsonc",
    liveRel: "game/csgo/addons/cs2fixes/configs/admins.jsonc",
    containerPath: "/home/steam/cs2-dedicated/game/csgo/addons/cs2fixes/configs/admins.jsonc",
  },
} as const;

export type ManagedConfigName = keyof typeof MANAGED_CONFIGS;

export interface ManagedWriteResult {
  saved: true;
  liveSynced: boolean;
  liveError: string | null;
}

function httpError(message: string, statusCode = 400): Error {
  return Object.assign(new Error(message), { statusCode });
}

export async function readManagedConfig<TSchema extends z.ZodTypeAny>(name: ManagedConfigName, schema: TSchema): Promise<z.output<TSchema>> {
  const errors: ParseError[] = [];
  const raw = await readProjectFile(MANAGED_CONFIGS[name].source);
  const value = parse(raw, errors, { allowTrailingComma: true });
  if (errors.length) throw httpError(`${MANAGED_CONFIGS[name].source} is not valid JSONC`, 500);
  const checked = schema.safeParse(value);
  if (!checked.success) {
    throw httpError(`${MANAGED_CONFIGS[name].source}: ${checked.error.issues[0]?.message ?? "invalid configuration"}`, 500);
  }
  return checked.data;
}

export async function managedConfigOutOfSync(name: ManagedConfigName): Promise<boolean> {
  const spec = MANAGED_CONFIGS[name];
  const [source, live] = await Promise.all([readProjectFile(spec.source), readLiveFile(spec.liveRel)]);
  return live === null || source.trim() !== live.trim();
}

/**
 * Sync one fixed, allowlisted file through Docker. The game-data mount remains
 * read-only in the panel and no request value can influence either path.
 */
export async function syncManagedConfig(name: ManagedConfigName): Promise<{ liveSynced: boolean; liveError: string | null }> {
  const spec = MANAGED_CONFIGS[name];
  try {
    if (!(await dockerInspect(config.cs2ContainerName))) {
      return { liveSynced: false, liveError: `Container ${config.cs2ContainerName} does not exist; saved for the next install/apply` };
    }
    await docker(["cp", projectPath(spec.source), `${config.cs2ContainerName}:${spec.containerPath}`]);
    return { liveSynced: true, liveError: null };
  } catch (error) {
    return { liveSynced: false, liveError: error instanceof Error ? error.message : String(error) };
  }
}

export async function writeManagedConfig<TSchema extends z.ZodTypeAny>(name: ManagedConfigName, schema: TSchema, value: unknown): Promise<ManagedWriteResult> {
  const checked = schema.safeParse(value);
  if (!checked.success) throw httpError(checked.error.issues[0]?.message ?? "Invalid configuration");
  await safeWrite(MANAGED_CONFIGS[name].source, `${JSON.stringify(checked.data, null, 2)}\n`);
  return { saved: true, ...(await syncManagedConfig(name)) };
}
