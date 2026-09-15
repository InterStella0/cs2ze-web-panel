import { spawn } from "node:child_process";
import { config } from "../config.js";
import { getProject } from "../project.js";

/**
 * Compose invocation with a closed verb allowlist.
 *
 * Two rules are enforced by assertion rather than convention, because breaking
 * either one destroys the panel mid-request:
 *   - every verb must name an explicit service
 *   - `down` is never allowed (it would remove the panel's own container)
 * A bare `up` is likewise refused, since it would recreate the panel too.
 */

export type ComposeVerb = "start" | "stop" | "restart" | "up" | "pull" | "ps";

const ALLOWED_VERBS: ReadonlySet<string> = new Set<ComposeVerb>(["start", "stop", "restart", "up", "pull", "ps"]);
const FORBIDDEN_VERBS: ReadonlySet<string> = new Set(["down", "rm", "kill", "remove", "create"]);

let lifecycleBusy = false;

export class ComposeBusyError extends Error {
  constructor() {
    super("Another server operation is already running");
    this.name = "ComposeBusyError";
  }
}

function baseArgs(): string[] {
  const project = getProject();
  const args = ["compose", "--project-name", project.projectName, "--project-directory", project.workingDir];
  for (const file of project.configFiles) args.push("-f", file);
  return args;
}

function displayArg(value: string): string {
  return /^[A-Za-z0-9_./:=@+-]+$/.test(value) ? value : JSON.stringify(value);
}

function assertSafe(verb: string, service: string | null): void {
  if (FORBIDDEN_VERBS.has(verb)) {
    throw new Error(`compose ${verb} is not permitted: it would remove the panel's own container`);
  }
  if (!ALLOWED_VERBS.has(verb)) {
    throw new Error(`compose verb not allowed: ${verb}`);
  }
  if (verb !== "ps" && !service) {
    throw new Error(`compose ${verb} requires an explicit service name`);
  }
  if (service && service !== config.cs2ServiceName) {
    throw new Error(`compose may only target the ${config.cs2ServiceName} service, got: ${service}`);
  }
}

export interface ComposeRunOptions {
  onOutput?: (chunk: string) => void;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ComposeRunResult {
  code: number;
  output: string;
  command: string;
}

/** Run a compose verb, streaming combined output to the callback. */
export function runCompose(
  verb: ComposeVerb,
  extraArgs: string[],
  service: string | null,
  opts: ComposeRunOptions = {},
): Promise<ComposeRunResult> {
  assertSafe(verb, service);

  const args = [...baseArgs(), verb, ...extraArgs];
  if (service) args.push(service);
  const command = `docker ${args.join(" ")}`;
  const project = getProject();

  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      cwd: project.workingDir,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    const cap = 4 * 1024 * 1024;
    const append = (chunk: Buffer): void => {
      const text = chunk.toString("utf8");
      if (output.length < cap) output += text;
      opts.onOutput?.(text);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
    }, opts.timeoutMs ?? 15 * 60_000);

    opts.signal?.addEventListener("abort", () => child.kill("SIGTERM"), { once: true });

    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ code: code ?? -1, output, command });
    });
  });
}

/** Serialize lifecycle operations: one at a time, process-wide. */
export async function withLifecycleLock<T>(fn: () => Promise<T>): Promise<T> {
  if (lifecycleBusy) throw new ComposeBusyError();
  lifecycleBusy = true;
  try {
    return await fn();
  } finally {
    lifecycleBusy = false;
  }
}

export function isLifecycleBusy(): boolean {
  return lifecycleBusy;
}

export const composeOps = {
  start: (o?: ComposeRunOptions) => runCompose("start", [], config.cs2ServiceName, o),
  stop: (o?: ComposeRunOptions) => runCompose("stop", [], config.cs2ServiceName, o),
  restart: (o?: ComposeRunOptions) => runCompose("restart", [], config.cs2ServiceName, o),
  /**
   * Re-reads .env and recreates the container, so env changes take effect.
   * Dependencies are intentionally NOT skipped: prepare-data must run first,
   * exactly as it does in the documented `docker compose up -d` flow.
   */
  apply: (o?: ComposeRunOptions) =>
    runCompose("up", ["-d", "--force-recreate"], config.cs2ServiceName, o),
  pull: (o?: ComposeRunOptions) => runCompose("pull", [], config.cs2ServiceName, o),
};

export function describeComposeOperation(kind: keyof typeof composeOps): string {
  const extras: Partial<Record<keyof typeof composeOps, string[]>> = {
    apply: ["-d", "--force-recreate"],
  };
  const verb = kind === "apply" ? "up" : kind;
  const args = [...baseArgs(), verb, ...(extras[kind] ?? []), config.cs2ServiceName];
  return ["docker", ...args].map(displayArg).join(" ");
}
