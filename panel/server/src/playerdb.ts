const PLAYERDB_STEAM_URL = "https://playerdb.co/api/player/steam/";
const PLAYERDB_USER_AGENT = "cs2ze-panel/1.0 (+https://github.com/InterStella0/cs2ze-docker)";
const SUCCESS_CACHE_MS = 6 * 60 * 60_000;
const FAILURE_CACHE_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 512;
const steamId = /^(?:\d{17}|STEAM_[0-5]:[01]:\d{1,10}|\[U:1:\d{1,10}\])$/i;

interface PlayerDbResponse {
  success?: boolean;
  data?: {
    player?: {
      avatar?: unknown;
    };
  };
}

interface CachedAvatar {
  value: string | null;
  expiresAt: number;
}

const cache = new Map<string, CachedAvatar>();
const pending = new Map<string, Promise<string | null>>();

export function isPlayerDbSteamId(value: string): boolean {
  return steamId.test(value);
}

function cacheAvatar(steamid: string, value: string | null): void {
  if (cache.size >= MAX_CACHE_ENTRIES && !cache.has(steamid)) {
    const now = Date.now();
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= now) cache.delete(key);
    }
    if (cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value as string | undefined;
      if (oldest) cache.delete(oldest);
    }
  }
  cache.set(steamid, {
    value,
    expiresAt: Date.now() + (value === null ? FAILURE_CACHE_MS : SUCCESS_CACHE_MS),
  });
}

function safeAvatarUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export async function fetchPlayerDbAvatar(
  steamid: string,
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  const response = await fetcher(`${PLAYERDB_STEAM_URL}${encodeURIComponent(steamid)}`, {
    headers: {
      accept: "application/json",
      "user-agent": PLAYERDB_USER_AGENT,
    },
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) return null;

  const body = await response.json() as PlayerDbResponse;
  if (body.success === false) return null;
  return safeAvatarUrl(body.data?.player?.avatar);
}

export async function getPlayerDbAvatar(steamid: string): Promise<string | null> {
  const now = Date.now();
  const cached = cache.get(steamid);
  if (cached && cached.expiresAt > now) return cached.value;

  const existing = pending.get(steamid);
  if (existing) return existing;

  const lookup = fetchPlayerDbAvatar(steamid)
    .catch(() => null)
    .then((value) => {
      cacheAvatar(steamid, value);
      pending.delete(steamid);
      return value;
    });
  pending.set(steamid, lookup);
  return lookup;
}
