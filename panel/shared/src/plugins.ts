import { z } from "zod";

/**
 * Catalog of the Metamod plugin stack that scripts/install-mods.sh downloads.
 *
 * install-mods.sh is fail-closed: it builds an archive URL from the *_VERSION
 * keys and aborts the boot when wget cannot fetch it. So every version this
 * module offers has to be a release the panel has actually SEEN upstream, with
 * an asset whose name matches the URL the installer will construct. Guessing a
 * tag that "looks right" would leave the server unable to start.
 */

export type PluginId = "metamod" | "cs2fixes" | "multiaddonmanager" | "strippercs2";

export const pluginId = z.enum(["metamod", "cs2fixes", "multiaddonmanager", "strippercs2"]);

export type PluginSource =
  | { kind: "github"; owner: string; repo: string }
  /** AlliedMods publishes Metamod as a plain file index, not as GitHub releases. */
  | { kind: "mmsdrop"; branch: string };

export interface PluginSpec {
  id: PluginId;
  name: string;
  homepage: string;
  source: PluginSource;
  /** State-marker basename written by install_archive(), under $STEAMAPPDIR/.cs2ze-mods. */
  marker: string;
  /** Plugin name as reported by `meta list`; null when the component is Metamod itself. */
  rconName: string | null;
  installKey: string;
  versionKey: string;
  urlKey: string;
  runtimeKey?: string;
  /** Default used by install-mods.sh when the key is absent from .env. */
  defaultVersion: string;
  defaultRuntime?: string;
}

export const PLUGIN_SPECS: readonly PluginSpec[] = [
  {
    id: "metamod",
    name: "Metamod:Source",
    homepage: "https://www.sourcemm.net/",
    source: { kind: "mmsdrop", branch: "2.0" },
    marker: "metamod",
    rconName: null,
    installKey: "INSTALL_METAMOD",
    versionKey: "METAMOD_VERSION",
    urlKey: "METAMOD_URL",
    defaultVersion: "2.0.0-git1411",
  },
  {
    id: "cs2fixes",
    name: "CS2Fixes",
    homepage: "https://github.com/Source2ZE/CS2Fixes",
    source: { kind: "github", owner: "Source2ZE", repo: "CS2Fixes" },
    marker: "cs2fixes",
    rconName: "CS2Fixes",
    installKey: "INSTALL_CS2FIXES",
    versionKey: "CS2FIXES_VERSION",
    urlKey: "CS2FIXES_URL",
    runtimeKey: "CS2FIXES_RUNTIME",
    defaultVersion: "v1.20.1",
    defaultRuntime: "steamrt3",
  },
  {
    id: "multiaddonmanager",
    name: "MultiAddonManager",
    homepage: "https://github.com/Source2ZE/MultiAddonManager",
    source: { kind: "github", owner: "Source2ZE", repo: "MultiAddonManager" },
    marker: "multiaddonmanager",
    rconName: "MultiAddonManager",
    installKey: "INSTALL_MULTIADDONMANAGER",
    versionKey: "MULTIADDONMANAGER_VERSION",
    urlKey: "MULTIADDONMANAGER_URL",
    runtimeKey: "MULTIADDONMANAGER_RUNTIME",
    defaultVersion: "v1.5.4",
    defaultRuntime: "steamrt3",
  },
  {
    id: "strippercs2",
    name: "StripperCS2",
    homepage: "https://github.com/Source2ZE/StripperCS2",
    source: { kind: "github", owner: "Source2ZE", repo: "StripperCS2" },
    marker: "strippercs2",
    rconName: "StripperCS2",
    installKey: "INSTALL_STRIPPERCS2",
    versionKey: "STRIPPERCS2_VERSION",
    urlKey: "STRIPPERCS2_URL",
    runtimeKey: "STRIPPERCS2_RUNTIME",
    defaultVersion: "v1.1.4",
    defaultRuntime: "steamrt3",
  },
];

export const PLUGIN_SPEC_BY_ID: Record<PluginId, PluginSpec> = Object.fromEntries(
  PLUGIN_SPECS.map((spec) => [spec.id, spec]),
) as Record<PluginId, PluginSpec>;

/** Accepted shape of a version string the panel is willing to write to .env. */
export const pluginVersion = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._+-]*$/, "Version may contain only letters, digits, dot, underscore, plus and dash");

interface ParsedVersion {
  numbers: number[];
  /** Metamod's "-gitNNNN" build counter. */
  build: number;
  /** Anything trailing that is not a build counter, e.g. "-rc1"; lowers precedence. */
  suffix: string;
}

export function parseVersion(raw: string): ParsedVersion {
  const value = raw.trim().replace(/^v/i, "");
  const build = /git(\d+)/i.exec(value);
  const withoutBuild = value.replace(/[-_]?git\d+/i, "");
  const numeric = /^\d+(?:\.\d+)*/.exec(withoutBuild)?.[0] ?? "";
  return {
    numbers: numeric ? numeric.split(".").map(Number) : [],
    build: build ? Number(build[1]) : 0,
    suffix: withoutBuild.slice(numeric.length).replace(/^[.\-_+]/, ""),
  };
}

/** Negative when a < b, positive when a > b. Unparseable versions compare equal. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const length = Math.max(left.numbers.length, right.numbers.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (left.numbers[index] ?? 0) - (right.numbers[index] ?? 0);
    if (diff !== 0) return diff;
  }
  if (left.build !== right.build) return left.build - right.build;
  // A plain release outranks any pre-release suffix of the same numbers.
  if (left.suffix === right.suffix) return 0;
  if (left.suffix === "") return 1;
  if (right.suffix === "") return -1;
  return left.suffix < right.suffix ? -1 : 1;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}

/**
 * Rebuild the archive URLs install-mods.sh would try for a version, newest
 * naming convention first, so the panel can confirm one of them actually exists
 * before writing the version to .env.
 *
 * The list has more than one entry because the Source2ZE projects have renamed
 * their release assets: older tags published `<name>-<tag>-linux.tar.gz`, and
 * StripperCS2 up to v1.1.3 published a runtime-less `<name>-<version>.zip`.
 * install_archive() walks the same list in the same order.
 */
export function buildDownloadCandidates(spec: PluginSpec, version: string, runtime?: string): string[] {
  const effectiveRuntime = runtime || spec.defaultRuntime || "";
  const release = (repo: string, file: string): string =>
    `https://github.com/Source2ZE/${repo}/releases/download/${version}/${file}`;
  switch (spec.id) {
    case "metamod":
      return [`https://mms.alliedmods.net/mmsdrop/2.0/mmsource-${version}-linux.tar.gz`];
    case "cs2fixes":
      return [
        release("CS2Fixes", `CS2Fixes-${version}-${effectiveRuntime}.tar.gz`),
        release("CS2Fixes", `CS2Fixes-${version}-linux.tar.gz`),
      ];
    case "multiaddonmanager":
      return [
        release("MultiAddonManager", `MultiAddonManager-${version}-${effectiveRuntime}.tar.gz`),
        release("MultiAddonManager", `MultiAddonManager-${version}-linux.tar.gz`),
      ];
    case "strippercs2":
      return [
        release("StripperCS2", `StripperCS2-${version}-${effectiveRuntime}.tar.gz`),
        // v1.1.3 and earlier: no runtime in the name, and the "v" is dropped.
        release("StripperCS2", `StripperCS2-${version.replace(/^v/, "")}.zip`),
      ];
  }
}

/** The archive install-mods.sh prefers for a version. */
export function buildDownloadUrl(spec: PluginSpec, version: string, runtime?: string): string {
  return buildDownloadCandidates(spec, version, runtime)[0]!;
}

/** Recover the installed version from a marker URL written by install_archive(). */
export function versionFromDownloadUrl(url: string): string | null {
  const tagged = /\/releases\/download\/([^/]+)\//.exec(url);
  if (tagged?.[1]) return decodeURIComponent(tagged[1]);
  const metamod = /mmsource-(.+?)-linux\.tar\.gz/.exec(url);
  if (metamod?.[1]) return metamod[1];
  return null;
}

export interface PluginRelease {
  version: string;
  publishedAt: string | null;
  prerelease: boolean;
  /** Human-facing release page. */
  url: string;
  /** Archive install-mods.sh would fetch for this version. */
  downloadUrl: string;
  /** False when the release exists but carries no asset with the expected name. */
  assetAvailable: boolean;
  notes: string | null;
}

export interface PluginStatus {
  id: PluginId;
  name: string;
  homepage: string;
  enabled: boolean;
  installKey: string;
  versionKey: string;
  urlKey: string;
  /** Version requested by .env, i.e. what the next boot will install. */
  configuredVersion: string;
  /** Version the installer's state marker says is on disk right now. */
  installedVersion: string | null;
  /** Version `meta list` reports for the running server. */
  loadedVersion: string | null;
  /** Set when *_URL pins a direct archive; the panel then leaves versions alone. */
  urlOverride: string | null;
  latestVersion: string | null;
  latestPublishedAt: string | null;
  updateAvailable: boolean;
  /** Configured differs from what is installed: a recreate will change the disk. */
  pendingInstall: boolean;
  releases: PluginRelease[];
  /** Upstream lookup failure for this plugin only. */
  error: string | null;
}

export type AutoUpdateOutcome = "idle" | "up-to-date" | "applied" | "deferred" | "blocked" | "failed";

export interface AutoUpdateRun {
  at: string;
  outcome: AutoUpdateOutcome;
  detail: string;
  /** Lifecycle job started by an automatic apply. */
  jobId: string | null;
  updated: Array<{ id: PluginId; from: string; to: string }>;
}

export const pluginUpdateSettingsSchema = z.object({
  /** Poll upstream on a timer. Turning this off also disables automatic applies. */
  checkEnabled: z.boolean(),
  checkIntervalHours: z.number().int().min(1).max(168),
  /** Write the new versions to .env and recreate the container without asking. */
  autoApply: z.boolean(),
  /** Plugins eligible for an automatic apply; others are only reported. */
  autoApplyPlugins: z.array(pluginId),
  /** Allow an automatic recreate while players are connected. */
  applyWhenPlayersOnline: z.boolean(),
  /** Skip releases GitHub marks as pre-releases. */
  includePrereleases: z.boolean(),
});

export type PluginUpdateSettings = z.infer<typeof pluginUpdateSettingsSchema>;

export const DEFAULT_PLUGIN_UPDATE_SETTINGS: PluginUpdateSettings = {
  checkEnabled: true,
  checkIntervalHours: 12,
  autoApply: false,
  autoApplyPlugins: [],
  applyWhenPlayersOnline: false,
  includePrereleases: false,
};

export interface PluginsResponse {
  plugins: PluginStatus[];
  /** When the upstream release lists were last refreshed. */
  checkedAt: string | null;
  settings: PluginUpdateSettings;
  lastRun: AutoUpdateRun | null;
  /** True while the game server is running with players connected. */
  playersOnline: number | null;
}

export const pluginUpdateRequestSchema = z.object({
  selections: z
    .array(z.object({ id: pluginId, version: pluginVersion }))
    .min(1, "Select at least one plugin to update")
    .max(PLUGIN_SPECS.length),
  /** Recreate the container immediately instead of leaving a pending change. */
  apply: z.boolean().default(false),
});

export interface PluginUpdateResult {
  written: Array<{ id: PluginId; key: string; from: string; to: string }>;
  findings: Array<{ severity: "error" | "warning"; message: string; keys: string[] }>;
  /** Job id when `apply` was requested. */
  jobId: string | null;
}
