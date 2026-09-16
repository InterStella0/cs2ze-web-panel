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
});
