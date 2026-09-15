import { StringDecoder } from "node:string_decoder";
import type { LogEntry, LogSource } from "@cs2ze/shared";
import { sanitizeLog } from "../rcon/sanitize.js";

const MAX_LINES = 2_000;

export class LogBuffer {
  private readonly decoder = new StringDecoder("utf8");
  private readonly listeners = new Set<(entry: LogEntry) => void>();
  private entries: LogEntry[] = [];
  private partial = "";
  private sequence = 0;

  constructor(readonly source: LogSource) {}

  push(chunk: Buffer | string): void {
    const decoded = typeof chunk === "string" ? chunk : this.decoder.write(chunk);
    const combined = this.partial + decoded;
    const pieces = combined.split(/\r\n|\n|\r/);
    this.partial = pieces.pop() ?? "";
    for (const line of pieces) this.add(sanitizeLog(line));
  }

  flush(): void {
    const decoded = this.decoder.end();
    if (decoded) this.partial += decoded;
    if (this.partial) this.add(sanitizeLog(this.partial));
    this.partial = "";
  }

  marker(message: string): void {
    this.add(message);
  }

  clear(): void {
    this.entries = [];
    this.partial = "";
  }

  snapshot(tail: number): { entries: LogEntry[]; cursor: number } {
    return { entries: this.entries.slice(-tail), cursor: this.sequence };
  }

  subscribeAfter(cursor: number, listener: (entry: LogEntry) => void): () => void {
    for (const entry of this.entries) if (entry.id > cursor) listener(entry);
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get subscriberCount(): number {
    return this.listeners.size;
  }

  private add(line: string): void {
    const entry: LogEntry = {
      id: ++this.sequence,
      source: this.source,
      line,
      receivedAt: new Date().toISOString(),
    };
    this.entries.push(entry);
    if (this.entries.length > MAX_LINES) this.entries.splice(0, this.entries.length - MAX_LINES);
    for (const listener of this.listeners) listener(entry);
  }
}
