import type { RconCommandsResponse, RconStatusResponse } from "@cs2ze/shared";
import { rcon } from "./client.js";
import { mergeWhoPlayers, parseCvarList, parseNextMap, parsePlugins, parseStatus, parseTimeleft } from "./parse.js";

const STATUS_CACHE_MS = 4_000;
const PLUGIN_CACHE_MS = 60_000;
const COMMAND_CACHE_MS = 10 * 60_000;

let statusCache: { at: number; value: RconStatusResponse } | null = null;
let pluginCache: { at: number; value: RconStatusResponse["plugins"] } | null = null;
let commandCache: { at: number; value: RconCommandsResponse } | null = null;

export async function getRconStatus(force = false): Promise<RconStatusResponse> {
  const now = Date.now();
  if (!force && statusCache && now - statusCache.at < STATUS_CACHE_MS) return statusCache.value;

  const rawStatus = await rcon.tryExec("status");
  if (rawStatus === null) {
    const value: RconStatusResponse = {
      connected: false,
      error: rcon.error,
      game: null,
      players: [],
      plugins: pluginCache?.value ?? [],
      checkedAt: new Date().toISOString(),
    };
    statusCache = { at: now, value };
    return value;
  }

  const parsed = parseStatus(rawStatus);
  const timeleft = await rcon.tryExec("c_timeleft", 5_000);
  const nextMap = await rcon.tryExec("c_nextmap", 5_000);
  const who = parsed.players.length > 0 ? await rcon.tryExec("c_who", 5_000) : null;

  if (!pluginCache || now - pluginCache.at >= PLUGIN_CACHE_MS) {
    const rawPlugins = await rcon.tryExec("meta list", 10_000);
    if (rawPlugins !== null) pluginCache = { at: now, value: parsePlugins(rawPlugins) };
  }

  parsed.game.timeleftSeconds = timeleft === null ? null : parseTimeleft(timeleft);
  parsed.game.nextMap = nextMap === null ? null : parseNextMap(nextMap);
  const value: RconStatusResponse = {
    connected: true,
    error: null,
    game: parsed.game,
    players: who === null ? parsed.players : mergeWhoPlayers(parsed.players, who),
    plugins: pluginCache?.value ?? [],
    checkedAt: new Date().toISOString(),
  };
  statusCache = { at: now, value };
  return value;
}

export async function getRconCommands(force = false): Promise<RconCommandsResponse> {
  const now = Date.now();
  if (!force && commandCache && now - commandCache.at < COMMAND_CACHE_MS) return commandCache.value;
  const output = await rcon.exec("cvarlist", 30_000);
  const value = { commands: parseCvarList(output), cachedAt: new Date().toISOString() };
  commandCache = { at: now, value };
  return value;
}

export function observeRconCommand(command: string, output: string): void {
  if (command.trim().toLowerCase() !== "cvarlist") return;
  const value = { commands: parseCvarList(output), cachedAt: new Date().toISOString() };
  commandCache = { at: Date.now(), value };
}

export function clearRconStatusCache(): void {
  statusCache = null;
}
