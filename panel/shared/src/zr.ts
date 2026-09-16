import { z } from "zod";

/** Schema for server-config/cs2fixes/zr/playerclass.jsonc. */

export const zrModelSchema = z.object({
  modelname: z.string().min(1),
  /** "R G B", 0-255 each. */
  color: z.string().regex(/^\d{1,3} \d{1,3} \d{1,3}$/, 'Color must be "R G B"'),
  skins: z.array(z.number().int().nonnegative()).default([0]),
});

export const zrClassSchema = z.object({
  enabled: z.boolean().default(true),
  team_default: z.boolean().default(false),
  health: z.number().int().positive(),
  models: z.array(zrModelSchema).min(1),
  scale: z.number().positive().default(1),
  speed: z.number().positive().default(1),
  gravity: z.number().positive().default(1),
  knockback: z.number().nonnegative().optional(),
  admin_flag: z.string().default(""),
  health_regen_count: z.number().int().nonnegative().optional(),
  health_regen_interval: z.number().nonnegative().optional(),
});

/** Top level is team -> class name -> class. */
export const playerClassesSchema = z.record(z.string(), z.record(z.string(), zrClassSchema));

export type ZrModel = z.infer<typeof zrModelSchema>;
export type ZrClass = z.infer<typeof zrClassSchema>;
export type PlayerClasses = z.infer<typeof playerClassesSchema>;

/** weapons.cfg / hitgroups.cfg are Valve KeyValues, modelled loosely. */
export const weaponEntrySchema = z.object({
  enabled: z.boolean().optional(),
  knockback: z.number().nonnegative().optional(),
});
export type WeaponEntry = z.infer<typeof weaponEntrySchema>;

export const hitgroupEntrySchema = z.object({
  knockback: z.number().nonnegative().optional(),
});
export type HitgroupEntry = z.infer<typeof hitgroupEntrySchema>;
