/**
 * 1:1 port of check_known_compatibility() plus the "Metamod cannot be disabled
 * while a Metamod plugin is enabled" guard from scripts/install-mods.sh.
 *
 * install-mods.sh is fail-closed: any of these conditions aborts the boot with
 * `[cs2ze] ...` on stderr and the server never starts. The panel must therefore
 * refuse to write an .env that would trip them. Messages are deliberately kept
 * verbatim so they can be grepped against the container logs.
 */

export type CompatSeverity = "error" | "warning";

export interface CompatFinding {
  severity: CompatSeverity;
  message: string;
  keys: string[];
}

export interface CompatInput {
  METAMOD_VERSION?: string;
  CS2FIXES_VERSION?: string;
  MULTIADDONMANAGER_VERSION?: string;
  STRIPPERCS2_VERSION?: string;
  INSTALL_METAMOD?: string;
  INSTALL_CS2FIXES?: string;
  INSTALL_MULTIADDONMANAGER?: string;
  INSTALL_STRIPPERCS2?: string;
}

const enabled = (v: string | undefined, fallback = "1"): boolean => (v ?? fallback) === "1";

/** Extract the Metamod build number from e.g. "2.0.0-git1411" -> 1411. */
export function metamodBuild(version: string): number | null {
  const build = version.includes("git") ? version.slice(version.lastIndexOf("git") + 3) : "";
  return /^\d+$/.test(build) ? Number(build) : null;
}

export function checkCompatibility(env: CompatInput): CompatFinding[] {
  const findings: CompatFinding[] = [];

  const metamodEnabled = enabled(env.INSTALL_METAMOD);
  const cs2fixesEnabled = enabled(env.INSTALL_CS2FIXES);
  const mamEnabled = enabled(env.INSTALL_MULTIADDONMANAGER);
  const stripperEnabled = enabled(env.INSTALL_STRIPPERCS2);

  // install-mods.sh: Metamod disabled while a Metamod plugin is enabled -> exit 1.
  if (!metamodEnabled) {
    if (cs2fixesEnabled || mamEnabled || stripperEnabled) {
      findings.push({
        severity: "error",
        message: "Metamod cannot be disabled while a Metamod plugin is enabled",
        keys: ["INSTALL_METAMOD", "INSTALL_CS2FIXES", "INSTALL_MULTIADDONMANAGER", "INSTALL_STRIPPERCS2"],
      });
    }
    // check_known_compatibility only runs when Metamod is enabled.
    return findings;
  }

  const metamodVersion = env.METAMOD_VERSION ?? "2.0.0-git1411";
  const build = metamodBuild(metamodVersion);

  if (build === null) {
    // Matches the script's non-fatal path.
    findings.push({
      severity: "warning",
      message: `warning: cannot validate custom Metamod version '${metamodVersion}'`,
      keys: ["METAMOD_VERSION"],
    });
    return findings;
  }

  const cs2fixesVersion = env.CS2FIXES_VERSION ?? "v1.20.1";
  const mamVersion = env.MULTIADDONMANAGER_VERSION ?? "v1.5.4";
  const stripperVersion = env.STRIPPERCS2_VERSION ?? "v1.1.4";

  if (cs2fixesEnabled && cs2fixesVersion === "v1.20.1" && build > 1411) {
    findings.push({
      severity: "error",
      message: "CS2Fixes v1.20.1 requires Metamod build 1411 or earlier",
      keys: ["METAMOD_VERSION", "CS2FIXES_VERSION"],
    });
  }
  if (mamEnabled && mamVersion === "v1.6" && build <= 1459) {
    findings.push({
      severity: "error",
      message: "MultiAddonManager v1.6 requires Metamod newer than build 1459",
      keys: ["METAMOD_VERSION", "MULTIADDONMANAGER_VERSION"],
    });
  }
  if (stripperEnabled && stripperVersion === "v2.0" && build < 1461) {
    findings.push({
      severity: "error",
      message: "StripperCS2 v2.0 requires Metamod build 1461 or later",
      keys: ["METAMOD_VERSION", "STRIPPERCS2_VERSION"],
    });
  }

  return findings;
}

/** install-mods.sh configure_admin() validation, which also aborts the boot. */
export function checkAdminEnv(env: { CS2_ADMIN_STEAMID?: string; CS2_ADMIN_FLAGS?: string }): CompatFinding[] {
  const findings: CompatFinding[] = [];
  const steamid = env.CS2_ADMIN_STEAMID ?? "";
  if (steamid !== "" && !/^\d{17}$/.test(steamid)) {
    findings.push({
      severity: "error",
      message: "CS2_ADMIN_STEAMID must be a 17-digit SteamID64",
      keys: ["CS2_ADMIN_STEAMID"],
    });
  }
  const flags = env.CS2_ADMIN_FLAGS ?? "z";
  if (!/^[a-z]*$/.test(flags)) {
    findings.push({
      severity: "error",
      message: "CS2_ADMIN_FLAGS may contain only lowercase letters",
      keys: ["CS2_ADMIN_FLAGS"],
    });
  }
  return findings;
}

/** Everything install-mods.sh would reject, in one call. */
export function checkBootBlocking(env: CompatInput & { CS2_ADMIN_STEAMID?: string; CS2_ADMIN_FLAGS?: string }): CompatFinding[] {
  return [...checkCompatibility(env), ...checkAdminEnv(env)];
}
