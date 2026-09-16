import type { CompatFinding } from "./compat.js";
import { checkBootBlocking } from "./compat.js";
import { ENV_SCHEMA_BY_KEY, type EnvKeySpec } from "./env-schema.js";
import { addonIdList, envValue, extraCfg, mapName, portNumber, workshopIdLike } from "./validators.js";

const PUBLISHED_PORT_KEYS = [
  "CS2_PUBLISHED_PORT",
  "CS2_RCON_PUBLISHED_PORT",
  "TV_PUBLISHED_PORT",
] as const;

function error(message: string, keys: string[]): CompatFinding {
  return { severity: "error", message, keys };
}

function warning(message: string, keys: string[]): CompatFinding {
  return { severity: "warning", message, keys };
}

function validateTypedValue(spec: EnvKeySpec, value: string): string | null {
  const safe = envValue.safeParse(value);
  if (!safe.success) return safe.error.issues[0]?.message ?? "Invalid value";

  if (spec.type === "boolean01" && value !== "0" && value !== "1") return "Must be 0 or 1";
  if (spec.type === "select" && !spec.options?.includes(value)) {
    return `Must be one of: ${(spec.options ?? []).join(", ")}`;
  }
  if (spec.type === "number" || spec.type === "float") {
    if (value.trim() === "" || !Number.isFinite(Number(value))) return "Must be a number";
    const numeric = Number(value);
    if (spec.type === "number" && !Number.isInteger(numeric)) return "Must be a whole number";
    if (spec.min !== undefined && numeric < spec.min) return `Must be at least ${spec.min}`;
    if (spec.max !== undefined && numeric > spec.max) return `Must be at most ${spec.max}`;
  }
  return null;
}

/** Shared browser/server validation for the complete effective .env record. */
export function validateEnvRecord(env: Record<string, string>): CompatFinding[] {
  const findings: CompatFinding[] = [];
  for (const [key, value] of Object.entries(env)) {
    const spec = ENV_SCHEMA_BY_KEY[key];
    if (!spec) continue;
    const message = validateTypedValue(spec, value);
    if (message) findings.push(error(`${spec.label}: ${message}`, [key]));
  }

  const special: Array<[string, { safeParse: (value: unknown) => { success: boolean; error?: { issues: Array<{ message: string }> } } }]> = [
    ["CS2FIXES_EXTRA_CFG", extraCfg],
    ["MAM_EXTRA_ADDONS", addonIdList],
    ["MAM_CLIENT_EXTRA_ADDONS", addonIdList],
  ];
  for (const [key, schema] of special) {
    if (!(key in env)) continue;
    const parsed = schema.safeParse(env[key]);
    if (!parsed.success) findings.push(error(parsed.error?.issues[0]?.message ?? "Invalid value", [key]));
  }

  if (env.CS2_STARTMAP) {
    const parsed = mapName.safeParse(env.CS2_STARTMAP);
    if (!parsed.success) findings.push(error(parsed.error.issues[0]?.message ?? "Invalid map name", ["CS2_STARTMAP"]));
  }
  for (const key of ["CS2_HOST_WORKSHOP_MAP", "CS2_HOST_WORKSHOP_COLLECTION"] as const) {
    const value = env[key];
    if (!value) continue;
    const parsed = workshopIdLike.safeParse(value);
    if (!parsed.success) findings.push(error("Workshop ID must be a positive integer", [key]));
  }

  const ports = new Map<number, string[]>();
  for (const key of PUBLISHED_PORT_KEYS) {
    const value = env[key];
    if (!value || !portNumber.safeParse(value).success) continue;
    const port = Number(value);
    ports.set(port, [...(ports.get(port) ?? []), key]);
  }
  for (const [port, keys] of ports) {
    if (keys.length > 1) findings.push(error(`Published port ${port} is assigned more than once`, keys));
  }

  if ((env.INSTALL_CS2FIXES ?? "1") === "1"
    && (env.CS2FIXES_VOTEMANAGER_ENABLE ?? "1") === "1"
    && !env.CS2_HOST_WORKSHOP_COLLECTION) {
    findings.push(warning(
      "CS2Fixes map voting needs a workshop collection at server startup so it can replace it with maplist.jsonc",
      ["CS2_HOST_WORKSHOP_COLLECTION", "CS2FIXES_VOTEMANAGER_ENABLE"],
    ));
  }

  findings.push(...checkBootBlocking(env));
  return findings.filter((finding, index, all) =>
    all.findIndex((candidate) => candidate.message === finding.message && candidate.keys.join("\0") === finding.keys.join("\0")) === index,
  );
}

/** Validate only submitted keys and then the resulting effective record. */
export function validateEnvPatch(current: Record<string, string>, changes: Record<string, string>): CompatFinding[] {
  const findings: CompatFinding[] = [];
  for (const [key, value] of Object.entries(changes)) {
    const spec = ENV_SCHEMA_BY_KEY[key];
    if (!spec) findings.push(error(`Unknown environment key: ${key}`, [key]));
    else if (spec.panelManaged) findings.push(error(`${spec.label} is managed by the panel and cannot be changed here`, [key]));
    const safe = envValue.safeParse(value);
    if (!safe.success) findings.push(error(safe.error.issues[0]?.message ?? "Invalid value", [key]));
  }
  return [...findings, ...validateEnvRecord({ ...current, ...changes })].filter((finding, index, all) =>
    all.findIndex((candidate) => candidate.message === finding.message && candidate.keys.join("\0") === finding.keys.join("\0")) === index,
  );
}
