import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const installerPath = path.resolve(here, "../../../scripts/install-mods.sh");

test("installer uses current CS2 warmup controls", async () => {
  const installer = await fs.readFile(installerPath, "utf8");

  assert.doesNotMatch(installer, /printf 'mp_do_warmup_period|set_gamemode_cvar mp_do_warmup_period/);
  assert.doesNotMatch(installer, /printf 'mp_warmuptime 0|set_gamemode_cvar mp_warmuptime 0/);
  assert.match(installer, /printf 'mp_warmup_offline_enabled 0/);
  assert.match(installer, /printf 'mp_warmup_online_enabled 0/);
  assert.match(installer, /printf 'mp_warmup_end/);
  assert.match(installer, /append_gamemode_command mp_warmup_end/);
  assert.match(installer, /ensure_trailing_newline "\$file"/);
  assert.match(installer, /-e "s\/\$\{setting\}/);
  assert.match(installer, /sv_falldamage_scale %s.*ZE_FALL_DAMAGE_SCALE:-0/);
  assert.match(installer, /mp_buytime %s.*ZE_BUY_TIME:-9999999/);
  assert.match(installer, /mp_buy_anywhere %s.*ZE_BUY_ANYWHERE:-1/);
  assert.match(installer, /mp_weapons_allow_typecount %s.*ZE_WEAPON_BUY_LIMIT:--1/);
  assert.match(installer, /ammo_grenade_limit_default %s.*ZE_GRENADE_BUY_LIMIT:-2/);
});

test("installer persists the configured bot convars instead of disabling bots", async () => {
  const installer = await fs.readFile(installerPath, "utf8");

  assert.match(installer, /printf 'bot_quota %s\\n' "\$\{CS2_BOT_QUOTA:-0\}"/);
  assert.match(installer, /printf 'bot_quota_mode %s\\n' "\$\{CS2_BOT_QUOTA_MODE:-fill\}"/);
  assert.match(installer, /printf 'bot_difficulty %s\\n' "\$CS2_BOT_DIFFICULTY"/);
  assert.doesNotMatch(installer, /printf 'bot_quota 0\\n'/);
});
