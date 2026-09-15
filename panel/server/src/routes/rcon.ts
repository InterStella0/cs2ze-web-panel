import type { FastifyInstance } from "fastify";
import { rconExecSchema } from "@cs2ze/shared";
import { requireAuth } from "../auth/routes.js";
import { audit } from "../db.js";
import { rcon } from "../rcon/client.js";
import { getRconCommands, getRconStatus, observeRconCommand } from "../rcon/status.js";
import { getSetupError } from "../project.js";

function commandName(command: string): string {
  return command.trim().split(/[\s;]/, 1)[0]?.slice(0, 80) || "unknown";
}

export async function registerRconRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/rcon/status", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    if (getSetupError()) return reply.code(503).send({ error: "Panel setup preflight has not passed" });
    return getRconStatus();
  });

  app.get("/api/rcon/commands", async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) return;
    if (auth.user.role !== "owner") return reply.code(403).send({ error: "Raw console access requires the owner role" });
    if (auth.user.mustChangePassword) return reply.code(403).send({ error: "Change the bootstrap password first" });
    return getRconCommands();
  });

  app.post("/api/rcon/exec", async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) return;
    if (auth.user.role !== "owner") return reply.code(403).send({ error: "Raw console access requires the owner role" });
    if (auth.user.mustChangePassword) return reply.code(403).send({ error: "Change the bootstrap password first" });
    const parsed = rconExecSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid RCON command" });

    const command = parsed.data.command;
    const output = await rcon.exec(command, command.toLowerCase() === "cvarlist" ? 30_000 : 15_000);
    observeRconCommand(command, output);
    // Arguments are intentionally omitted: commands may contain passwords or tokens.
    audit(auth.user, "rcon.exec", commandName(command));
    return { command, output, executedAt: new Date().toISOString() };
  });
}
