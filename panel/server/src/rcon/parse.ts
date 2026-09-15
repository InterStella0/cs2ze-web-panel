import type { Player, PluginInfo, ServerStatus } from "@cs2ze/shared";

type GameStatus = NonNullable<ServerStatus["game"]>;

export interface ParsedStatus {
  game: GameStatus;
  players: Player[];
}

interface WhoPlayer {
  userid: string | null;
  name: string | null;
  steamid: string | null;
  isAdmin: boolean;
}

const valueAfterLabel = (text: string, label: string): string | null => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`^\\s*${escaped}\\s*:\\s*(.*?)\\s*$`, "im"));
  return match?.[1]?.trim() || null;
};

function parsePlayerLine(line: string): Player | null {
  // CS2 has emitted both "# userid ..." and "# slot userid ..." layouts.
  const match = line.match(/^\s*#\s*(?:(\d+)\s+)?(\d+)\s+"((?:\\.|[^"])*)"\s+(\S+)\s*(.*)$/);
  if (!match) return null;

  const rest = match[5] ?? "";
  const tokens = rest.trim().split(/\s+/).filter(Boolean);
  const connectedAt = tokens.findIndex((token) => /^\d{1,3}:\d{2}(?::\d{2})?$/.test(token));
  const ping = connectedAt >= 0 ? Number(tokens[connectedAt + 1]) : Number.NaN;
  const loss = connectedAt >= 0 ? Number(tokens[connectedAt + 2]) : Number.NaN;
  const state = tokens.find((token) => /^(active|connected|connecting|challenging|spawning|zombie)$/i.test(token)) ?? "unknown";
  const address = tokens.find((token) => /^(?:\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:]+\]|loopback):\d+$/i.test(token)) ?? null;
  const steamToken = match[4] ?? "";
  const isBot = /^(?:BOT|HLTV)$/i.test(steamToken);

  return {
    userid: match[2]!,
    name: match[3]!.replace(/\\"/g, '"').replace(/\\\\/g, "\\"),
    steamid: isBot || /^(?:pending|unknown)$/i.test(steamToken) ? null : steamToken,
    ping: Number.isFinite(ping) ? ping : null,
    loss: Number.isFinite(loss) ? loss : null,
    state,
    time: connectedAt >= 0 ? tokens[connectedAt] ?? null : null,
    address,
    isBot,
    isAdmin: false,
  };
}

/**
 * CS2's `status` has no "map :" line. The loaded map is reported in the
 * spawngroups section instead:
 *   loaded spawngroup(  1)  : SV:  [1: ze_winter_warehouse_p | main lump | mapload]
 * The remaining spawngroups are prefab paths (prefabs/misc/...), so the first
 * entry without a slash is the map. The "map :" label is still honoured first in
 * case a build or fork emits it.
 */
function parseCurrentMap(text: string): string | null {
  const labelled = valueAfterLabel(text, "map")?.split(/\s+/)[0];
  if (labelled) return labelled;

  for (const line of text.split("\n")) {
    const name = line.match(/loaded\s+spawngroup\(\s*\d+\s*\)\s*:.*?\[\s*\d+:\s*([^\s|\]]+)/i)?.[1];
    if (name && !name.includes("/")) return name;
  }
  return null;
}

export function parseStatus(text: string): ParsedStatus {
  const summary = text.match(/^\s*players\s*:\s*(\d+)\s+humans?,\s*(\d+)\s+bots?\s*\((\d+)\s+max/im);
  const addressLine = valueAfterLabel(text, "udp/ip");
  const publicInParens = addressLine?.match(/public\s+(?:ip\s+)?([^\s,)]+)/i)?.[1] ?? null;
  const directAddress = addressLine?.match(/((?:\d{1,3}\.){3}\d{1,3}:\d+)/)?.[1] ?? null;
  const players = text.split("\n").map(parsePlayerLine).filter((player): player is Player => player !== null);
  const bots = summary ? Number(summary[2]) : players.filter((player) => player.isBot).length;
  const humans = summary ? Number(summary[1]) : players.length - bots;

  return {
    game: {
      hostname: valueAfterLabel(text, "hostname"),
      currentMap: parseCurrentMap(text),
      nextMap: null,
      timeleftSeconds: null,
      players: humans,
      bots,
      maxPlayers: summary ? Number(summary[3]) : 0,
      publicAddress: publicInParens ?? directAddress,
      version: valueAfterLabel(text, "version"),
    },
    players,
  };
}

export function parseWho(text: string): WhoPlayer[] {
  const out: WhoPlayer[] = [];
  for (const line of text.split("\n")) {
    const steamid = line.match(/\b(7656119\d{10}|STEAM_[0-5]:[01]:\d+)\b/i)?.[1] ?? null;
    const userid = line.match(/(?:#|user\s*id\s*:?\s*)(\d+)/i)?.[1] ?? null;
    if (!steamid && !userid) continue;
    const quotedName = line.match(/"((?:\\.|[^"])*)"/)?.[1] ?? null;
    out.push({ userid, name: quotedName, steamid, isAdmin: true });
  }
  return out;
}

export function mergeWhoPlayers(players: Player[], whoText: string): Player[] {
  const who = parseWho(whoText);
  const matched = players.map((player) => {
    const entry = who.find((candidate) =>
      (candidate.userid !== null && candidate.userid === player.userid)
      || (candidate.steamid !== null && candidate.steamid === player.steamid));
    return entry ? { ...player, steamid: entry.steamid ?? player.steamid, isAdmin: entry.isAdmin } : player;
  });

  for (const entry of who) {
    if (matched.some((player) => player.userid === entry.userid || (entry.steamid && player.steamid === entry.steamid))) continue;
    matched.push({
      userid: entry.userid ?? "unknown",
      name: entry.name ?? "Unknown player",
      steamid: entry.steamid,
      ping: null,
      loss: null,
      state: "unknown",
      time: null,
      address: null,
      isBot: false,
      isAdmin: entry.isAdmin,
    });
  }
  return matched;
}

export function parseTimeleft(text: string): number | null {
  if (/no\s+(?:time\s*)?limit/i.test(text)) return null;

  // CS2Fixes c_timeleft answers in words: "Timeleft: 37 minutes 4 seconds".
  const hoursWord = text.match(/(\d+)\s*hours?/i);
  const minutesWord = text.match(/(\d+)\s*min(?:ute)?s?/i);
  const secondsWord = text.match(/(\d+)\s*sec(?:ond)?s?/i);
  if (hoursWord || minutesWord || secondsWord) {
    return Number(hoursWord?.[1] ?? 0) * 3600 + Number(minutesWord?.[1] ?? 0) * 60 + Number(secondsWord?.[1] ?? 0);
  }

  if (/timeleft\s*:\s*0\s*$/im.test(text)) return null;
  const match = text.match(/(?:time\s*(?:left|remaining)|remaining\s*time)?[^\d]*(?:(\d+):)?(\d{1,2}):(\d{2})/i);
  if (!match) return null;
  const hours = Number(match[1] ?? 0);
  return hours * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

export function parseNextMap(text: string): string | null {
  return text.match(/(?:next\s+map(?:\s+is)?|forced\s+next\s+map)\s*:?\s*["']?([a-z0-9_\-]+)/i)?.[1] ?? null;
}

export function parsePlugins(text: string): PluginInfo[] {
  const plugins: PluginInfo[] = [];
  for (const line of text.split("\n")) {
    const full = line.match(/^\s*\[(\d+)\]\s+(.+?)\s+\(([^()]*)\)\s+by\s+(.+?)\s*$/i);
    if (full) {
      plugins.push({ index: full[1]!, name: full[2]!.trim(), version: full[3]!.trim(), author: full[4]!.trim() });
      continue;
    }
    const compact = line.match(/^\s*\[(\d+)\]\s+(.+?)\s+\((?:v)?([^()\s]+)(?:\s+[^()]*)?\)\s*$/i);
    if (compact && !/<ERROR>/i.test(compact[2]!)) {
      plugins.push({ index: compact[1]!, name: compact[2]!.trim(), version: compact[3]!.trim(), author: "" });
    }
  }
  return plugins;
}

export function parseCvarList(text: string): string[] {
  const commands = new Set<string>();
  for (const line of text.split("\n")) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_.]*)\s+(?::|=|\[)/);
    if (match) commands.add(match[1]!);
  }
  return [...commands].sort((a, b) => a.localeCompare(b));
}
