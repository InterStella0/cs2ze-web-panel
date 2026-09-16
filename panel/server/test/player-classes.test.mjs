import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse, printParseErrorCode } from "jsonc-parser";
import {
  buildGflPlayerClasses,
  GFL_MODEL_PRESET,
  playerClassesSchema,
} from "../../shared/dist/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultPath = path.resolve(here, "../../../config/cs2fixes/zr/playerclass.jsonc");

test("GFL Both preset contains every random and individually selectable model", () => {
  assert.equal(GFL_MODEL_PRESET.length, 20);
  assert.equal(GFL_MODEL_PRESET.filter((entry) => entry.team === "Human").length, 12);
  assert.equal(GFL_MODEL_PRESET.filter((entry) => entry.team === "Zombie").length, 8);

  const classes = buildGflPlayerClasses("both");
  assert.equal(Object.keys(classes.Human).length, 13);
  assert.equal(Object.keys(classes.Zombie).length, 10);
  assert.equal(classes.Human.RandomHuman.models.length, 12);
  assert.equal(classes.Zombie.RandomZombie.models.length, 8);
  assert.equal(classes.Zombie.MotherZombie.models.length, 8);
  assert.deepEqual(classes.Human.RandomHuman.models.map((model) => model.modelname), GFL_MODEL_PRESET.filter((entry) => entry.team === "Human").map((entry) => entry.modelname));
  assert.deepEqual(classes.Zombie.RandomZombie.models.map((model) => model.modelname), GFL_MODEL_PRESET.filter((entry) => entry.team === "Zombie").map((entry) => entry.modelname));
  assert.deepEqual(classes.Zombie.MotherZombie.models.map((model) => model.modelname), classes.Zombie.RandomZombie.models.map((model) => model.modelname));
  assert.deepEqual(classes.Human.IsaacClarke.models[0].skins, [0, 1, 2, 3, 4]);
  assert.ok(classes.Zombie.MotherZombie.models.every((model) => model.color === "255 100 100"));
  assert.ok(Object.entries(classes.Human).filter(([name]) => name !== "RandomHuman").every(([, entry]) => !entry.team_default && entry.models.length === 1));
  assert.ok(Object.entries(classes.Zombie).filter(([name]) => !["RandomZombie", "MotherZombie"].includes(name)).every(([, entry]) => !entry.team_default && entry.models.length === 1));
  assert.ok(GFL_MODEL_PRESET.every((entry) => entry.modelname.endsWith(".vmdl") && !entry.modelname.endsWith(".vmdl_c")));
});

test("player class validation protects defaults, MotherZombie, colors, and model paths", () => {
  const valid = buildGflPlayerClasses("both");
  assert.equal(playerClassesSchema.safeParse(valid).success, true);

  const noHumanDefault = structuredClone(valid);
  for (const entry of Object.values(noHumanDefault.Human)) entry.team_default = false;
  assert.equal(playerClassesSchema.safeParse(noHumanDefault).success, false);

  const noMother = structuredClone(valid);
  delete noMother.Zombie.MotherZombie;
  assert.equal(playerClassesSchema.safeParse(noMother).success, false);

  const invalidColor = structuredClone(valid);
  invalidColor.Human.RandomHuman.models[0].color = "256 255 255";
  assert.equal(playerClassesSchema.safeParse(invalidColor).success, false);

  const invalidSkin = structuredClone(valid);
  invalidSkin.Human.RandomHuman.models[0].skins = [-1];
  assert.equal(playerClassesSchema.safeParse(invalidSkin).success, false);

  for (const modelname of ["../escape.vmdl", "/absolute/model.vmdl", "agents/model.vmdl_c"]) {
    const unsafe = structuredClone(valid);
    unsafe.Human.RandomHuman.models[0].modelname = modelname;
    assert.equal(playerClassesSchema.safeParse(unsafe).success, false, modelname);
  }
});

test("repository playerclass default is valid and matches the GFL Both preset", async () => {
  const errors = [];
  const value = parse(await fs.readFile(defaultPath, "utf8"), errors, { allowTrailingComma: true });
  assert.deepEqual(errors.map((error) => printParseErrorCode(error.error)), []);
  const checked = playerClassesSchema.safeParse(value);
  assert.equal(checked.success, true, checked.success ? undefined : checked.error.message);
  assert.deepEqual(checked.data, buildGflPlayerClasses("both"));
});
