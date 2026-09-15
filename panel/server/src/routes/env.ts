import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  ENV_SCHEMA,
  ENV_SCHEMA_BY_KEY,
  SECRET_KEYS,
  envPatchSchema,
  requiresRestart,
  unescapeEnvSlashes,
  validateEnvPatch,
  validateEnvRecord,
  type EnvKeyValue,
  type EnvPatchResult,
  type EnvResponse,
  type EnvValidationResult,
} from "@cs2ze/shared";
import { requireAuth, type RequestAuth } from "../auth/routes.js";
import { audit } from "../db.js";
import { dockerInspect } from "../docker/cli.js";
import { getDrift } from "../drift.js";
import { readEnvFile, readEnvRecord, setValue, writeEnvFile } from "../files/dotenv-edit.js";
import { getSetupError } from "../project.js";
import { rcon } from "../rcon/client.js";
import { config } from "../config.js";

interface ContainerInspect { Config?: { Env?: string[] } }

function owner(request: FastifyRequest, reply: FastifyReply): RequestAuth | null {
  const auth = requireAuth(request, reply);
  if (!auth) return null;
  if (auth.user.role !== "owner") {
    void reply.code(403).send({ error: "Settings access requires the owner role" });
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

function parseContainerEnv(lines: string[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of lines ?? []) {
    const at = line.indexOf("=");
    if (at > 0) {
      const key = line.slice(0, at);
      const value = line.slice(at + 1);
      out[key] = ENV_SCHEMA_BY_KEY[key]?.slashEscaped ? unescapeEnvSlashes(value) : value;
    }
  }
  return out;
}

async function envResponse(): Promise<EnvResponse> {
  const [current, inspect] = await Promise.all([
    readEnvRecord(),
    dockerInspect<ContainerInspect>(config.cs2ContainerName),
  ]);
  const running = parseContainerEnv(inspect?.Config?.Env);
  const schemaKeys = ENV_SCHEMA.map((spec) => spec.key);
  const keys = [...schemaKeys, ...Object.keys(current).filter((key) => !ENV_SCHEMA_BY_KEY[key])];
  const values: EnvKeyValue[] = keys.map((key) => {
    const spec = ENV_SCHEMA_BY_KEY[key];
    // Unknown keys are redacted: an extension may introduce a secret before
    // the panel schema learns about it.
    const isSecret = spec?.secret === true || !spec;
    const raw = current[key];
    return {
      key,
      value: isSecret ? null : raw ?? spec?.default ?? "",
      hasValue: raw !== undefined && raw !== "",
      runningValue: isSecret ? null : running[key] ?? null,
      isSecret,
      unknown: !spec,
    };
  });
  return { values, findings: validateEnvRecord(current) };
}

function quoteCvar(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export async function assertEnvCanBoot(): Promise<void> {
  const findings = validateEnvRecord(await readEnvRecord());
  const errors = findings.filter((finding) => finding.severity === "error");
  if (errors.length) {
    const error = new Error(`Cannot apply .env: ${errors.map((finding) => finding.message).join("; ")}`) as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }
}

export async function registerEnvRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/env/schema", async (request, reply) => {
    if (!owner(request, reply)) return;
    return ENV_SCHEMA;
  });

  app.get("/api/env", async (request, reply) => {
    if (!owner(request, reply)) return;
    return envResponse();
  });

  app.post("/api/env/validate", async (request, reply): Promise<EnvValidationResult | undefined> => {
    if (!owner(request, reply)) return;
    const parsed = envPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      void reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid settings" });
      return;
    }
    const findings = validateEnvPatch(await readEnvRecord(), parsed.data.changes);
    return { findings, valid: !findings.some((finding) => finding.severity === "error") };
  });

  app.patch("/api/env", async (request, reply): Promise<EnvPatchResult | undefined> => {
    const auth = owner(request, reply);
    if (!auth) return;
    const parsed = envPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      void reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid settings" });
      return;
    }
    const { parsed: file } = await readEnvFile();
    const current = await readEnvRecord();
    const changes = Object.fromEntries(Object.entries(parsed.data.changes).filter(([key, value]) => current[key] !== value));
    const findings = validateEnvPatch(current, changes);
    const errors = findings.filter((finding) => finding.severity === "error");
    if (errors.length) {
      void reply.code(400).send({ error: errors[0]?.message ?? "Invalid settings", findings });
      return;
    }
    if (!Object.keys(changes).length) return { written: [], appliedLive: [], pendingRestart: [], findings };

    for (const [key, value] of Object.entries(changes)) setValue(file, key, value);
    await writeEnvFile(file);
    audit(auth.user, "env.update", Object.keys(changes).sort().join(","), `keys=${Object.keys(changes).length}`);

    const appliedLive: EnvPatchResult["appliedLive"] = [];
    const liveSucceeded = new Set<string>();
    if (parsed.data.applyLive) {
      for (const [key, value] of Object.entries(changes)) {
        const spec = ENV_SCHEMA_BY_KEY[key];
        if (!spec?.cvar) continue;
        const rendered = spec.cvarQuote ? quoteCvar(value) : value;
        try {
          await rcon.exec(`${spec.cvar} ${rendered}`, 10_000);
          appliedLive.push({ key, cvar: spec.cvar, ok: true });
          liveSucceeded.add(key);
        } catch (error) {
          appliedLive.push({ key, cvar: spec.cvar, ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      }
    }

    const pendingRestart = Object.keys(changes).filter((key) =>
      requiresRestart(key) || (ENV_SCHEMA_BY_KEY[key]?.cvar !== undefined && !liveSucceeded.has(key)),
    );
    return { written: Object.keys(changes), appliedLive, pendingRestart, findings };
  });

  app.get<{ Params: { key: string } }>("/api/env/reveal/:key", async (request, reply) => {
    const auth = owner(request, reply);
    if (!auth) return;
    const key = request.params.key;
    if (!SECRET_KEYS.includes(key)) return reply.code(404).send({ error: "Secret setting not found" });
    const value = (await readEnvRecord())[key] ?? "";
    audit(auth.user, "env.reveal", key);
    return { key, value };
  });

  app.get("/api/drift", async (request, reply) => {
    if (!owner(request, reply)) return;
    return getDrift();
  });
}
