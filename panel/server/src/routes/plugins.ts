import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  pluginUpdateRequestSchema,
  pluginUpdateSettingsSchema,
  type PluginsResponse,
  type PluginUpdateResult,
} from "@cs2ze/shared";
import { requireAuth, type RequestAuth } from "../auth/routes.js";
import { audit } from "../db.js";
import { ComposeBusyError } from "../docker/compose.js";
import {
  applyPluginVersions,
  getPluginsResponse,
  getUpdateSettings,
  runUpdateCheck,
  saveUpdateSettings,
} from "../plugins/service.js";
import { refreshReleases } from "../plugins/releases.js";
import { getSetupError } from "../project.js";
import { firstIssue, requireOperator } from "./access.js";

/**
 * Reading plugin versions is operator-level, but changing them rewrites .env and
 * recreates the game server, so it is held to the same owner bar as the settings
 * page.
 */
function owner(request: FastifyRequest, reply: FastifyReply): RequestAuth | null {
  const auth = requireOperator(request, reply);
  if (!auth) return null;
  if (auth.user.role !== "owner") {
    void reply.code(403).send({ error: "Updating plugins requires the owner role" });
    return null;
  }
  return auth;
}

export async function registerPluginRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/plugins", async (request, reply): Promise<PluginsResponse | undefined> => {
    if (!requireOperator(request, reply)) return;
    return getPluginsResponse();
  });

  app.post("/api/plugins/check", async (request, reply): Promise<PluginsResponse | undefined> => {
    if (!requireOperator(request, reply)) return;
    await refreshReleases(true);
    return getPluginsResponse();
  });

  app.get("/api/plugins/settings", async (request, reply) => {
    if (!owner(request, reply)) return;
    return getUpdateSettings();
  });

  app.put("/api/plugins/settings", async (request, reply) => {
    const auth = owner(request, reply);
    if (!auth) return;
    const parsed = pluginUpdateSettingsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: firstIssue(parsed, "Invalid updater settings") });
    }
    const saved = saveUpdateSettings(parsed.data);
    audit(
      auth.user,
      "plugins.settings",
      saved.autoApply ? saved.autoApplyPlugins.join(",") || "none" : "manual",
      `checkEnabled=${saved.checkEnabled} every=${saved.checkIntervalHours}h autoApply=${saved.autoApply}`,
    );
    return saved;
  });

  /** Run the scheduled check now, including an automatic apply if it is enabled. */
  app.post("/api/plugins/run-check", async (request, reply) => {
    const auth = owner(request, reply);
    if (!auth) return;
    audit(auth.user, "plugins.checkNow");
    return runUpdateCheck();
  });

  app.post("/api/plugins/update", async (request, reply): Promise<PluginUpdateResult | undefined> => {
    const auth = owner(request, reply);
    if (!auth) return;
    if (getSetupError()) {
      void reply.code(503).send({ error: "Panel setup preflight has not passed" });
      return;
    }
    const parsed = pluginUpdateRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      void reply.code(400).send({ error: firstIssue(parsed, "Invalid update request") });
      return;
    }
    try {
      return await applyPluginVersions(parsed.data.selections, parsed.data.apply, {
        user: auth.user,
        name: auth.user.username,
      });
    } catch (error) {
      if (error instanceof ComposeBusyError) {
        void reply.code(409).send({ error: error.message });
        return;
      }
      const failure = error as Error & { statusCode?: number; findings?: unknown };
      if (typeof failure.statusCode === "number") {
        void reply.code(failure.statusCode).send({ error: failure.message, findings: failure.findings });
        return;
      }
      throw error;
    }
  });
}
