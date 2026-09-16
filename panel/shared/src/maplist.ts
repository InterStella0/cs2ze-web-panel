import { z } from "zod";
import { configGroupName, mapName, workshopId, workshopIdLike } from "./validators.js";

/**
 * Schema for server-config/cs2fixes/maplist.jsonc.
 * Field set taken from addons/cs2fixes/configs/maplist.jsonc.example.
 */

export const mapGroupSchema = z.object({
  enabled: z.boolean().default(true),
  /** Cooldown in hours. Omitted falls back to the cs2f_vote_maps_cooldown cvar. */
  cooldown: z.number().nonnegative().optional(),
});

export const mapEntrySchema = z.object({
  enabled: z.boolean().default(true),
  /** Required for workshop maps. */
  workshop_id: workshopId.optional(),
  /** Custom name shown in the map vote UI. */
  display_name: z.string().max(64).optional(),
  /** Minimum players required to nominate or appear in a vote. */
  min_players: z.number().int().nonnegative().optional(),
  /** Maximum players where the map can be nominated or appear in a vote. */
  max_players: z.number().int().nonnegative().optional(),
  /** Custom cooldown in hours, overriding the default map cooldown. */
  cooldown: z.number().nonnegative().optional(),
  groups: z.array(configGroupName).optional(),
}).refine((entry) => entry.min_players === undefined || entry.max_players === undefined || entry.min_players <= entry.max_players, {
  message: "Minimum players cannot exceed maximum players",
});

export const maplistSchema = z.object({
  Groups: z.record(configGroupName, mapGroupSchema).default({}),
  Maps: z.record(mapName, mapEntrySchema).default({}),
});

export type MapGroup = z.infer<typeof mapGroupSchema>;
export type MapEntry = z.infer<typeof mapEntrySchema>;
export type Maplist = z.infer<typeof maplistSchema>;

export const mapPatchSchema = mapEntrySchema.innerType().partial();
export const mapGroupsSchema = z.record(configGroupName, mapGroupSchema);
export const reloadMapsSchema = z.object({ confirmMapRestart: z.literal(true) });
export const changeCurrentMapSchema = z.object({
  map: mapName.optional(),
  workshopId: workshopIdLike.optional(),
  confirmMapChange: z.literal(true),
}).refine((value) => (value.map === undefined) !== (value.workshopId === undefined), {
  message: "Provide either a map name or a workshop ID",
});

/** Shape returned by GET /api/maps. */
export interface MapsResponse {
  maps: Array<MapEntry & { name: string }>;
  groups: Record<string, MapGroup>;
  currentMap: string | null;
  nextMap: string | null;
  /** True when server-config/ and the live game-tree copy differ. */
  liveOutOfSync: boolean;
}
