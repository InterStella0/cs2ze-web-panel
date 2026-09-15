import fs from "node:fs/promises";
import { ENV_SCHEMA_BY_KEY, escapeEnvSlashes, unescapeEnvSlashes } from "@cs2ze/shared";
import { getProject } from "../project.js";
import { safeWrite } from "./safe-write.js";

/**
 * Comment- and order-preserving .env editor.
 *
 * Neither `dotenv` (discards comments) nor `envfile` (reformats) can round-trip
 * this file, and the file is hand-commented documentation as much as it is
 * config. So the representation is simply the raw lines: an edit splices the
 * value out of a single line and leaves every other byte alone.
 */

const ASSIGNMENT = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*=)(.*)$/;

export interface ParsedEnv {
  lines: string[];
  /** key -> index into lines */
  index: Map<string, number>;
}

export function parseEnvText(text: string): ParsedEnv {
  const lines = text.split("\n");
  const index = new Map<string, number>();
  lines.forEach((line, i) => {
    if (line.trimStart().startsWith("#")) return;
    const m = ASSIGNMENT.exec(line);
    // Last assignment wins, matching how a shell / compose would read the file.
    if (m?.[2]) index.set(m[2], i);
  });
  return { lines, index };
}

export function getRawValue(parsed: ParsedEnv, key: string): string | null {
  const i = parsed.index.get(key);
  if (i === undefined) return null;
  const m = ASSIGNMENT.exec(parsed.lines[i] ?? "");
  return m?.[4] ?? null;
}

/**
 * The base image substitutes CS2_* values into its configs with sed, so values
 * containing `/` are stored escaped as `\/` (see README.md). The panel presents
 * and accepts the human form.
 */
function decodeForDisplay(key: string, raw: string): string {
  return ENV_SCHEMA_BY_KEY[key]?.slashEscaped ? unescapeEnvSlashes(raw) : raw;
}

function encodeForFile(key: string, value: string): string {
  return ENV_SCHEMA_BY_KEY[key]?.slashEscaped ? escapeEnvSlashes(value) : value;
}

export function toRecord(parsed: ParsedEnv, { decode = true }: { decode?: boolean } = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, i] of parsed.index) {
    const m = ASSIGNMENT.exec(parsed.lines[i] ?? "");
    const raw = m?.[4] ?? "";
    out[key] = decode ? decodeForDisplay(key, raw) : raw;
  }
  return out;
}

/** Splice a new value into an existing line, or append the key in a footer section. */
export function setValue(parsed: ParsedEnv, key: string, value: string): void {
  const encoded = encodeForFile(key, value);
  const i = parsed.index.get(key);
  if (i !== undefined) {
    const m = ASSIGNMENT.exec(parsed.lines[i] ?? "");
    if (m) {
      parsed.lines[i] = `${m[1]}${m[2]}${m[3]}${encoded}`;
      return;
    }
  }
  const header = "# --- added by the cs2ze panel ---";
  if (!parsed.lines.some((l) => l.trim() === header)) {
    if (parsed.lines.at(-1)?.trim() !== "") parsed.lines.push("");
    parsed.lines.push(header);
  }
  parsed.lines.push(`${key}=${encoded}`);
  parsed.index.set(key, parsed.lines.length - 1);
}

export function serializeEnv(parsed: ParsedEnv): string {
  return parsed.lines.join("\n");
}

export async function readEnvFile(): Promise<{ parsed: ParsedEnv; text: string }> {
  const { envFile } = getProject();
  const text = await fs.readFile(envFile, "utf8");
  return { parsed: parseEnvText(text), text };
}

export async function readEnvRecord(): Promise<Record<string, string>> {
  const { parsed } = await readEnvFile();
  return toRecord(parsed);
}

/** Read a single raw value. Used by the RCON client for CS2_RCONPW on every connect. */
export async function readEnvValue(key: string): Promise<string | null> {
  try {
    const { parsed } = await readEnvFile();
    const raw = getRawValue(parsed, key);
    return raw === null ? null : decodeForDisplay(key, raw);
  } catch {
    return null;
  }
}

/**
 * Atomic write: temp file in the same directory, then rename. This relies on the
 * project DIRECTORY being bind-mounted rather than the individual file -- a
 * single-file bind mount would leave the container pointed at a stale inode.
 */
export async function writeEnvFile(parsed: ParsedEnv): Promise<void> {
  await safeWrite(".env", serializeEnv(parsed));
}
