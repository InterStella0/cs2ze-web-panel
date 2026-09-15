import type { FastifyInstance } from "fastify";
import {
  addMapSchema,
  changeCurrentMapSchema,
  mapEntrySchema,
  mapGroupsSchema,
  mapName,
  mapPatchSchema,
  maplistSchema,
  reloadMapsSchema,
  setNextMapSchema,
  type Maplist,
  type MapsResponse,
} from "@cs2ze/shared";
import { audit } from "../db.js";
import { managedConfigOutOfSync, readManagedConfig, syncManagedConfig, writeManagedConfig } from "../files/managed-config.js";
import { rcon } from "../rcon/client.js";
import { clearRconStatusCache, getRconStatus } from "../rcon/status.js";
import { firstIssue, requireOperator } from "./access.js";

async function response(): Promise<MapsResponse> {
  const [config, status, liveOutOfSync] = await Promise.all([
    readManagedConfig("maps", maplistSchema),
    getRconStatus(),
    managedConfigOutOfSync("maps"),
  ]);
  return {
    maps: Object.entries(config.Maps).map(([name, entry]) => ({ name, ...entry })),
    groups: config.Groups,
    currentMap: status.game?.currentMap ?? null,
    nextMap: status.game?.nextMap ?? null,
    liveOutOfSync,
  };
}

function validateGroups(config: Maplist): void {
  for (const [name, entry] of Object.entries(config.Maps)) {
    const missing = (entry.groups ?? []).find((group) => !config.Groups[group]);
    if (missing) throw Object.assign(new Error(`Map ${name} references missing group ${missing}`), { statusCode: 400 });
  }
}

async function save(config: Maplist) {
  validateGroups(config);
  const write = await writeManagedConfig("maps", maplistSchema, config);
  return { ...(await response()), write };
}

export async function registerMapRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/maps", async (request, reply) => {
    if (!requireOperator(request, reply)) return;
    return response();
  });

  app.get("/api/maps/groups", async (request, reply) => {
    if (!requireOperator(request, reply)) return;
    return (await readManagedConfig("maps", maplistSchema)).Groups;
  });

  app.put("/api/maps/groups", async (request, reply) => {
    const auth = requireOperator(request, reply);
    if (!auth) return;
    const parsed = mapGroupsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed, "Invalid map groups") });
    const config = await readManagedConfig("maps", maplistSchema);
    config.Groups = parsed.data;
    const result = await save(config);
    audit(auth.user, "maps.groups.update", undefined, `groups=${Object.keys(parsed.data).length}`);
    return result;
  });

  app.post("/api/maps", async (request, reply) => {
    const auth = requireOperator(request, reply);
    if (!auth) return;
    const parsed = addMapSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed, "Invalid map") });
    const { name, ...entry } = parsed.data;
    const config = await readManagedConfig("maps", maplistSchema);
    if (config.Maps[name]) return reply.code(409).send({ error: `Map ${name} already exists` });
    config.Maps[name] = mapEntrySchema.parse(entry);
    const result = await save(config);
    audit(auth.user, "maps.create", name);
    return reply.code(201).send(result);
  });

  const update = async (request: any, reply: any) => {
    const auth = requireOperator(request, reply);
    if (!auth) return;
    const name = mapName.safeParse(request.params.name);
    const patch = mapPatchSchema.safeParse(request.body);
    if (!name.success) return reply.code(400).send({ error: firstIssue(name, "Invalid map name") });
    if (!patch.success) return reply.code(400).send({ error: firstIssue(patch, "Invalid map") });
    const config = await readManagedConfig("maps", maplistSchema);
    if (!config.Maps[name.data]) return reply.code(404).send({ error: "Map not found" });
    config.Maps[name.data] = mapEntrySchema.parse({ ...config.Maps[name.data], ...patch.data });
    const result = await save(config);
    audit(auth.user, "maps.update", name.data);
    return result;
  };
  app.put<{ Params: { name: string } }>("/api/maps/:name", update);
  app.patch<{ Params: { name: string } }>("/api/maps/:name", update);

  app.delete<{ Params: { name: string } }>("/api/maps/:name", async (request, reply) => {
    const auth = requireOperator(request, reply);
    if (!auth) return;
    const name = mapName.safeParse(request.params.name);
    if (!name.success) return reply.code(400).send({ error: firstIssue(name, "Invalid map name") });
    const config = await readManagedConfig("maps", maplistSchema);
    if (!config.Maps[name.data]) return reply.code(404).send({ error: "Map not found" });
    delete config.Maps[name.data];
    const result = await save(config);
    audit(auth.user, "maps.delete", name.data);
    return result;
  });

  app.post("/api/maps/reload", async (request, reply) => {
    const auth = requireOperator(request, reply);
    if (!auth) return;
    const parsed = reloadMapsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Explicit confirmation is required because this reloads the current map" });
    const sync = await syncManagedConfig("maps");
    if (!sync.liveSynced) return reply.code(409).send({ error: sync.liveError ?? "The live map list could not be updated" });
    const output = await rcon.exec("c_reload_map_list", 20_000);
    clearRconStatusCache();
    audit(auth.user, "maps.reload", undefined, "confirmed-current-map-reload");
    return { output, executedAt: new Date().toISOString() };
  });

  app.post("/api/maps/current", async (request, reply) => {
    const auth = requireOperator(request, reply);
    if (!auth) return;
    const parsed = changeCurrentMapSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed, "Invalid map change") });
    const target = parsed.data.map ?? String(parsed.data.workshopId);
    const output = await rcon.exec(`c_map ${target}`, 15_000);
    clearRconStatusCache();
    audit(auth.user, "maps.change", target, "confirmed-5-second-delay");
    return { output, executedAt: new Date().toISOString() };
  });

  app.post("/api/maps/next", async (request, reply) => {
    const auth = requireOperator(request, reply);
    if (!auth) return;
    const parsed = setNextMapSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed, "Invalid next map") });
    const output = await rcon.exec(parsed.data.map ? `c_setnextmap ${parsed.data.map}` : "c_setnextmap", 10_000);
    clearRconStatusCache();
    audit(auth.user, "maps.next", parsed.data.map ?? "automatic");
    return { output, executedAt: new Date().toISOString() };
  });
}
