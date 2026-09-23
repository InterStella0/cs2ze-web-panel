import fs from "node:fs/promises";
import path from "node:path";
import {
  PLUGIN_SPECS,
  buildDownloadCandidates,
  compareVersions,
  isNewerVersion,
  versionFromDownloadUrl,
  type PluginId,
  type PluginRelease,
  type PluginSpec,
  type PluginStatus,
  type PluginUpdateSettings,
} from "@cs2ze/shared";
import { config } from "../config.js";
import { readEnvRecord } from "../files/dotenv-edit.js";
import { getRconStatus } from "../rcon/status.js";
import { cachedReleases, type RawRelease, type ReleaseSnapshot } from "./releases.js";

/**
 * install_archive() records the URL it downloaded in
 * $STEAMAPPDIR/.cs2ze-mods/<name>.url and skips the download when the marker
 * still matches. That marker is therefore the only authoritative record of what
 * is actually on disk, as opposed to what .env asks for. cs2-data is mounted
 * read-only in the panel, so reading it cannot disturb the installer.
 */
const MARKER_DIR = ".cs2ze-mods";

async function readMarkerVersion(spec: PluginSpec): Promise<string | null> {
  try {
    const url = await fs.readFile(path.join(config.cs2DataDir, MARKER_DIR, `${spec.marker}.url`), "utf8");
    return versionFromDownloadUrl(url.trim());
  } catch {
    return null;
  }
}

function toRelease(spec: PluginSpec, raw: RawRelease, runtime: string): PluginRelease {
  // install_archive() tries the candidates in order, so the release is
  // installable if any of them was published, and the effective download is the
  // first one that was.
  const candidates = buildDownloadCandidates(spec, raw.version, runtime);
  const resolved = candidates.find((url) => raw.assets.includes(url.slice(url.lastIndexOf("/") + 1)));
  return {
    version: raw.version,
    publishedAt: raw.publishedAt,
    prerelease: raw.prerelease,
    url: raw.url,
    downloadUrl: resolved ?? candidates[0]!,
    assetAvailable: resolved !== undefined,
    notes: raw.notes,
  };
}

function newestUsable(releases: PluginRelease[], includePrereleases: boolean): PluginRelease | null {
  const usable = releases.filter((release) => release.assetAvailable && (includePrereleases || !release.prerelease));
  if (!usable.length) return null;
  return usable.reduce((best, release) => (compareVersions(release.version, best.version) > 0 ? release : best));
}

export interface PluginStatusContext {
  env: Record<string, string>;
  snapshots: Map<PluginId, ReleaseSnapshot>;
  loadedVersions: Map<string, string>;
  playersOnline: number | null;
}

export async function collectContext(): Promise<PluginStatusContext> {
  const env = await readEnvRecord();
  const loadedVersions = new Map<string, string>();
  let playersOnline: number | null = null;
  try {
    const live = await getRconStatus();
    if (live.connected) {
      playersOnline = live.game?.players ?? 0;
      for (const plugin of live.plugins) loadedVersions.set(plugin.name.toLowerCase(), plugin.version);
    }
  } catch {
    // RCON being unreachable only costs the "loaded version" column.
  }
  return { env, snapshots: cachedReleases(), loadedVersions, playersOnline };
}

export async function buildStatuses(
  context: PluginStatusContext,
  settings: PluginUpdateSettings,
): Promise<PluginStatus[]> {
  return Promise.all(PLUGIN_SPECS.map(async (spec) => {
    const { env } = context;
    const configuredVersion = env[spec.versionKey]?.trim() || spec.defaultVersion;
    const runtime = (spec.runtimeKey ? env[spec.runtimeKey]?.trim() : "") || spec.defaultRuntime || "";
    const snapshot = context.snapshots.get(spec.id);
    const releases = (snapshot?.releases ?? []).map((raw) => toRelease(spec, raw, runtime));
    const latest = newestUsable(releases, settings.includePrereleases);
    const installedVersion = await readMarkerVersion(spec);
    const urlOverride = env[spec.urlKey]?.trim() || null;

    return {
      id: spec.id,
      name: spec.name,
      homepage: spec.homepage,
      enabled: (env[spec.installKey] ?? "1") === "1",
      installKey: spec.installKey,
      versionKey: spec.versionKey,
      urlKey: spec.urlKey,
      configuredVersion,
      installedVersion,
      loadedVersion: spec.rconName ? context.loadedVersions.get(spec.rconName.toLowerCase()) ?? null : null,
      urlOverride,
      latestVersion: latest?.version ?? null,
      latestPublishedAt: latest?.publishedAt ?? null,
      // A direct URL override wins over the version key in install-mods.sh, so
      // offering a version bump there would be a lie.
      updateAvailable: urlOverride === null && latest !== null && isNewerVersion(latest.version, configuredVersion),
      pendingInstall: installedVersion !== null && installedVersion !== configuredVersion,
      releases,
      error: snapshot?.error ?? null,
    };
  }));
}

export function lastCheckedAt(snapshots: Map<PluginId, ReleaseSnapshot>): string | null {
  const times = [...snapshots.values()].map((snapshot) => snapshot.fetchedAt).filter(Boolean);
  if (!times.length) return null;
  return times.reduce((oldest, current) => (Date.parse(current) < Date.parse(oldest) ? current : oldest));
}
