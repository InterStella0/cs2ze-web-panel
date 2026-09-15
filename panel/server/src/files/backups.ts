import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { BackupInfo } from "@cs2ze/shared";
import { backupsDir } from "../config.js";

/** Keep this many backups per file; older ones are pruned on write. */
const RETAIN = 50;

const encodeRel = (rel: string): string => rel.replace(/[/\\]/g, "__");
const decodeRel = (enc: string): string => enc.replace(/__/g, "/");

/** Snapshot a file before overwriting it. Missing files are a no-op. */
export async function backupFile(absPath: string, relPath: string): Promise<BackupInfo | null> {
  let content: Buffer;
  try {
    content = await fs.readFile(absPath);
  } catch {
    return null; // nothing to back up yet
  }

  const sha8 = crypto.createHash("sha256").update(content).digest("hex").slice(0, 8);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(backupsDir, encodeRel(relPath));
  await fs.mkdir(dir, { recursive: true });

  const name = `${stamp}-${sha8}.bak`;
  await fs.writeFile(path.join(dir, name), content);
  await prune(dir);

  return { id: name, path: relPath, createdAt: new Date().toISOString(), size: content.length, sha8 };
}

async function prune(dir: string): Promise<void> {
  const entries = (await fs.readdir(dir)).filter((f) => f.endsWith(".bak")).sort();
  const excess = entries.length - RETAIN;
  for (let i = 0; i < excess; i++) {
    const victim = entries[i];
    if (victim) await fs.rm(path.join(dir, victim), { force: true });
  }
}

export async function listBackups(relPath: string): Promise<BackupInfo[]> {
  const dir = path.join(backupsDir, encodeRel(relPath));
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }

  const out: BackupInfo[] = [];
  for (const name of entries) {
    if (!name.endsWith(".bak")) continue;
    const stat = await fs.stat(path.join(dir, name));
    const sha8 = name.slice(-12, -4);
    out.push({
      id: name,
      path: relPath,
      createdAt: stat.mtime.toISOString(),
      size: stat.size,
      sha8,
    });
  }
  return out.sort((a, b) => b.id.localeCompare(a.id));
}

export async function readBackup(relPath: string, backupId: string): Promise<string> {
  if (backupId.includes("/") || backupId.includes("\\") || !backupId.endsWith(".bak")) {
    throw new Error("Invalid backup id");
  }
  return fs.readFile(path.join(backupsDir, encodeRel(relPath), backupId), "utf8");
}

export async function listAllBackups(): Promise<BackupInfo[]> {
  let dirs: string[];
  try {
    dirs = await fs.readdir(backupsDir);
  } catch {
    return [];
  }
  const out: BackupInfo[] = [];
  for (const d of dirs) out.push(...(await listBackups(decodeRel(d))));
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
