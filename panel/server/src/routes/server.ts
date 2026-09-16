import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Job, JobKind, ServerState, ServerStatus } from "@cs2ze/shared";
import { requireAuth } from "../auth/routes.js";
import { config } from "../config.js";
import { ComposeBusyError } from "../docker/compose.js";
import { docker, dockerInspect } from "../docker/cli.js";
import { getJob, getJobs, onJobUpdate, startLifecycleJob } from "../docker/jobs.js";
import { parseSetupProgress } from "../docker/setup-progress.js";
import { getSetupError } from "../project.js";
import { getRconStatus } from "../rcon/status.js";
import { assertEnvCanBoot } from "./env.js";

interface ContainerInspect {
  Config?: { Image?: string };
  State?: {
    Status?: string;
    Running?: boolean;
    Paused?: boolean;
    Restarting?: boolean;
    Dead?: boolean;
    StartedAt?: string;
    Health?: { Status?: string };
  };
}

const states = new Set<ServerState>(["created", "running", "paused", "restarting", "removing", "exited", "dead"]);

function setupGuard(reply: FastifyReply): boolean {
  const setupError = getSetupError();
  if (!setupError) return true;
  void reply.code(503).send({ error: setupError.message, setupError });
  return false;
}

function normalizeState(inspect: ContainerInspect): ServerState {
  if (inspect.State?.Paused) return "paused";
  if (inspect.State?.Restarting) return "restarting";
  if (inspect.State?.Dead) return "dead";
  const value = inspect.State?.Status;
  return value && states.has(value as ServerState) ? value as ServerState : "created";
}

function validStartedAt(value: string | undefined): string | null {
  if (!value || value.startsWith("0001-")) return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

async function serverStatus(): Promise<ServerStatus> {
  const inspect = await dockerInspect<ContainerInspect>(config.cs2ContainerName);
  if (!inspect) {
    return {
      state: "absent", status: "Container has not been created", health: null,
      startedAt: null, uptimeSeconds: null, image: "", rcon: { connected: false, error: null },
      game: null, plugins: [], diskUsageBytes: null,
      setupProgress: null,
    };
  }
  const state = normalizeState(inspect);
  const startedAt = validStartedAt(inspect.State?.StartedAt);
  const uptimeSeconds = startedAt && ["running", "paused", "restarting"].includes(state)
    ? Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 1000))
    : null;
  const live = state === "running" ? await getRconStatus() : null;
  let setupProgress: ServerStatus["setupProgress"] = null;
  if (state === "running" && !live?.connected) {
    try {
      const logs = await docker(["logs", "--timestamps", "--tail", "2000", config.cs2ContainerName], {
        timeoutMs: 5_000,
        maxBuffer: 4 * 1024 * 1024,
      });
      setupProgress = parseSetupProgress(`${logs.stdout}\n${logs.stderr}`);
    } catch {
      // Status remains useful when Docker cannot provide a log tail.
    }
  }
  return {
    state,
    status: inspect.State?.Status ?? state,
    health: inspect.State?.Health?.Status ?? null,
    startedAt,
    uptimeSeconds,
    image: inspect.Config?.Image ?? "",
    rcon: { connected: live?.connected ?? false, error: live?.error ?? null },
    game: live?.game ?? null,
    plugins: live?.plugins ?? [],
    diskUsageBytes: null,
    setupProgress,
  };
}

function writeEvent(reply: FastifyReply, event: string, job: Job): void {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(job)}\n\n`);
}

function streamJob(request: FastifyRequest, reply: FastifyReply, initial: Job): void {
  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  reply.raw.write("retry: 2000\n\n");
  writeEvent(reply, "job", initial);

  if (initial.state !== "running") {
    reply.raw.end();
    return;
  }

  let remove = (): void => undefined;
  const keepAlive = setInterval(() => {
    if (!reply.raw.destroyed) reply.raw.write(": keepalive\n\n");
  }, 20_000);
  const cleanup = (): void => {
    clearInterval(keepAlive);
    remove();
  };
  const receive = (job: Job): void => {
    if (reply.raw.destroyed) return;
    writeEvent(reply, "job", job);
    if (job.state !== "running") {
      cleanup();
      reply.raw.end();
    }
  };
  remove = onJobUpdate(initial.id, receive);
  request.raw.once("close", cleanup);

  // Close the lookup-to-subscribe race: if the child finished between the
  // route's first SELECT and listener registration, SQLite has the truth.
  const latest = getJob(initial.id);
  if (latest && (latest.state !== initial.state || latest.output !== initial.output)) receive(latest);
}

export async function registerServerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/server/status", async (request, reply) => {
    if (!requireAuth(request, reply) || !setupGuard(reply)) return;
    return serverStatus();
  });

  app.get("/api/jobs", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    return getJobs();
  });

  app.get<{ Params: { id: string } }>("/api/jobs/:id", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const job = getJob(request.params.id);
    return job ?? reply.code(404).send({ error: "Job not found" });
  });

  app.get<{ Params: { id: string } }>("/api/jobs/:id/stream", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const job = getJob(request.params.id);
    if (!job) return reply.code(404).send({ error: "Job not found" });
    streamJob(request, reply, job);
  });

  const kinds: JobKind[] = ["start", "stop", "restart", "apply", "pull"];
  for (const kind of kinds) {
    app.post(`/api/server/${kind}`, async (request, reply) => {
      const auth = requireAuth(request, reply);
      if (!auth || !setupGuard(reply)) return;
      if (auth.user.mustChangePassword) {
        return reply.code(403).send({ error: "Change the bootstrap password before controlling the server" });
      }
      if (kind === "apply") await assertEnvCanBoot();
      try {
        const job = startLifecycleJob(kind, auth.user);
        return reply.code(202).send({ jobId: job.id });
      } catch (error) {
        if (error instanceof ComposeBusyError) {
          return reply.code(409).send({ error: error.message });
        }
        throw error;
      }
    });
  }
}
