import fsSync, { type FSWatcher } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { LogEntry, LogFileInfo, LogFileResponse } from "@cs2ze/shared";
import { config } from "../config.js";
import { sanitizeLog } from "../rcon/sanitize.js";
import { LogBuffer } from "./buffer.js";

const LOG_DIR = path.join(config.cs2DataDir, "game", "csgo", "logs");
const MAX_READ_BYTES = 4 * 1024 * 1024;
const buffer = new LogBuffer("game");
let activePath: string | null = null;
let activeSize = 0;
let watcher: FSWatcher | null = null;
let poller: NodeJS.Timeout | null = null;
let starting: Promise<void> | null = null;
let refreshing = false;

async function discoveredFiles(): Promise<Array<{ name: string; path: string; size: number; mtimeMs: number }>> {
  let names: string[];
  try {
    names = await fs.readdir(LOG_DIR);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const rows = await Promise.all(names.filter((name) => name.endsWith(".log")).map(async (name) => {
    const filePath = path.join(LOG_DIR, name);
    const stat = await fs.stat(filePath);
    return { name, path: filePath, size: stat.size, mtimeMs: stat.mtimeMs };
  }));
  return rows.filter((row) => row.size >= 0).sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));
}

async function readRange(filePath: string, start: number, end: number): Promise<Buffer> {
  if (end <= start) return Buffer.alloc(0);
  const handle = await fs.open(filePath, "r");
  try {
    const output = Buffer.allocUnsafe(end - start);
    const { bytesRead } = await handle.read(output, 0, output.length, start);
    return output.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function refresh(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    const latest = (await discoveredFiles())[0] ?? null;
    if (!latest) return;
    if (latest.path !== activePath || latest.size < activeSize) {
      buffer.flush();
      activePath = latest.path;
      const start = Math.max(0, latest.size - MAX_READ_BYTES);
      if (start > 0) buffer.marker("[panel] Earlier game log content omitted (4 MB stream cap).");
      buffer.push(await readRange(latest.path, start, latest.size));
      activeSize = latest.size;
      return;
    }
    if (latest.size === activeSize) return;
    let start = activeSize;
    if (latest.size - start > MAX_READ_BYTES) {
      start = latest.size - MAX_READ_BYTES;
      buffer.marker("[panel] Game log advanced by more than 4 MB; intermediate content omitted.");
    }
    buffer.push(await readRange(latest.path, start, latest.size));
    activeSize = latest.size;
  } catch (error) {
    buffer.marker(`[panel] Cannot read game logs: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    refreshing = false;
  }
}

async function start(): Promise<void> {
  if (starting) return starting;
  starting = (async () => {
    buffer.clear();
    activePath = null;
    activeSize = 0;
    await refresh();
    try {
      watcher = fsSync.watch(LOG_DIR, () => void refresh());
      watcher.on("error", (error) => buffer.marker(`[panel] Game log watcher error: ${error.message}`));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    poller = setInterval(() => void refresh(), 1_000);
  })();
  try {
    await starting;
  } finally {
    starting = null;
  }
}

function stop(): void {
  watcher?.close();
  watcher = null;
  if (poller) clearInterval(poller);
  poller = null;
  activePath = null;
  activeSize = 0;
  buffer.flush();
}

export async function openGameLogStream(tail: number, listener: (entry: LogEntry) => void): Promise<() => void> {
  if (!watcher && !poller) await start();
  const { entries, cursor } = buffer.snapshot(tail);
  for (const entry of entries) listener(entry);
  const unsubscribe = buffer.subscribeAfter(cursor, listener);
  return () => {
    unsubscribe();
    if (buffer.subscriberCount === 0) stop();
  };
}

export async function listGameLogFiles(): Promise<LogFileInfo[]> {
  const files = await discoveredFiles();
  const active = files[0]?.name ?? null;
  return files.map((file) => ({
    name: file.name,
    size: file.size,
    modifiedAt: new Date(file.mtimeMs).toISOString(),
    active: file.name === active,
  }));
}

export async function readGameLogFile(name: string): Promise<LogFileResponse | null> {
  if (path.basename(name) !== name || !/^[A-Za-z0-9_.-]+\.log$/.test(name)) return null;
  const filePath = path.join(LOG_DIR, name);
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const start = Math.max(0, stat.size - MAX_READ_BYTES);
  const content = sanitizeLog((await readRange(filePath, start, stat.size)).toString("utf8"));
  return { name, content, truncated: start > 0 };
}

export function closeGameLogStream(): void {
  stop();
}
