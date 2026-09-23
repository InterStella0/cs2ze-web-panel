import {
  DEFAULT_PLUGIN_UPDATE_SETTINGS,
  PLUGIN_SPEC_BY_ID,
  pluginUpdateSettingsSchema,
  validateEnvPatch,
  type AutoUpdateRun,
  type PluginId,
  type PluginStatus,
  type PluginUpdateResult,
  type PluginUpdateSettings,
  type PluginsResponse,
} from "@cs2ze/shared";
import { audit, getSetting, setSetting } from "../db.js";
import { ComposeBusyError, isLifecycleBusy } from "../docker/compose.js";
import { startLifecycleJob, type JobActor } from "../docker/jobs.js";
import { readEnvFile, setValue, writeEnvFile } from "../files/dotenv-edit.js";
import { getProjectOrNull } from "../project.js";
import { refreshReleases } from "./releases.js";
import { buildStatuses, collectContext, lastCheckedAt } from "./status.js";

const SETTINGS_KEY = "plugins.updateSettings";
const LAST_RUN_KEY = "plugins.lastRun";

/** The updater acts on nobody's session, so audit rows carry no user id. */
const AUTO_ACTOR = { user: null, name: "auto-update" } as const;

export function getUpdateSettings(): PluginUpdateSettings {
  const raw = getSetting(SETTINGS_KEY);
  if (!raw) return DEFAULT_PLUGIN_UPDATE_SETTINGS;
  try {
    const parsed = pluginUpdateSettingsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_PLUGIN_UPDATE_SETTINGS;
  } catch {
    return DEFAULT_PLUGIN_UPDATE_SETTINGS;
  }
}

export function saveUpdateSettings(next: PluginUpdateSettings): PluginUpdateSettings {
  setSetting(SETTINGS_KEY, JSON.stringify(next));
  startUpdateScheduler();
  return next;
}

export function getLastRun(): AutoUpdateRun | null {
  const raw = getSetting(LAST_RUN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AutoUpdateRun;
  } catch {
    return null;
  }
}

function recordRun(run: AutoUpdateRun): AutoUpdateRun {
  setSetting(LAST_RUN_KEY, JSON.stringify(run));
  return run;
}

export async function getPluginsResponse(): Promise<PluginsResponse> {
  const settings = getUpdateSettings();
  const context = await collectContext();
  return {
    plugins: await buildStatuses(context, settings),
    checkedAt: lastCheckedAt(context.snapshots),
    settings,
    lastRun: getLastRun(),
    playersOnline: context.playersOnline,
  };
}

function httpError(message: string, statusCode = 400): Error {
  return Object.assign(new Error(message), { statusCode });
}

export interface PluginSelection {
  id: PluginId;
  version: string;
}

/**
 * Write the selected versions to .env, optionally recreating the container.
 *
 * Every selection is checked against a release the panel has actually seen
 * upstream, because install-mods.sh aborts the boot when the archive URL it
 * builds cannot be downloaded. The resulting .env then goes through the same
 * compatibility validation as the settings page, so a Metamod build that the
 * pinned CS2Fixes release cannot load is refused here rather than at boot.
 */
export async function applyPluginVersions(
  selections: PluginSelection[],
  apply: boolean,
  actor: JobActor,
): Promise<PluginUpdateResult> {
  const settings = getUpdateSettings();
  const context = await collectContext();
  const statuses = await buildStatuses(context, settings);
  const byId = new Map(statuses.map((status) => [status.id, status]));

  const written: PluginUpdateResult["written"] = [];
  const changes: Record<string, string> = {};
  for (const selection of selections) {
    const status = byId.get(selection.id);
    const spec = PLUGIN_SPEC_BY_ID[selection.id];
    if (!status || !spec) throw httpError(`Unknown plugin: ${selection.id}`);
    if (status.urlOverride) {
      throw httpError(`${status.name} is pinned by ${spec.urlKey}; clear that override before changing its version`);
    }
    const release = status.releases.find((candidate) => candidate.version === selection.version);
    if (!release) {
      throw httpError(`${status.name} ${selection.version} is not a release the panel has seen upstream`);
    }
    if (!release.assetAvailable) {
      throw httpError(
        `${status.name} ${selection.version} has no ${release.downloadUrl.slice(release.downloadUrl.lastIndexOf("/") + 1)} asset, so the installer could not download it`,
      );
    }
    if (selection.version === status.configuredVersion) continue;
    changes[spec.versionKey] = selection.version;
    written.push({ id: selection.id, key: spec.versionKey, from: status.configuredVersion, to: selection.version });
  }

  const findings = validateEnvPatch(context.env, changes);
  const errors = findings.filter((finding) => finding.severity === "error");
  if (errors.length) throw Object.assign(httpError(errors[0]!.message), { findings });
  if (!written.length) return { written: [], findings, jobId: null };

  const { parsed } = await readEnvFile();
  for (const [key, value] of Object.entries(changes)) setValue(parsed, key, value);
  await writeEnvFile(parsed);
  audit(
    actor.user,
    "plugins.update",
    written.map((item) => item.id).join(","),
    written.map((item) => `${item.key} ${item.from} -> ${item.to}`).join("; "),
  );

  const job = apply ? startLifecycleJob("apply", actor) : null;
  return { written, findings, jobId: job?.id ?? null };
}

/**
 * One pass of the update checker. Always refreshes the release lists; applies
 * them only when the operator opted the plugin in and nothing makes a recreate
 * unsafe right now. A deferred run is not an error: the next tick retries.
 */
export async function runUpdateCheck(): Promise<AutoUpdateRun> {
  const at = new Date().toISOString();
  const base = { at, jobId: null, updated: [] as AutoUpdateRun["updated"] };
  if (!getProjectOrNull()) {
    return recordRun({ ...base, outcome: "blocked", detail: "The panel setup preflight has not passed" });
  }

  try {
    await refreshReleases(true);
    const settings = getUpdateSettings();
    const context = await collectContext();
    const statuses = await buildStatuses(context, settings);
    const available = statuses.filter((status) => status.enabled && status.updateAvailable);
    if (!available.length) {
      return recordRun({ ...base, outcome: "up-to-date", detail: "Every enabled plugin is on its newest release" });
    }

    const describe = (list: PluginStatus[]): string =>
      list.map((status) => `${status.name} ${status.configuredVersion} → ${status.latestVersion}`).join(", ");
    const eligible = available.filter((status) => settings.autoApplyPlugins.includes(status.id));
    if (!settings.autoApply || !eligible.length) {
      return recordRun({ ...base, outcome: "idle", detail: `Update available: ${describe(available)}` });
    }
    if (isLifecycleBusy()) {
      return recordRun({ ...base, outcome: "deferred", detail: "Another server operation is running" });
    }
    if (!settings.applyWhenPlayersOnline && (context.playersOnline ?? 0) > 0) {
      return recordRun({
        ...base,
        outcome: "deferred",
        detail: `${context.playersOnline} player(s) connected; waiting for an empty server`,
      });
    }

    const selections = eligible.map((status) => ({ id: status.id, version: status.latestVersion! }));
    const result = await applyPluginVersions(selections, true, AUTO_ACTOR);
    return recordRun({
      at,
      outcome: "applied",
      detail: `Updated ${describe(eligible)} and recreated the server`,
      jobId: result.jobId,
      updated: result.written.map((item) => ({ id: item.id, from: item.from, to: item.to })),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    // The busy check above is not atomic with starting the job, so losing that
    // race is a retry, not a failure.
    if (error instanceof ComposeBusyError) return recordRun({ ...base, outcome: "deferred", detail });
    audit(null, "plugins.autoupdate.failed", undefined, detail);
    // A refusal carries a statusCode: that is the updater doing its job, not a
    // crash, so it reads as "blocked" rather than "failed" in the UI.
    const refused = typeof (error as { statusCode?: unknown }).statusCode === "number";
    return recordRun({ ...base, outcome: refused ? "blocked" : "failed", detail });
  }
}

let firstRun: NodeJS.Timeout | null = null;
let repeat: NodeJS.Timeout | null = null;

function rearmScheduler(): void {
  if (repeat) clearInterval(repeat);
  repeat = null;
  const settings = getUpdateSettings();
  if (!settings.checkEnabled) return;
  repeat = setInterval(() => void runUpdateCheck(), settings.checkIntervalHours * 60 * 60_000);
  // The checker must never be the reason the process stays alive.
  repeat.unref();
}

/** Arm the periodic check, with a delay so a boot loop cannot hammer upstream. */
export function startUpdateScheduler(delayMs = 60_000): void {
  stopUpdateScheduler();
  if (!getUpdateSettings().checkEnabled) return;
  firstRun = setTimeout(() => {
    firstRun = null;
    void runUpdateCheck();
    rearmScheduler();
  }, delayMs);
  firstRun.unref();
}

export function stopUpdateScheduler(): void {
  if (firstRun) clearTimeout(firstRun);
  if (repeat) clearInterval(repeat);
  firstRun = null;
  repeat = null;
}
