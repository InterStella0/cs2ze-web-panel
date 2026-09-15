import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { LogEntry, LogSource } from "@cs2ze/shared";
import { requireAuth } from "../auth/routes.js";
import { openDockerLogStream } from "../logs/docker-stream.js";
import { listGameLogFiles, openGameLogStream, readGameLogFile } from "../logs/game-files.js";
import { getSetupError } from "../project.js";

const MAX_STREAMS_PER_SESSION = 5;
const sessionStreams = new Map<string, number>();

function acquireStream(session: string): boolean {
  const count = sessionStreams.get(session) ?? 0;
  if (count >= MAX_STREAMS_PER_SESSION) return false;
  sessionStreams.set(session, count + 1);
  return true;
}

function releaseStream(session: string): void {
  const count = sessionStreams.get(session) ?? 0;
  if (count <= 1) sessionStreams.delete(session);
  else sessionStreams.set(session, count - 1);
}

function writeLog(reply: FastifyReply, entry: LogEntry): void {
  reply.raw.write(`id: ${entry.id}\nevent: log\ndata: ${JSON.stringify(entry)}\n\n`);
}

async function streamLogs(
  request: FastifyRequest,
  reply: FastifyReply,
  source: LogSource,
  tail: number,
  session: string,
): Promise<void> {
  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  reply.raw.write(`retry: 2000\nevent: ready\ndata: ${JSON.stringify({ source })}\n\n`);

  let closed = false;
  let unsubscribe = (): void => undefined;
  const keepAlive = setInterval(() => {
    if (!reply.raw.destroyed) reply.raw.write(": keepalive\n\n");
  }, 20_000);
  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    clearInterval(keepAlive);
    unsubscribe();
    releaseStream(session);
  };
  request.raw.once("close", cleanup);

  const receive = (entry: LogEntry): void => {
    if (!closed && !reply.raw.destroyed) writeLog(reply, entry);
  };
  try {
    const opened = source === "docker"
      ? openDockerLogStream(tail, receive)
      : await openGameLogStream(tail, receive);
    if (closed) opened();
    else unsubscribe = opened;
  } catch (error) {
    reply.raw.write(`event: stream-error\ndata: ${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n\n`);
    cleanup();
    reply.raw.end();
  }
}

export async function registerLogRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { source?: string; tail?: string } }>("/api/logs/stream", async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) return;
    if (getSetupError()) return reply.code(503).send({ error: "Panel setup preflight has not passed" });
    const source = request.query.source ?? "docker";
    if (source !== "docker" && source !== "game") return reply.code(400).send({ error: "source must be docker or game" });
    const requestedTail = Number(request.query.tail ?? 500);
    const tail = Number.isFinite(requestedTail) ? Math.max(0, Math.min(2_000, Math.trunc(requestedTail))) : 500;
    if (!acquireStream(auth.rawToken)) {
      return reply.code(429).send({ error: `A session may open at most ${MAX_STREAMS_PER_SESSION} log streams` });
    }
    await streamLogs(request, reply, source, tail, auth.rawToken);
  });

  app.get("/api/logs/files", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    return listGameLogFiles();
  });

  app.get<{ Params: { name: string } }>("/api/logs/files/:name", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const file = await readGameLogFile(request.params.name);
    return file ?? reply.code(404).send({ error: "Game log file not found" });
  });
}
