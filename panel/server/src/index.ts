import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import type { HealthResponse } from "@cs2ze/shared";
import { registerAuthRoutes } from "./auth/routes.js";
import { config } from "./config.js";
import { bootstrapOwner, closeDatabase, initDatabase } from "./db.js";
import { getProjectOrNull, getSetupError, runPreflight } from "./project.js";
import { registerServerRoutes } from "./routes/server.js";
import { registerLogRoutes } from "./routes/logs.js";
import { registerRconRoutes } from "./routes/rcon.js";
import { registerEnvRoutes } from "./routes/env.js";
import { registerMapRoutes } from "./routes/maps.js";
import { registerAdminRoutes } from "./routes/admins.js";
import { registerPlayerRoutes } from "./routes/players.js";
import { registerWorkshopRoutes } from "./routes/workshop.js";
import { registerPlayerClassRoutes } from "./routes/player-classes.js";
import { closeDockerLogStream } from "./logs/docker-stream.js";
import { closeGameLogStream } from "./logs/game-files.js";
import { rcon } from "./rcon/client.js";

process.umask(0o077);

const app = Fastify({
  logger: true,
  trustProxy: config.trustProxy,
  bodyLimit: 4 * 1024 * 1024,
});

const requestWindows = new Map<string, { startedAt: number; count: number }>();

await app.register(cookie);
await initDatabase();
await bootstrapOwner();

app.addHook("onRequest", async (request, reply) => {
  const now = Date.now();
  const current = requestWindows.get(request.ip);
  const window = !current || now - current.startedAt >= 60_000
    ? { startedAt: now, count: 1 }
    : { ...current, count: current.count + 1 };
  requestWindows.set(request.ip, window);
  if (window.count > 300) {
    return reply.code(429).header("Retry-After", String(Math.ceil((60_000 - (now - window.startedAt)) / 1000)))
      .send({ error: "Request rate limit exceeded" });
  }

  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return;
  const fetchSite = request.headers["sec-fetch-site"];
  if (fetchSite === "cross-site") {
    return reply.code(403).send({ error: "Cross-origin request rejected" });
  }
});

await registerAuthRoutes(app);
await registerServerRoutes(app);
await registerLogRoutes(app);
await registerRconRoutes(app);
await registerEnvRoutes(app);
await registerMapRoutes(app);
await registerAdminRoutes(app);
await registerPlayerRoutes(app);
await registerWorkshopRoutes(app);
await registerPlayerClassRoutes(app);

app.get("/api/health", async (): Promise<HealthResponse> => {
  const project = getProjectOrNull();
  const setupError = getSetupError();
  return {
    ok: setupError === null,
    version: config.version,
    setupError,
    project: project?.projectName ?? null,
    workingDir: project?.workingDir ?? null,
  };
});

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);
  const err = error as Error & { statusCode?: number };
  const statusCode = typeof err.statusCode === "number" && err.statusCode >= 400 ? err.statusCode : 500;
  return reply.code(statusCode).send({ error: statusCode === 500 ? "Internal server error" : err.message });
});

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "../../web/dist");
try {
  await fs.access(path.join(webRoot, "index.html"));
  await app.register(fastifyStatic, { root: webRoot, wildcard: false });
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) return reply.code(404).send({ error: "Not found" });
    return reply.type("text/html").sendFile("index.html");
  });
} catch {
  app.log.warn(`Web assets not found at ${webRoot}; serving API only`);
}

await runPreflight();
await app.listen({ port: config.port, host: config.host });

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, "Shutting down");
  closeDockerLogStream();
  closeGameLogStream();
  rcon.close();
  await app.close();
  closeDatabase();
  process.exit(0);
};
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
