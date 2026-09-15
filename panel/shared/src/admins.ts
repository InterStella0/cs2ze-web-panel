import { z } from "zod";
import { adminFlags, configGroupName, steamId64 } from "./validators.js";

/**
 * Schema for config/cs2fixes/admins.jsonc.
 * Field set taken from addons/cs2fixes/configs/admins.jsonc.example.
 */

export const adminGroupSchema = z.object({
  flags: adminFlags.optional(),
  immunity: z.number().int().nonnegative().optional(),
});

export const adminEntrySchema = z.object({
  name: z.string().min(1).max(64),
  /** Groups this admin inherits permissions from. Case sensitive. */
  groups: z.array(configGroupName).optional(),
  /** Combines with any flags from the admin's groups. */
  flags: adminFlags.optional(),
  /** Highest value from here or any of the admin's groups wins. */
  immunity: z.number().int().nonnegative().optional(),
});

export const adminsSchema = z.object({
  Groups: z.record(configGroupName, adminGroupSchema).default({}),
  Admins: z.record(z.string(), adminEntrySchema).default({}),
});

export type AdminGroup = z.infer<typeof adminGroupSchema>;
export type AdminEntry = z.infer<typeof adminEntrySchema>;
export type Admins = z.infer<typeof adminsSchema>;

/** The repo ships this as a harmless no-op entry; the panel removes it once real admins exist. */
export const PLACEHOLDER_ADMIN_ID = "0";

export const newAdminSchema = z.object({
  steamid: steamId64,
  name: z.string().min(1).max(64),
  flags: adminFlags.default(""),
  immunity: z.number().int().nonnegative().default(0),
  groups: z.array(configGroupName).default([]),
});

export const adminPatchSchema = adminEntrySchema.partial();
export const adminGroupsSchema = z.record(configGroupName, adminGroupSchema);
export const migrateEnvAdminSchema = z.object({ confirm: z.literal(true) });

export interface AdminsResponse {
  admins: Array<AdminEntry & { steamid: string; isPlaceholder: boolean }>;
  groups: Record<string, AdminGroup>;
  /**
   * True when CS2_ADMIN_STEAMID is non-empty. install-mods.sh then overwrites
   * admins.jsonc with that single entry on every boot, destroying this list.
   */
  envOverrideActive: boolean;
  envOverrideSteamId: string | null;
  liveOutOfSync: boolean;
}
