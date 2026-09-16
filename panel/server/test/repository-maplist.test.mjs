import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse, printParseErrorCode } from "jsonc-parser";
import { maplistSchema } from "../../shared/dist/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const maplistPath = path.resolve(here, "../../../config/cs2fixes/maplist.jsonc");

test("the repository map list is valid JSONC and matches the CS2Fixes schema", async () => {
  const errors = [];
  const value = parse(await fs.readFile(maplistPath, "utf8"), errors, { allowTrailingComma: true });
  assert.deepEqual(errors.map((error) => printParseErrorCode(error.error)), []);

  const checked = maplistSchema.safeParse(value);
  assert.equal(checked.success, true, checked.success ? undefined : checked.error.message);
  assert.ok(Object.keys(checked.data.Maps).length >= 2, "maplist.jsonc must contain at least two maps so the current map has a nomination alternative");
});
