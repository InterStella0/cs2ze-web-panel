import { z } from "zod";
import { mapName, steamId64, workshopIdLike } from "./validators.js";

export type Role = "owner" | "operator";

export interface SessionUser {
  id: number;
  username: string;
  role: Role;
  mustChangePassword: boolean;
}

export interface AuthResponse {
  user: SessionUser;
  /** Sent in X-CS2ZE-CSRF on every state-changing request. */
  csrfToken: string;
}

export interface HealthResponse {
  ok: boolean;
  version: string;
  /** Non-null when the boot preflight failed; the SPA renders a diagnostic. */
  setupError: SetupError | null;
  project: string | null;
  workingDir: string | null;
}

export interface SetupError {
  code:
    | "container_not_found"
    | "missing_compose_labels"
    | "project_dir_not_mounted"
    | "project_dir_not_writable"
    | "env_file_missing"
    | "docker_unavailable";
  message: string;
  detail: string;
  expected?: string;
  actual?: string;
}

export type ServerState = "running" | "exited" | "restarting" | "created" | "paused" | "removing" | "dead" | "absent";

export interface ServerStatus {
  state: ServerState;
  status: string;
  health: string | null;
  startedAt: string | null;
  uptimeSeconds: number | null;
  image: string;
  rcon: {
    connected: boolean;
    error: string | null;
  };
  /** Null when RCON is unreachable. */
  game: {
    hostname: string | null;
    currentMap: string | null;
    nextMap: string | null;
    timeleftSeconds: number | null;
    players: number;
    bots: number;
    maxPlayers: number;
    publicAddress: string | null;
    version: string | null;
  } | null;
  plugins: PluginInfo[];
  diskUsageBytes: number | null;
}

export interface Player {
  userid: string;
  name: string;
  steamid: string | null;
  ping: number | null;
  loss: number | null;
  state: string;
  time: string | null;
  address: string | null;
  isBot: boolean;
  isAdmin: boolean;
}

export interface PluginInfo {
  index: string;
  name: string;
  version: string;
  author: string;
}

export interface RconStatusResponse {
  connected: boolean;
  error: string | null;
  game: ServerStatus["game"];
  players: Player[];
  plugins: PluginInfo[];
  checkedAt: string;
}

export type LogSource = "docker" | "game";

export interface LogEntry {
  id: number;
  source: LogSource;
  line: string;
  receivedAt: string;
}

export interface LogFileInfo {
  name: string;
  size: number;
  modifiedAt: string;
  active: boolean;
}

export interface LogFileResponse {
  name: string;
  content: string;
  truncated: boolean;
}

export const playerActionSchema = z.enum([
  "kick", "ban", "unban", "gag", "ungag", "mute", "unmute",
  "slay", "slap", "infect", "beacon", "glow", "leader", "revive", "ztele",
]);
export type PlayerAction = z.infer<typeof playerActionSchema>;

/** Actions that must carry a reason for the audit log. */
export const ACTIONS_REQUIRING_REASON: PlayerAction[] = ["kick", "ban"];
/** Actions that take a duration in minutes (0 = permanent). */
export const ACTIONS_WITH_DURATION: PlayerAction[] = ["ban", "gag", "mute"];

export const playerActionRequestSchema = z.object({
  action: playerActionSchema,
  reason: z.string().trim().max(200).refine((value) => !/[;\r\n\0]/.test(value), "Reason may not contain semicolons or control characters").optional(),
  durationMinutes: z.number().int().nonnegative().max(525600).optional(),
  amount: z.number().int().min(0).max(500).optional(),
});

export type JobState = "running" | "success" | "failed";
export type JobKind = "start" | "stop" | "restart" | "apply" | "pull";

export interface Job {
  id: string;
  kind: JobKind;
  state: JobState;
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
  command: string;
  output: string;
  startedBy: string;
}

export interface EnvKeyValue {
  key: string;
  /** Null for secrets; use hasValue to tell "set" from "empty". */
  value: string | null;
  hasValue: boolean;
  /** Value currently baked into the running container, for drift display. */
  runningValue: string | null;
  isSecret: boolean;
  /** Present in .env but absent from the schema. */
  unknown: boolean;
}

export interface EnvResponse {
  values: EnvKeyValue[];
  findings: Array<{ severity: "error" | "warning"; message: string; keys: string[] }>;
}

export const envPatchSchema = z.object({
  changes: z.record(z.string(), z.string()),
  applyLive: z.boolean().default(true),
});

export interface EnvPatchResult {
  written: string[];
  appliedLive: Array<{ key: string; cvar: string; ok: boolean; error?: string }>;
  pendingRestart: string[];
  findings: Array<{ severity: "error" | "warning"; message: string; keys: string[] }>;
}

export interface EnvValidationResult {
  findings: Array<{ severity: "error" | "warning"; message: string; keys: string[] }>;
  valid: boolean;
}

export interface EnvRevealResponse {
  key: string;
  value: string;
}

export interface DriftResponse {
  /** .env keys that differ from the running container's baked-in env. */
  envDrift: Array<{ key: string; running: string | null; current: string | null; isSecret: boolean; restartRequired: boolean }>;
  /** config/ files modified since the container started. */
  configDrift: Array<{ path: string; modifiedAt: string; liveMatches: boolean; hotReloadable: boolean }>;
  containerStartedAt: string | null;
  needsRestart: boolean;
}

export const addMapSchema = z.object({
  name: mapName,
  workshop_id: workshopIdLike.optional(),
  display_name: z.string().max(64).optional(),
  enabled: z.boolean().default(true),
  min_players: z.number().int().nonnegative().optional(),
  max_players: z.number().int().nonnegative().optional(),
  cooldown: z.number().nonnegative().optional(),
  groups: z.array(z.string()).default([]),
});

export const setNextMapSchema = z.object({
  /** Null clears the forced next map. */
  map: mapName.nullable(),
});

export const changeMapSchema = z.object({
  map: mapName.optional(),
  workshopId: workshopIdLike.optional(),
});

export interface ConfigWriteResult {
  saved: true;
  liveSynced: boolean;
  liveError: string | null;
}

export interface PlayerActionResult {
  action: PlayerAction;
  target: string;
  output: string;
  executedAt: string;
}

export interface PlayersResponse extends RconStatusResponse {}

export interface WorkshopItem {
  id: string;
  title: string;
  description: string | null;
  previewUrl: string | null;
  fileSize: number | null;
  timeUpdated: number | null;
  /** Steam's title is usually already the map name for ZE maps. */
  suggestedMapName: string;
}

export const rconExecSchema = z.object({
  command: z.string().trim().min(1).max(1024).refine((value) => !value.includes("\0"), "NUL bytes are not allowed"),
});

export interface RconExecResponse {
  command: string;
  output: string;
  executedAt: string;
}

export interface RconCommandsResponse {
  commands: string[];
  cachedAt: string;
}

/** Commands that get an extra confirmation step in the UI. */
export const DANGEROUS_RCON_COMMANDS = ["quit", "exit", "_restart", "restart", "sv_cheats 1", "killserver"];

export const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(12, "Password must be at least 12 characters").max(256),
});

export const createUserSchema = z.object({
  username: z.string().min(3).max(64).regex(/^[a-zA-Z0-9_.-]+$/, "Letters, digits, . _ - only"),
  password: z.string().min(12).max(256),
  role: z.enum(["owner", "operator"]),
});

export interface AuditEntry {
  id: number;
  username: string | null;
  action: string;
  target: string | null;
  detail: string | null;
  createdAt: string;
}

export interface ConfigFileInfo {
  /** Path relative to the project directory, e.g. config/cs2fixes/maplist.jsonc. */
  path: string;
  label: string;
  kind: "jsonc" | "cfg";
  size: number;
  modifiedAt: string;
  editable: boolean;
  /** Corresponding path under cs2-data, when the file is synced into the game tree. */
  livePath: string | null;
  liveMatches: boolean | null;
  hotReloadCommand: string | null;
}

export const writeConfigSchema = z.object({
  path: z.string().min(1),
  content: z.string().max(4 * 1024 * 1024),
});

export const restoreBackupSchema = z.object({
  path: z.string().min(1),
  backupId: z.string().min(1),
});

export interface BackupInfo {
  id: string;
  path: string;
  createdAt: string;
  size: number;
  sha8: string;
}

export const migrateAdminEnvSchema = z.object({
  confirm: z.literal(true),
});

export { steamId64 };
