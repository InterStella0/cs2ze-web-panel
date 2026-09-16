import type { ServerSetupProgress } from "@cs2ze/shared";
import { sanitizeLog } from "../rcon/sanitize.js";

const UPDATE_STATE = /Update state \([^)]*\)\s+([a-z]+),\s+progress:\s+([0-9]+(?:\.[0-9]+)?)\s+\((\d+)\s*\/\s*(\d+)\)/gi;
const STEAMCMD_CHECK = /\[\s*0%\]\s+Checking for available updates/gi;
const STEAMCMD_DOWNLOAD = /\[\s*(?:(\d+)%|----)\]\s+Downloading update\s+\(([\d,]+)\s+of\s+([\d,]+)\s+KB\)/gi;
const STEAMCMD_INSTALL = /\[(?:\s*100%|----)\]\s+(?:Download complete|Installing update|Extracting package|Cleaning up|Update complete)/gi;
const INSTALL_COMPLETE = /Success!\s+App\s+'?730'?\s+fully installed|fully installed\./gi;
const SERVER_READY = /Connection to Steam servers successful\./gi;

type SetupEvent = ServerSetupProgress & { index: number };

/** Parse the most recent SteamCMD state from a bounded container-log tail. */
export function parseSetupProgress(raw: string): ServerSetupProgress | null {
  const output = sanitizeLog(raw);
  let latest: SetupEvent | null = null;

  for (const match of output.matchAll(STEAMCMD_CHECK)) {
    latest = { index: match.index, phase: "updating-steamcmd", percentage: null, downloadedBytes: null, totalBytes: null };
  }
  for (const match of output.matchAll(STEAMCMD_DOWNLOAD)) {
    const downloadedBytes = Number(match[2]!.replaceAll(",", "")) * 1024;
    const totalBytes = Number(match[3]!.replaceAll(",", "")) * 1024;
    const percentage = match[1] === undefined
      ? (totalBytes > 0 ? downloadedBytes / totalBytes * 100 : null)
      : Number(match[1]);
    if (!latest || match.index > latest.index) {
      latest = { index: match.index, phase: "updating-steamcmd", percentage, downloadedBytes, totalBytes };
    }
  }
  for (const match of output.matchAll(STEAMCMD_INSTALL)) {
    if (!latest || match.index > latest.index) {
      latest = { index: match.index, phase: "updating-steamcmd", percentage: null, downloadedBytes: null, totalBytes: null };
    }
  }

  for (const match of output.matchAll(UPDATE_STATE)) {
    if (!latest || match.index > latest.index) {
      const state = match[1]!.toLowerCase();
      const totalBytes = Number(match[4]);
      const downloading = state === "downloading" && totalBytes > 0;
      latest = {
        index: match.index,
        phase: downloading ? "downloading" : "configuring",
        percentage: downloading ? Math.min(100, Math.max(0, Number(match[2]))) : null,
        downloadedBytes: downloading ? Number(match[3]) : null,
        totalBytes: downloading ? totalBytes : null,
      };
    }
  }
  if (!latest) return null;

  for (const match of output.matchAll(SERVER_READY)) {
    if (match.index > latest.index) return null;
  }

  let completedAfterLatest = false;
  for (const match of output.matchAll(INSTALL_COMPLETE)) {
    if (match.index > latest.index) completedAfterLatest = true;
  }
  if (completedAfterLatest && latest.phase === "downloading") {
    return { phase: "configuring", percentage: null, downloadedBytes: null, totalBytes: null };
  }
  return {
    phase: latest.phase,
    percentage: latest.percentage,
    downloadedBytes: latest.downloadedBytes,
    totalBytes: latest.totalBytes,
  };
}
