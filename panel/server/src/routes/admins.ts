import type { FastifyInstance } from "fastify";
import {
  PLACEHOLDER_ADMIN_ID,
  adminEntrySchema,
  adminGroupsSchema,
  adminPatchSchema,
  adminsSchema,
  migrateEnvAdminSchema,
  newAdminSchema,
  steamId64,
  type Admins,
  type AdminsResponse,
} from "@cs2ze/shared";
import { audit } from "../db.js";
import { readEnvFile, readEnvRecord, setValue, writeEnvFile } from "../files/dotenv-edit.js";
import { MANAGED_CONFIGS, managedConfigOutOfSync, readManagedConfig, syncManagedConfig, writeManagedConfig } from "../files/managed-config.js";
import { readProjectFile, safeWrite } from "../files/safe-write.js";
import { rcon } from "../rcon/client.js";
import { firstIssue, requireOperator } from "./access.js";

async function envOverride(): Promise<{ active: boolean; steamid: string | null }> {
  const id = (await readEnvRecord()).CS2_ADMIN_STEAMID?.trim() ?? "";
  return { active: id !== "", steamid: id || null };
}

async function response(): Promise<AdminsResponse> {
  const [config, env, liveOutOfSync] = await Promise.all([
    readManagedConfig("admins", adminsSchema), envOverride(), managedConfigOutOfSync("admins"),
  ]);
  return {
    admins: Object.entries(config.Admins).map(([steamid, entry]) => ({ steamid, ...entry, isPlaceholder: steamid === PLACEHOLDER_ADMIN_ID })),
    groups: config.Groups,
    envOverrideActive: env.active,
    envOverrideSteamId: env.steamid,
    liveOutOfSync,
  };
}

function validateGroups(config: Admins): void {
  for (const [steamid, entry] of Object.entries(config.Admins)) {
    const missing = (entry.groups ?? []).find((group) => !config.Groups[group]);
    if (missing) throw Object.assign(new Error(`Admin ${steamid} references missing group ${missing}`), { statusCode: 400 });
  }
}

async function assertEditable(): Promise<void> {
  if ((await envOverride()).active) {
    throw Object.assign(new Error("CS2_ADMIN_STEAMID is active and will overwrite this file on boot. Migrate the legacy admin first."), { statusCode: 409 });
  }
}

async function save(config: Admins) {
  validateGroups(config);
  const write = await writeManagedConfig("admins", adminsSchema, config);
  return { ...(await response()), write };
}

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/admins", async (request, reply) => {
    if (!requireOperator(request, reply)) return;
    return response();
  });

  app.get("/api/admins/groups", async (request, reply) => {
    if (!requireOperator(request, reply)) return;
    return (await readManagedConfig("admins", adminsSchema)).Groups;
  });

  app.put("/api/admins/groups", async (request, reply) => {
    const auth = requireOperator(request, reply);
    if (!auth) return;
    await assertEditable();
    const parsed = adminGroupsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed, "Invalid admin groups") });
    const config = await readManagedConfig("admins", adminsSchema);
    config.Groups = parsed.data;
    const result = await save(config);
    audit(auth.user, "admins.groups.update", undefined, `groups=${Object.keys(parsed.data).length}`);
    return result;
  });

  app.post("/api/admins", async (request, reply) => {
    const auth = requireOperator(request, reply);
    if (!auth) return;
    await assertEditable();
    const parsed = newAdminSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: firstIssue(parsed, "Invalid admin") });
    const { steamid, ...entry } = parsed.data;
    const config = await readManagedConfig("admins", adminsSchema);
    if (config.Admins[steamid]) return reply.code(409).send({ error: "Admin already exists" });
    delete config.Admins[PLACEHOLDER_ADMIN_ID];
    config.Admins[steamid] = adminEntrySchema.parse(entry);
    const result = await save(config);
    audit(auth.user, "admins.create", steamid);
    return reply.code(201).send(result);
  });

  const update = async (request: any, reply: any) => {
    const auth = requireOperator(request, reply);
    if (!auth) return;
    await assertEditable();
    const id = steamId64.safeParse(request.params.steamid);
    const patch = adminPatchSchema.safeParse(request.body);
    if (!id.success) return reply.code(400).send({ error: firstIssue(id, "Invalid SteamID64") });
    if (!patch.success) return reply.code(400).send({ error: firstIssue(patch, "Invalid admin") });
    const config = await readManagedConfig("admins", adminsSchema);
    if (!config.Admins[id.data]) return reply.code(404).send({ error: "Admin not found" });
    config.Admins[id.data] = adminEntrySchema.parse({ ...config.Admins[id.data], ...patch.data });
    const result = await save(config);
    audit(auth.user, "admins.update", id.data);
    return result;
  };
  app.put<{ Params: { steamid: string } }>("/api/admins/:steamid", update);
  app.patch<{ Params: { steamid: string } }>("/api/admins/:steamid", update);

  app.delete<{ Params: { steamid: string } }>("/api/admins/:steamid", async (request, reply) => {
    const auth = requireOperator(request, reply);
    if (!auth) return;
    await assertEditable();
    const id = steamId64.safeParse(request.params.steamid);
    if (!id.success) return reply.code(400).send({ error: firstIssue(id, "Invalid SteamID64") });
    const config = await readManagedConfig("admins", adminsSchema);
    if (!config.Admins[id.data]) return reply.code(404).send({ error: "Admin not found" });
    delete config.Admins[id.data];
    const result = await save(config);
    audit(auth.user, "admins.delete", id.data);
    return result;
  });

  app.post("/api/admins/reload", async (request, reply) => {
    const auth = requireOperator(request, reply);
    if (!auth) return;
    await assertEditable();
    const sync = await syncManagedConfig("admins");
    if (!sync.liveSynced) return reply.code(409).send({ error: sync.liveError ?? "The live admin list could not be updated" });
    const output = await rcon.exec("c_reload_admins", 10_000);
    audit(auth.user, "admins.reload");
    return { output, executedAt: new Date().toISOString() };
  });

  app.post("/api/admins/migrate-env-steamid", async (request, reply) => {
    const auth = requireOperator(request, reply);
    if (!auth) return;
    const confirmation = migrateEnvAdminSchema.safeParse(request.body);
    if (!confirmation.success) return reply.code(400).send({ error: "Explicit migration confirmation is required" });
    const env = await readEnvRecord();
    const id = steamId64.safeParse(env.CS2_ADMIN_STEAMID ?? "");
    if (!id.success) return reply.code(409).send({ error: "No valid CS2_ADMIN_STEAMID override is active" });

    const [config, originalAdmins, envFile] = await Promise.all([
      readManagedConfig("admins", adminsSchema),
      readProjectFile(MANAGED_CONFIGS.admins.source),
      readEnvFile(),
    ]);
    delete config.Admins[PLACEHOLDER_ADMIN_ID];
    config.Admins[id.data] = adminEntrySchema.parse({
      name: env.CS2_ADMIN_NAME?.trim() || "Server Owner",
      flags: env.CS2_ADMIN_FLAGS?.trim() || "z",
      immunity: 100,
      groups: [],
    });
    validateGroups(config);

    await safeWrite(MANAGED_CONFIGS.admins.source, `${JSON.stringify(adminsSchema.parse(config), null, 2)}\n`);
    try {
      setValue(envFile.parsed, "CS2_ADMIN_STEAMID", "");
      await writeEnvFile(envFile.parsed);
    } catch (error) {
      await safeWrite(MANAGED_CONFIGS.admins.source, originalAdmins);
      throw error;
    }
    const sync = await syncManagedConfig("admins");
    audit(auth.user, "admins.migrate-env", id.data, `liveSynced=${sync.liveSynced}`);
    return { ...(await response()), write: { saved: true, ...sync } };
  });
}
