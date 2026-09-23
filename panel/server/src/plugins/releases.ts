import {
  PLUGIN_SPECS,
  type PluginId,
  type PluginSpec,
} from "@cs2ze/shared";
import { getSetting, setSetting } from "../db.js";

/**
 * Upstream release discovery for the Metamod plugin stack.
 *
 * Two shapes of "upstream" exist: GitHub releases for the Source2ZE plugins,
 * and the AlliedMods mmsdrop file index for Metamod, which has no releases API.
 * Both are normalized to the same record, and the ASSET NAMES are kept rather
 * than a ready-made URL: the archive name depends on CS2FIXES_RUNTIME, which the
 * operator can change after the list was cached.
 *
 * Results are cached in memory for the TTL and mirrored into the panel database
 * so a restart does not lose the last known state (or hammer the GitHub API,
 * which allows 60 unauthenticated requests per hour).
 */

export interface RawRelease {
  version: string;
  publishedAt: string | null;
  prerelease: boolean;
  url: string;
  notes: string | null;
  /** Downloadable file names published with this release. */
  assets: string[];
}

export interface ReleaseSnapshot {
  releases: RawRelease[];
  fetchedAt: string;
  error: string | null;
}

const TTL_MS = 30 * 60_000;
/**
 * Floor under a forced refresh. GitHub allows 60 unauthenticated requests per
 * hour per IP and one refresh spends three, so the "check now" button must not
 * be able to exhaust the budget.
 */
const MIN_FORCED_INTERVAL_MS = 60_000;
const MAX_RELEASES = 15;
const SNAPSHOT_SETTING = "plugins.releases";
const USER_AGENT = "cs2ze-panel";

const memory = new Map<PluginId, ReleaseSnapshot>();
let loadedFromDisk = false;

function loadPersisted(): void {
  if (loadedFromDisk) return;
  loadedFromDisk = true;
  const raw = getSetting(SNAPSHOT_SETTING);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as Partial<Record<PluginId, ReleaseSnapshot>>;
    for (const spec of PLUGIN_SPECS) {
      const snapshot = parsed[spec.id];
      if (snapshot && Array.isArray(snapshot.releases)) memory.set(spec.id, snapshot);
    }
  } catch {
    // A corrupt cache is not worth failing a request over; it refetches.
  }
}

function persist(): void {
  setSetting(SNAPSHOT_SETTING, JSON.stringify(Object.fromEntries(memory)));
}

async function getJson<T>(url: string, accept: string): Promise<T> {
  const response = await fetch(url, {
    headers: { accept, "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const hint = response.status === 403 || response.status === 429
      ? " (GitHub rate limit; the panel retries on the next check)"
      : "";
    throw new Error(`${new URL(url).host} returned HTTP ${response.status}${hint}`);
  }
  return response.json() as Promise<T>;
}

interface GithubRelease {
  tag_name?: string;
  html_url?: string;
  published_at?: string;
  draft?: boolean;
  prerelease?: boolean;
  body?: string;
  assets?: Array<{ name?: string }>;
}

async function fetchGithub(owner: string, repo: string): Promise<RawRelease[]> {
  const releases = await getJson<GithubRelease[]>(
    `https://api.github.com/repos/${owner}/${repo}/releases?per_page=${MAX_RELEASES * 2}`,
    "application/vnd.github+json",
  );
  return releases
    .filter((release) => release.draft !== true && typeof release.tag_name === "string")
    .slice(0, MAX_RELEASES)
    .map((release) => ({
      version: release.tag_name!,
      publishedAt: release.published_at ?? null,
      prerelease: release.prerelease === true,
      url: release.html_url ?? `https://github.com/${owner}/${repo}/releases/tag/${release.tag_name!}`,
      notes: release.body?.trim().slice(0, 1_000) || null,
      assets: (release.assets ?? []).map((asset) => asset.name).filter((name): name is string => Boolean(name)),
    }));
}

/**
 * Metamod publishes an Apache-style file index. Every `mmsource-<version>-linux.tar.gz`
 * in the branch directory is an installable build, so the file list IS the
 * release list; the newest build number is the latest build.
 */
async function fetchMmsdrop(branch: string): Promise<RawRelease[]> {
  const base = `https://mms.alliedmods.net/mmsdrop/${branch}/`;
  const response = await fetch(base, {
    headers: { accept: "text/html", "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`mms.alliedmods.net returned HTTP ${response.status}`);
  const html = await response.text();

  const seen = new Map<string, RawRelease>();
  const pattern = /mmsource-([0-9][0-9A-Za-z.+_-]*?)-linux\.tar\.gz/g;
  for (const match of html.matchAll(pattern)) {
    const version = match[1]!;
    if (seen.has(version)) continue;
    seen.set(version, {
      version,
      publishedAt: null,
      prerelease: false,
      url: base,
      notes: null,
      assets: [`mmsource-${version}-linux.tar.gz`],
    });
  }
  if (!seen.size) throw new Error("No Metamod builds found in the AlliedMods index");
  return [...seen.values()]
    .sort((a, b) => Number(/git(\d+)/.exec(b.version)?.[1] ?? 0) - Number(/git(\d+)/.exec(a.version)?.[1] ?? 0))
    .slice(0, MAX_RELEASES);
}

async function fetchSpec(spec: PluginSpec): Promise<RawRelease[]> {
  return spec.source.kind === "github"
    ? fetchGithub(spec.source.owner, spec.source.repo)
    : fetchMmsdrop(spec.source.branch);
}

function ageOf(snapshot: ReleaseSnapshot | undefined): number {
  return snapshot === undefined ? Infinity : Date.now() - Date.parse(snapshot.fetchedAt);
}

function needsFetch(snapshot: ReleaseSnapshot | undefined, force: boolean): boolean {
  if (snapshot === undefined) return true;
  if (force) return ageOf(snapshot) >= MIN_FORCED_INTERVAL_MS;
  return snapshot.error !== null || ageOf(snapshot) >= TTL_MS;
}

/**
 * Refresh every plugin's release list. A per-plugin failure is recorded on that
 * plugin instead of failing the batch, and the previous releases are kept so a
 * transient outage does not blank the UI.
 */
export async function refreshReleases(force = false): Promise<Map<PluginId, ReleaseSnapshot>> {
  loadPersisted();
  const stale = PLUGIN_SPECS.filter((spec) => needsFetch(memory.get(spec.id), force));
  if (!stale.length) return new Map(memory);

  await Promise.all(stale.map(async (spec) => {
    const previous = memory.get(spec.id);
    try {
      memory.set(spec.id, { releases: await fetchSpec(spec), fetchedAt: new Date().toISOString(), error: null });
    } catch (error) {
      memory.set(spec.id, {
        releases: previous?.releases ?? [],
        fetchedAt: previous?.fetchedAt ?? new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }));
  persist();
  return new Map(memory);
}

export function cachedReleases(): Map<PluginId, ReleaseSnapshot> {
  loadPersisted();
  return new Map(memory);
}

/** Test seam: drop both cache layers. */
export function clearReleaseCache(): void {
  memory.clear();
  loadedFromDisk = false;
}
