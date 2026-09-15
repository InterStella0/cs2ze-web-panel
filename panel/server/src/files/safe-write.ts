import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { getProject } from "../project.js";
import { backupFile } from "./backups.js";

/**
 * Every panel write funnels through here.
 *
 * The rw mount covers the whole project directory, so the allowlist -- not the
 * mount -- is what keeps the panel from editing compose.yaml or install-mods.sh.
 * Paths are resolved through realpath first so a symlink cannot be used to
 * escape, and a backup is always taken before the content is replaced.
 */

/** Files the panel is allowed to write, relative to the project directory. */
const WRITABLE_PREFIXES = ["config/"];
const WRITABLE_EXACT = [".env"];

export class ForbiddenPathError extends Error {
  constructor(relPath: string) {
    super(`The panel is not allowed to write ${relPath}`);
    this.name = "ForbiddenPathError";
  }
}

export function isWritableRelPath(relPath: string): boolean {
  const normalized = path.normalize(relPath).replace(/^\.\//, "");
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) return false;
  if (WRITABLE_EXACT.includes(normalized)) return true;
  return WRITABLE_PREFIXES.some((p) => normalized.startsWith(p));
}

/** Resolve a project-relative path, refusing anything outside the allowlist. */
export async function resolveWritable(relPath: string): Promise<{ abs: string; rel: string }> {
  const normalized = path.normalize(relPath).replace(/^\.\//, "");
  if (!isWritableRelPath(normalized)) throw new ForbiddenPathError(relPath);

  const { workingDir } = getProject();
  const abs = path.resolve(workingDir, normalized);
  if (abs !== workingDir && !abs.startsWith(workingDir + path.sep)) {
    throw new ForbiddenPathError(relPath);
  }

  // Follow symlinks on the parent directory: a link inside config/ must not be
  // usable to write outside the project.
  const parent = path.dirname(abs);
  try {
    const realParent = await fs.realpath(parent);
    if (realParent !== workingDir && !realParent.startsWith(workingDir + path.sep)) {
      throw new ForbiddenPathError(relPath);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  return { abs, rel: normalized };
}

/** Back up, then replace atomically. */
export async function safeWrite(relPath: string, content: string): Promise<{ abs: string; rel: string }> {
  const { abs, rel } = await resolveWritable(relPath);
  await backupFile(abs, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });

  const tmp = `${abs}.panel-${process.pid}-${Date.now()}.tmp`;
  await fs.writeFile(tmp, content, "utf8");
  try {
    await fs.rename(tmp, abs);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
  return { abs, rel };
}

export async function safeDelete(relPath: string): Promise<void> {
  const { abs, rel } = await resolveWritable(relPath);
  await backupFile(abs, rel);
  await fs.rm(abs, { force: true });
}

export async function readProjectFile(relPath: string): Promise<string> {
  const { workingDir } = getProject();
  const normalized = path.normalize(relPath).replace(/^\.\//, "");
  const abs = path.resolve(workingDir, normalized);
  if (abs !== workingDir && !abs.startsWith(workingDir + path.sep)) throw new ForbiddenPathError(relPath);
  return fs.readFile(abs, "utf8");
}

/**
 * Read the copy that install-mods.sh synced into the game tree. cs2-data is
 * mounted read-only, so this is strictly for comparison and diffing.
 */
export async function readLiveFile(liveRelPath: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(config.cs2DataDir, liveRelPath), "utf8");
  } catch {
    return null;
  }
}
