import net from "node:net";
import { config } from "../config.js";
import { readEnvValue } from "../files/dotenv-edit.js";
import { PacketFramer, PacketType, encodePacket } from "./protocol.js";
import { sanitizeRcon } from "./sanitize.js";

/**
 * Source RCON client for CS2.
 *
 * Details that differ from a textbook Source 1 implementation, all confirmed
 * against a live CS2 server:
 *   - AUTH gets exactly ONE reply packet. Source 1 sends a dummy RESPONSE_VALUE
 *     first; CS2 does not. Waiting for two packets hangs forever.
 *   - Responses are not chunked at 4096 bytes; a single packet can be hundreds of
 *     kilobytes, so framing is driven purely by the length prefix.
 *   - End-of-response is detected with a trailing sentinel packet: the command is
 *     sent as id N, then an empty command as id N+1, and the echo of N+1 marks the
 *     end of N's output. An idle timeout backs this up.
 */

const AUTH_ID = 1;
const IDLE_FALLBACK_MS = 1500;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export class RconError extends Error {
  constructor(message: string, readonly kind: "auth" | "connect" | "timeout" | "protocol" = "protocol") {
    super(message);
    this.name = "RconError";
  }
}

interface Pending {
  id: number;
  sentinelId: number;
  chunks: string[];
  resolve: (value: string) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
  idleTimer: NodeJS.Timeout | null;
  settled: boolean;
}

interface QueuedCommand {
  command: string;
  timeoutMs: number;
  resolve: (value: string) => void;
  reject: (err: Error) => void;
}

export interface RconClientOptions {
  host?: string;
  port?: number;
  getPassword?: () => Promise<string | null>;
}

export class RconClient {
  private socket: net.Socket | null = null;
  private framer = new PacketFramer(MAX_RESPONSE_BYTES);
  private connecting: Promise<void> | null = null;
  private authenticated = false;
  private nextId = 2;
  private pending: Pending | null = null;
  private queue: QueuedCommand[] = [];
  private processing = false;
  private backoffMs = 1000;
  private nextConnectAt = 0;
  private lastError: string | null = null;
  /** Set after an auth rejection so we stop hammering sv_rcon_maxfailures. */
  private authBlockedUntil = 0;

  constructor(private readonly options: RconClientOptions = {}) {}

  get connected(): boolean {
    return this.socket !== null && this.authenticated;
  }

  get error(): string | null {
    return this.lastError;
  }

  private cleanup(err?: Error): void {
    const sock = this.socket;
    this.socket = null;
    this.authenticated = false;
    this.framer.reset();
    if (sock) {
      sock.removeAllListeners();
      sock.destroy();
    }
    if (this.pending && !this.pending.settled) {
      this.pending.settled = true;
      clearTimeout(this.pending.timer);
      if (this.pending.idleTimer) clearTimeout(this.pending.idleTimer);
      this.pending.reject(err ?? new RconError("RCON connection closed", "connect"));
    }
    this.pending = null;
  }

  private async connect(): Promise<void> {
    if (this.connected) return;
    if (this.connecting) return this.connecting;

    if (Date.now() < this.authBlockedUntil) {
      throw new RconError(
        "RCON authentication failed; waiting before retrying to avoid an sv_rcon_maxfailures ban",
        "auth",
      );
    }
    if (Date.now() < this.nextConnectAt) {
      throw new RconError("RCON is reconnecting after a connection failure", "connect");
    }

    this.connecting = (async () => {
      const password = await (this.options.getPassword?.() ?? readEnvValue("CS2_RCONPW"));
      if (!password) {
        throw new RconError("CS2_RCONPW is empty in .env, cannot authenticate", "auth");
      }

      const socket = await new Promise<net.Socket>((resolve, reject) => {
        const host = this.options.host ?? config.rconHost;
        const port = this.options.port ?? config.rconPort;
        const s = net.connect({ host, port });
        const onError = (err: Error): void => {
          s.destroy();
          reject(new RconError(`Cannot reach RCON at ${host}:${port}: ${err.message}`, "connect"));
        };
        s.once("error", onError);
        s.setTimeout(10_000, () => {
          s.destroy();
          reject(new RconError("Timed out connecting to RCON", "connect"));
        });
        s.once("connect", () => {
          s.removeListener("error", onError);
          s.setTimeout(0);
          s.setNoDelay(true);
          resolve(s);
        });
      });

      this.socket = socket;
      socket.on("data", (chunk) => this.onData(chunk));
      socket.on("close", () => this.cleanup());
      socket.on("error", (err) => {
        this.lastError = err.message;
        this.cleanup(err);
      });

      // CS2 replies to AUTH with exactly one packet.
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new RconError("RCON auth timed out", "timeout")), 10_000);
        const onAuth = (chunk: Buffer): void => {
          let packets;
          try {
            packets = this.framer.push(chunk);
          } catch (err) {
            clearTimeout(timer);
            reject(err as Error);
            return;
          }
          for (const pkt of packets) {
            if (pkt.type !== PacketType.AUTH_RESPONSE && pkt.type !== PacketType.RESPONSE_VALUE) continue;
            // Source 1 sends a leading dummy RESPONSE_VALUE with id 0; tolerate it.
            if (pkt.type === PacketType.RESPONSE_VALUE && pkt.id === 0) continue;
            clearTimeout(timer);
            socket.removeListener("data", onAuth);
            if (pkt.id === -1) {
              this.authBlockedUntil = Date.now() + 60_000;
              reject(new RconError("RCON authentication rejected (bad CS2_RCONPW)", "auth"));
            } else {
              this.authenticated = true;
              this.backoffMs = 1000;
              this.nextConnectAt = 0;
              this.lastError = null;
              resolve();
            }
            return;
          }
        };
        socket.prependListener("data", onAuth);
        socket.write(encodePacket(AUTH_ID, PacketType.AUTH, password));
      });
    })();

    try {
      await this.connecting;
    } catch (error) {
      const err = error instanceof Error ? error : new RconError(String(error));
      this.lastError = err.message;
      this.cleanup(err);
      if (!(err instanceof RconError && err.kind === "auth")) {
        this.nextConnectAt = Date.now() + this.backoffMs;
        this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
      }
      throw err;
    } finally {
      this.connecting = null;
    }
  }

  private onData(chunk: Buffer): void {
    if (!this.pending) return;
    let packets;
    try {
      packets = this.framer.push(chunk);
    } catch (err) {
      this.cleanup(err as Error);
      return;
    }

    const pending = this.pending;
    for (const pkt of packets) {
      if (pkt.id === pending.sentinelId) {
        this.settle(pending);
        return;
      }
      if (pkt.id === pending.id) {
        pending.chunks.push(pkt.body);
        const total = pending.chunks.reduce((n, s) => n + s.length, 0);
        if (total > MAX_RESPONSE_BYTES) {
          this.cleanup(new RconError("RCON response exceeded 8 MB", "protocol"));
          return;
        }
      }
    }

    // Idle fallback in case the sentinel echo never arrives.
    if (pending.idleTimer) clearTimeout(pending.idleTimer);
    pending.idleTimer = setTimeout(() => this.settle(pending), IDLE_FALLBACK_MS);
  }

  private settle(pending: Pending): void {
    if (pending.settled) return;
    pending.settled = true;
    clearTimeout(pending.timer);
    if (pending.idleTimer) clearTimeout(pending.idleTimer);
    this.pending = null;
    pending.resolve(sanitizeRcon(pending.chunks.join("")));
  }

  private pump(): void {
    if (this.processing) return;
    const next = this.queue.shift();
    if (!next) return;
    this.processing = true;
    void this.run(next).finally(() => {
      this.processing = false;
      this.pump();
    });
  }

  private async run(task: QueuedCommand): Promise<void> {
    try {
      await this.connect();
      const socket = this.socket;
      if (!socket) throw new RconError("RCON socket unavailable", "connect");

      const id = this.nextId;
      this.nextId += 2;
      const sentinelId = id + 1;

      await new Promise<string>((resolve, reject) => {
        const pending: Pending = {
          id,
          sentinelId,
          chunks: [],
          settled: false,
          idleTimer: null,
          timer: setTimeout(() => {
            if (pending.settled) return;
            const error = new RconError(`RCON command timed out: ${task.command}`, "timeout");
            this.cleanup(error);
          }, task.timeoutMs),
          resolve,
          reject,
        };
        this.pending = pending;
        socket.write(encodePacket(id, PacketType.EXECCOMMAND, task.command));
        socket.write(encodePacket(sentinelId, PacketType.EXECCOMMAND, ""));
      }).then(task.resolve, task.reject);
    } catch (error) {
      task.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Execute a command. Calls are strictly serialized: RCON gives no interleaving
   * guarantees, so a second concurrent command on one socket would mix replies.
   */
  async exec(command: string, timeoutMs = 10_000): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.queue.push({ command, timeoutMs, resolve, reject });
      this.pump();
    });
  }

  /** Best-effort command that resolves to null instead of throwing. */
  async tryExec(command: string, timeoutMs = 10_000): Promise<string | null> {
    try {
      return await this.exec(command, timeoutMs);
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      return null;
    }
  }

  close(): void {
    const error = new RconError("RCON client closed", "connect");
    this.cleanup(error);
    for (const task of this.queue.splice(0)) task.reject(error);
  }
}

export const rcon = new RconClient();
