/** Source RCON wire format: int32 size | int32 id | int32 type | body\0 | \0 */

export const PacketType = {
  RESPONSE_VALUE: 0,
  EXECCOMMAND: 2,
  AUTH_RESPONSE: 2,
  AUTH: 3,
} as const;

export interface RconPacket {
  id: number;
  type: number;
  body: string;
}

export function encodePacket(id: number, type: number, body: string): Buffer {
  const payload = Buffer.from(body, "utf8");
  // id + type + body + two terminating NULs
  const size = 4 + 4 + payload.length + 2;
  const buf = Buffer.allocUnsafe(4 + size);
  buf.writeInt32LE(size, 0);
  buf.writeInt32LE(id, 4);
  buf.writeInt32LE(type, 8);
  payload.copy(buf, 12);
  buf.writeUInt8(0, 12 + payload.length);
  buf.writeUInt8(0, 13 + payload.length);
  return buf;
}

/**
 * Incremental framer.
 *
 * Frames purely off the 4-byte length prefix. CS2 does NOT split large responses
 * into 4096-byte chunks the way Source 1 does -- `cvarlist` arrives as a single
 * ~694 KB packet -- so any assumption about a maximum packet size is wrong, and
 * the only backstop is an explicit cap.
 */
export class PacketFramer {
  private buffer: Buffer = Buffer.alloc(0);

  constructor(private readonly maxPacketBytes: number = 8 * 1024 * 1024) {}

  push(chunk: Buffer): RconPacket[] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const out: RconPacket[] = [];

    for (;;) {
      if (this.buffer.length < 4) break;
      const size = this.buffer.readInt32LE(0);
      if (size < 10 || size > this.maxPacketBytes) {
        throw new Error(`RCON packet size out of range: ${size}`);
      }
      if (this.buffer.length < 4 + size) break;

      const id = this.buffer.readInt32LE(4);
      const type = this.buffer.readInt32LE(8);
      // Body runs from offset 12 to the two trailing NULs.
      const body = this.buffer.toString("utf8", 12, 4 + size - 2);
      out.push({ id, type, body });
      this.buffer = this.buffer.subarray(4 + size);
    }
    return out;
  }

  get pending(): number {
    return this.buffer.length;
  }

  reset(): void {
    this.buffer = Buffer.alloc(0);
  }
}
