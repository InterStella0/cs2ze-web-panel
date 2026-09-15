import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export class DockerError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
    readonly code: number,
  ) {
    super(message);
    this.name = "DockerError";
  }
}

/**
 * Run the docker CLI with an explicit argv array.
 *
 * Never uses a shell and never builds a command string, so no value coming from
 * the panel API can be interpreted as shell syntax.
 */
export async function docker(
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; maxBuffer?: number } = {},
): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await execFileAsync("docker", args, {
      cwd: opts.cwd,
      timeout: opts.timeoutMs ?? 30_000,
      maxBuffer: opts.maxBuffer ?? 16 * 1024 * 1024,
      encoding: "utf8",
    });
    return { stdout, stderr, code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number; message?: string };
    throw new DockerError(
      e.message ?? "docker command failed",
      e.stderr ?? "",
      typeof e.code === "number" ? e.code : 1,
    );
  }
}

export async function dockerInspect<T = unknown>(nameOrId: string): Promise<T | null> {
  try {
    const { stdout } = await docker(["inspect", nameOrId]);
    const parsed = JSON.parse(stdout) as T[];
    return parsed[0] ?? null;
  } catch (err) {
    if (err instanceof DockerError && /No such object/i.test(err.stderr)) return null;
    throw err;
  }
}

export async function dockerAvailable(): Promise<boolean> {
  try {
    await docker(["version", "--format", "{{.Server.Version}}"], { timeoutMs: 10_000 });
    return true;
  } catch {
    return false;
  }
}
