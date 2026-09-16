import type { FastifyInstance } from "fastify";
import {
  ACTIONS_REQUIRING_REASON,
  ACTIONS_WITH_DURATION,
  playerActionRequestSchema,
  playerActionSchema,
  steamId64,
  type PlayerAction,
} from "@cs2ze/shared";
import { audit } from "../db.js";
import { getPlayerDbAvatar, isPlayerDbSteamId } from "../playerdb.js";
import { rcon } from "../rcon/client.js";
import { clearRconStatusCache, getRconStatus } from "../rcon/status.js";
import { firstIssue, requireOperator } from "./access.js";

const userId = /^\d{1,10}$/;

function commandFor(action: PlayerAction, target: string, duration = 0, amount = 0): string {
  if (action === "unban") return `c_unban ${target}`;
  const selected = `#${target}`;
  if (ACTIONS_WITH_DURATION.includes(action)) return `c_${action} ${selected} ${duration}`;
  if (action === "slap") return `c_slap ${selected} ${amount}`;
  return `c_${action} ${selected}`;
}

export async function registerPlayerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/players", async (request, reply) => {
    if (!requireOperator(request, reply)) return;
    return getRconStatus(true);
  });

  app.get<{ Params: { steamid: string } }>("/api/players/:steamid/avatar", async (request, reply) => {
    if (!requireOperator(request, reply)) return;
    const steamid = request.params.steamid;
    if (!isPlayerDbSteamId(steamid)) return reply.code(400).send({ error: "Invalid Steam ID" });

    const avatarUrl = await getPlayerDbAvatar(steamid);
    if (!avatarUrl) {
      return reply.code(404).header("Cache-Control", "private, max-age=300").send({ error: "Player avatar not found" });
    }
    return reply.code(302)
      .header("Cache-Control", "private, max-age=21600")
      .header("Location", avatarUrl)
      .send();
  });

  app.post<{ Params: { id: string; action: string } }>("/api/players/:id/:action", async (request, reply) => {
    const auth = requireOperator(request, reply);
    if (!auth) return;
    const action = playerActionSchema.safeParse(request.params.action);
    if (!action.success) return reply.code(400).send({ error: firstIssue(action, "Unsupported player action") });
    const parsed = playerActionRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed, "Invalid player action") });
    if (parsed.data.action !== action.data) return reply.code(400).send({ error: "Body action must match the URL action" });
    if (ACTIONS_REQUIRING_REASON.includes(action.data) && !parsed.data.reason?.trim()) {
      return reply.code(400).send({ error: "A reason is required for this action" });
    }

    let target = request.params.id;
    let targetName = target;
    if (action.data === "unban") {
      const checked = steamId64.safeParse(target);
      if (!checked.success) return reply.code(400).send({ error: firstIssue(checked, "Invalid SteamID64") });
      target = checked.data;
    } else {
      if (!userId.test(target)) return reply.code(400).send({ error: "Player ID must be numeric" });
      const status = await getRconStatus(true);
      if (!status.connected) return reply.code(503).send({ error: status.error ?? "RCON is unavailable" });
      const player = status.players.find((item) => item.userid === target);
      if (!player) return reply.code(404).send({ error: "Player is no longer connected; refresh the roster" });
      targetName = player.name;
    }

    const command = commandFor(action.data, target, parsed.data.durationMinutes ?? 0, parsed.data.amount ?? 0);
    const output = await rcon.exec(command, 10_000);
    clearRconStatusCache();
    audit(
      auth.user,
      `players.${action.data}`,
      action.data === "unban" ? target : `${targetName} (#${target})`,
      [parsed.data.durationMinutes !== undefined ? `minutes=${parsed.data.durationMinutes}` : "", parsed.data.reason ? `reason=${parsed.data.reason}` : ""].filter(Boolean).join(" "),
    );
    return { action: action.data, target, output, executedAt: new Date().toISOString() };
  });
}
