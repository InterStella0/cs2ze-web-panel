import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import type { LogEntry } from "@cs2ze/shared";
import { config } from "../config.js";
import { LogBuffer } from "./buffer.js";

const buffer = new LogBuffer("docker");
let child: ChildProcessByStdio<null, Readable, Readable> | null = null;
let restartTimer: NodeJS.Timeout | null = null;
let expectedStop = false;

function start(): void {
  if (child) return;
  expectedStop = false;
  buffer.clear();
  const process = spawn("docker", ["logs", "--follow", "--tail", "2000", config.cs2ContainerName], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  child = process;
  process.stdout.on("data", (chunk: Buffer) => buffer.push(chunk));
  process.stderr.on("data", (chunk: Buffer) => buffer.push(chunk));
  process.on("error", (error) => buffer.marker(`[panel] Docker log stream failed: ${error.message}`));
  process.on("close", (code, signal) => {
    if (child === process) child = null;
    buffer.flush();
    if (expectedStop || buffer.subscriberCount === 0) return;
    buffer.marker(`[panel] Docker log stream closed (${signal ?? `exit ${code ?? "unknown"}`}); reconnecting…`);
    restartTimer = setTimeout(start, 1_000);
  });
}

function stop(): void {
  expectedStop = true;
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = null;
  const process = child;
  child = null;
  if (process) {
    process.stdout.removeAllListeners();
    process.stderr.removeAllListeners();
    process.removeAllListeners();
    process.kill("SIGTERM");
    buffer.flush();
  }
}

export function openDockerLogStream(tail: number, listener: (entry: LogEntry) => void): () => void {
  start();
  const { entries, cursor } = buffer.snapshot(tail);
  for (const entry of entries) listener(entry);
  const unsubscribe = buffer.subscribeAfter(cursor, listener);
  return () => {
    unsubscribe();
    if (buffer.subscriberCount === 0) stop();
  };
}

export function closeDockerLogStream(): void {
  stop();
}
