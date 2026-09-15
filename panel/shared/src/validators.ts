import { z } from "zod";

/**
 * SteamID64: exactly 17 digits. Mirrors the glob check in
 * scripts/install-mods.sh configure_admin(), which rejects non-digits,
 * 16 chars and >=18 chars.
 */
export const steamId64 = z
  .string()
  .regex(/^\d{17}$/, "Must be a 17-digit SteamID64");

/** Admin permission flags: lowercase letters only (install-mods.sh rejects anything else). */
export const adminFlags = z
  .string()
  .regex(/^[a-z]*$/, "Flags may contain only lowercase letters a-z");

/** CS2 map name. Should match the .vpk name to avoid unintended behaviour. */
export const mapName = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, "Map name may contain only letters, digits, _ and -");

export const configGroupName = z
  .string()
  .regex(/^[A-Za-z0-9 _.-]{1,64}$/, "Group name may contain only letters, digits, spaces, _, . and -");

export const workshopId = z
  .number()
  .int()
  .positive("Workshop ID must be a positive integer");

/** Workshop IDs arrive from the UI as strings often enough to be worth coercing. */
export const workshopIdLike = z.union([
  workshopId,
  z.string().regex(/^\d+$/).transform((s) => Number(s)),
]);

/**
 * A .env value written by the panel.
 *
 * This file is BOTH the compose interpolation source and the env_file, so a
 * literal `$` would trigger compose interpolation at the next `up`. Rather than
 * guess at an escape, reject the characters that cannot round-trip.
 */
export const envValue = z
  .string()
  .refine((v) => !v.includes("\n") && !v.includes("\r"), "Value may not contain newlines")
  .refine((v) => !v.includes("$"), "Value may not contain '$' (compose would interpolate it)")
  .refine((v) => !v.includes("`"), "Value may not contain backticks")
  .refine((v) => v === v.trim(), "Value may not have leading or trailing whitespace");

/**
 * The base image substitutes CS2_* values into its configs with sed, so a literal
 * `/` has to be written `\/` in the file (see README.md). The panel stores the
 * human form and escapes on write, so the user types a normal URL or path.
 */
export function escapeEnvSlashes(value: string): string {
  return value.replace(/\\\//g, "/").replace(/\//g, "\\/");
}

export function unescapeEnvSlashes(value: string): string {
  return value.replace(/\\\//g, "/");
}

/** Semicolon-separated extra cvar lines, e.g. "cs2f_flashlight_enable 1;zr_knockback_scale 5.0". */
export const extraCfg = z.string().refine((v) => {
  if (v.trim() === "") return true;
  return v
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .every((line) => /^[a-z_][a-z0-9_]*(\s+\S.*)?$/i.test(line));
}, "Each ';'-separated entry must look like: cvar_name value");

/** Comma-separated numeric workshop addon IDs (MAM_EXTRA_ADDONS / MAM_CLIENT_EXTRA_ADDONS). */
export const addonIdList = z.string().refine((v) => {
  if (v.trim() === "") return true;
  return v
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .every((id) => /^\d+$/.test(id));
}, "Must be a comma-separated list of numeric workshop IDs");

export const portNumber = z.coerce.number().int().min(1).max(65535);

/** Admin permission flag catalog, from addons/cs2fixes/configs/admins.jsonc.example. */
export const ADMIN_FLAGS: ReadonlyArray<{ flag: string; label: string; description: string }> = [
  { flag: "a", label: "Reserved slots", description: "Can use reserved slots" },
  { flag: "b", label: "Generic admin", description: "Required for admins" },
  { flag: "c", label: "Kick", description: "Kick other players" },
  { flag: "d", label: "Ban", description: "Ban other players" },
  { flag: "e", label: "Unban", description: "Remove bans" },
  { flag: "f", label: "Slay", description: "Slay other players" },
  { flag: "g", label: "Change map", description: "Change the map" },
  { flag: "h", label: "Cvars", description: "Change cvars" },
  { flag: "i", label: "Configs", description: "Change configs" },
  { flag: "j", label: "Chat", description: "Special chat privileges" },
  { flag: "k", label: "Vote", description: "Start and manage votes" },
  { flag: "l", label: "Password", description: "Password the server" },
  { flag: "m", label: "RCON", description: "Remote console" },
  { flag: "n", label: "Cheats", description: "Change sv_cheats and related commands" },
  { flag: "z", label: "Root", description: "Grants ALL flags — use with caution" },
];
