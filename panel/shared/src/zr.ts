import { z } from "zod";

/** Schema and presets for server-config/cs2fixes/zr/playerclass.jsonc. */

export const zrClassNameSchema = z.string().min(1).max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "Class names may contain letters, digits, underscores, and hyphens only");

export const zrModelPathSchema = z.string().min(1).max(240)
  .regex(/^[A-Za-z0-9_./-]+\.vmdl$/, "Model path must be a relative .vmdl resource path")
  .refine((value) => !value.startsWith("/") && !value.split("/").includes(".."), "Model path must not escape the game resource root")
  .refine((value) => !value.endsWith(".vmdl_c"), "Use the .vmdl resource path, not the compiled .vmdl_c filename");

const zrColorSchema = z.string().regex(/^\d{1,3} \d{1,3} \d{1,3}$/, 'Color must be "R G B"')
  .refine((value) => value.split(" ").every((part) => Number(part) <= 255), "Color components must be between 0 and 255");

export const zrModelSchema = z.object({
  modelname: zrModelPathSchema,
  /** "R G B", 0-255 each. */
  color: zrColorSchema,
  skins: z.array(z.number().finite().int().nonnegative()).min(1).default([0]),
}).strict();

export const zrClassSchema = z.object({
  enabled: z.boolean().default(true),
  team_default: z.boolean().default(false),
  health: z.number().finite().int().positive(),
  models: z.array(zrModelSchema).min(1),
  scale: z.number().finite().positive().default(1),
  speed: z.number().finite().positive().default(1),
  gravity: z.number().finite().positive().default(1),
  knockback: z.number().finite().nonnegative().optional(),
  admin_flag: z.string().max(26).regex(/^[a-z]*$/, "Admin flags may contain lowercase letters only").default(""),
  health_regen_count: z.number().finite().int().nonnegative().optional(),
  health_regen_interval: z.number().finite().nonnegative().optional(),
}).strict();

const zrTeamSchema = z.record(zrClassNameSchema, zrClassSchema);

export const playerClassesSchema = z.object({
  Human: zrTeamSchema,
  Zombie: zrTeamSchema,
}).strict().superRefine((classes, context) => {
  for (const team of ["Human", "Zombie"] as const) {
    if (!Object.values(classes[team]).some((entry) => entry.enabled && entry.team_default)) {
      context.addIssue({ code: "custom", path: [team], message: `${team} must have at least one enabled default class` });
    }
  }
  if (!classes.Zombie.MotherZombie?.enabled) {
    context.addIssue({ code: "custom", path: ["Zombie", "MotherZombie"], message: "Zombie must contain an enabled MotherZombie class" });
  }
});

export type ZrModel = z.infer<typeof zrModelSchema>;
export type ZrClass = z.infer<typeof zrClassSchema>;
export type PlayerClasses = z.infer<typeof playerClassesSchema>;
export type GflPresetMode = "random" | "individual" | "both";

export interface GflModelPreset {
  id: string;
  label: string;
  team: "Human" | "Zombie";
  modelname: string;
  skins: number[];
}

export const GFL_MODEL_PRESET: readonly GflModelPreset[] = [
  { id: "Mapper", label: "Mapper", team: "Human", modelname: "characters/models/kaesar/mapper/mapper_nohitbox.vmdl", skins: [0] },
  { id: "TeslaArmor", label: "Tesla Armor", team: "Human", modelname: "agents/models/s2ze/tesla_armor/tesla_armor_nohitbox.vmdl", skins: [0] },
  { id: "Scavenger", label: "Scavenger", team: "Human", modelname: "agents/models/s2ze/scavenger/scavenger_nohitbox.vmdl", skins: [0] },
  { id: "MasterChief", label: "Master Chief", team: "Human", modelname: "agents/models/s2ze/master_chief/master_chief_nohitbox.vmdl", skins: [0] },
  { id: "IsaacClarke", label: "Isaac Clarke", team: "Human", modelname: "agents/models/s2ze/isaac_clarke/isaac_clarke_nohitbox.vmdl", skins: [0, 1, 2, 3, 4] },
  { id: "Helldiver", label: "Helldiver B-01", team: "Human", modelname: "agents/models/s2ze/hd2_b01_tac/hd2_b01_tac_nohitbox.vmdl", skins: [0] },
  { id: "EarthGovSoldier", label: "EarthGov Soldier", team: "Human", modelname: "agents/models/s2ze/earthgovsol/deadspace_earthgovsol_hitbox.vmdl", skins: [0] },
  { id: "Ujel", label: "Ujel", team: "Human", modelname: "agents/models/longus/ujel/ujel_nohitbox.vmdl", skins: [0] },
  { id: "LeftShark", label: "Left Shark", team: "Human", modelname: "agents/models/gxp/left_shark/left_shark_nohitbox.vmdl", skins: [0] },
  { id: "TifaLockhart", label: "Tifa Lockhart", team: "Human", modelname: "agents/models/gxp/final_fantasy/tifa_lockhart/tifa_lockhart_nohitbox.vmdl", skins: [0] },
  { id: "TifaBahamut", label: "Tifa Bahamut", team: "Human", modelname: "agents/models/gxp/final_fantasy/tifa_lockhart/tifa_lockhart_bahamut_nohitbox.vmdl", skins: [0] },
  { id: "Vector", label: "Vector", team: "Human", modelname: "agents/models/apple/vector/vector.vmdl", skins: [0] },
  { id: "FrozenZombie", label: "Frozen Zombie", team: "Zombie", modelname: "agents/models/s2ze/zombie_frozen/zombie_frozen.vmdl", skins: [0] },
  { id: "CultistZombie", label: "Cultist Zombie", team: "Zombie", modelname: "agents/models/s2ze/zombie_cultist/zombie_cultist.vmdl", skins: [0] },
  { id: "ChrisWalker", label: "Chris Walker", team: "Zombie", modelname: "agents/models/s2ze/zombie_chris_walker/zombie_chris_walker.vmdl", skins: [0] },
  { id: "BasicZombie", label: "Basic Zombie", team: "Zombie", modelname: "agents/models/s2ze/zombie_basic/zombie_basic.vmdl", skins: [0] },
  { id: "BloodySkeleton", label: "Bloody Skeleton", team: "Zombie", modelname: "agents/models/gxp/skeleton_bloody_lp/skeleton_bloody_lp.vmdl", skins: [0] },
  { id: "GhoulSoldier", label: "Ghoul Soldier", team: "Zombie", modelname: "agents/models/gxp/ghoul_soldier/ghoul_soldier.vmdl", skins: [0] },
  { id: "Marauder", label: "Marauder", team: "Zombie", modelname: "agents/models/gxp/doom/marauder/marauder.vmdl", skins: [0] },
  { id: "ClassicZombie", label: "Classic Zombie", team: "Zombie", modelname: "agents/models/gxp/classic_zombie/classic_zombie.vmdl", skins: [0] },
] as const;

function model(entry: GflModelPreset, color = "255 255 255"): ZrModel {
  return { modelname: entry.modelname, color, skins: [...entry.skins] };
}

function humanClass(models: ZrModel[], teamDefault: boolean): ZrClass {
  return { enabled: true, team_default: teamDefault, health: 100, models, scale: 1, speed: 1, gravity: 1, admin_flag: "" };
}

function zombieClass(models: ZrModel[], teamDefault: boolean, mother = false): ZrClass {
  return {
    enabled: true,
    team_default: teamDefault,
    health: mother ? 40000 : 10000,
    models,
    scale: 1,
    speed: 1,
    gravity: 1,
    knockback: 1,
    admin_flag: "",
    health_regen_count: mother ? 500 : 250,
    health_regen_interval: 5,
  };
}

/** Generate a complete, flat CS2Fixes class config from the bundled GFL pack. */
export function buildGflPlayerClasses(mode: GflPresetMode = "both"): PlayerClasses {
  const humans = GFL_MODEL_PRESET.filter((entry) => entry.team === "Human");
  const zombies = GFL_MODEL_PRESET.filter((entry) => entry.team === "Zombie");
  const Human: Record<string, ZrClass> = {};
  const Zombie: Record<string, ZrClass> = {};

  if (mode !== "individual") {
    Human.RandomHuman = humanClass(humans.map((entry) => model(entry)), true);
    Zombie.RandomZombie = zombieClass(zombies.map((entry) => model(entry)), true);
  }
  if (mode !== "random") {
    humans.forEach((entry, index) => { Human[entry.id] = humanClass([model(entry)], mode === "individual" && index === 0); });
    zombies.forEach((entry, index) => { Zombie[entry.id] = zombieClass([model(entry)], mode === "individual" && index === 0); });
  }
  Zombie.MotherZombie = zombieClass(zombies.map((entry) => model(entry, "255 100 100")), false, true);
  return playerClassesSchema.parse({ Human, Zombie });
}

export const updatePlayerClassesSchema = z.object({ classes: playerClassesSchema }).strict();

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
