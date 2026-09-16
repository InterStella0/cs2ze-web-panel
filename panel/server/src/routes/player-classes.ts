import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  GFL_MODEL_PRESET,
  playerClassesSchema,
  updatePlayerClassesSchema,
  type PlayerClassesResponse,
} from "@cs2ze/shared";
import { requireAuth, type RequestAuth } from "../auth/routes.js";
import { audit } from "../db.js";
import { managedConfigOutOfSync, readManagedConfig, writeManagedConfig } from "../files/managed-config.js";
import { getSetupError } from "../project.js";

function owner(request: FastifyRequest, reply: FastifyReply): RequestAuth | null {
  const auth = requireAuth(request, reply);
  if (!auth) return null;
  if (auth.user.role !== "owner") {
    void reply.code(403).send({ error: "Player class access requires the owner role" });
    return null;
  }
  if (auth.user.mustChangePassword) {
    void reply.code(403).send({ error: "Change the bootstrap password first" });
    return null;
  }
  if (getSetupError()) {
    void reply.code(503).send({ error: "Panel setup preflight has not passed" });
    return null;
  }
  return auth;
}

async function response(): Promise<PlayerClassesResponse> {
  return {
    classes: await readManagedConfig("playerClasses", playerClassesSchema),
    presets: GFL_MODEL_PRESET.map((entry) => ({ ...entry, skins: [...entry.skins] })),
    liveOutOfSync: await managedConfigOutOfSync("playerClasses"),
    activation: "next_map",
  };
}

export async function registerPlayerClassRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/player-classes", async (request, reply) => {
    if (!owner(request, reply)) return;
    return response();
  });

  app.put("/api/player-classes", async (request, reply) => {
    const auth = owner(request, reply);
    if (!auth) return;
    const parsed = updatePlayerClassesSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid player classes" });
    }
    const write = await writeManagedConfig("playerClasses", playerClassesSchema, parsed.data.classes);
    audit(auth.user, "playerclasses.update", undefined, `classes=${Object.values(parsed.data.classes).reduce((count, team) => count + Object.keys(team).length, 0)}`);
    return { ...(await response()), write };
  });
}
