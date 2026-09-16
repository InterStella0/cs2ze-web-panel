import type {
  AuthResponse,
  DriftResponse,
  EnvKeySpec,
  EnvPatchResult,
  EnvResponse,
  EnvRevealResponse,
  EnvValidationResult,
  AdminEntry,
  AdminGroup,
  AdminsResponse,
  ConfigWriteResult,
  HealthResponse,
  Job,
  JobKind,
  LogFileInfo,
  RconCommandsResponse,
  RconExecResponse,
  RconStatusResponse,
  ServerStatus,
  MapEntry,
  MapGroup,
  MapsResponse,
  PlayerAction,
  PlayerActionResult,
  PlayerClasses,
  PlayerClassesResponse,
  WorkshopItem,
} from "@cs2ze/shared";

let csrfToken = "";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (init.method && !["GET", "HEAD"].includes(init.method) && csrfToken) {
    headers.set("X-CS2ZE-CSRF", csrfToken);
  }
  const response = await fetch(url, { ...init, headers, credentials: "same-origin" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText })) as { error?: string };
    throw new ApiError(body.error ?? "Request failed", response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function remember(auth: AuthResponse): AuthResponse {
  csrfToken = auth.csrfToken;
  return auth;
}

export const api = {
  health: () => request<HealthResponse>("/api/health"),
  me: async () => remember(await request<AuthResponse>("/api/auth/me")),
  login: async (username: string, password: string) => remember(await request<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  })),
  changePassword: async (currentPassword: string, newPassword: string) => remember(await request<AuthResponse>("/api/auth/password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword }),
  })),
  logout: async () => {
    await request<void>("/api/auth/logout", { method: "POST" });
    csrfToken = "";
  },
  serverStatus: () => request<ServerStatus>("/api/server/status"),
  jobs: () => request<Job[]>("/api/jobs"),
  job: (id: string) => request<Job>(`/api/jobs/${encodeURIComponent(id)}`),
  lifecycle: (kind: JobKind) => request<{ jobId: string }>(`/api/server/${kind}`, { method: "POST" }),
  rconStatus: () => request<RconStatusResponse>("/api/rcon/status"),
  rconCommands: () => request<RconCommandsResponse>("/api/rcon/commands"),
  rconExec: (command: string) => request<RconExecResponse>("/api/rcon/exec", {
    method: "POST",
    body: JSON.stringify({ command }),
  }),
  logFiles: () => request<LogFileInfo[]>("/api/logs/files"),
  envSchema: () => request<EnvKeySpec[]>("/api/env/schema"),
  env: () => request<EnvResponse>("/api/env"),
  validateEnv: (changes: Record<string, string>) => request<EnvValidationResult>("/api/env/validate", {
    method: "POST",
    body: JSON.stringify({ changes, applyLive: true }),
  }),
  patchEnv: (changes: Record<string, string>, applyLive = true) => request<EnvPatchResult>("/api/env", {
    method: "PATCH",
    body: JSON.stringify({ changes, applyLive }),
  }),
  revealEnv: (key: string) => request<EnvRevealResponse>(`/api/env/reveal/${encodeURIComponent(key)}`),
  drift: () => request<DriftResponse>("/api/drift"),
  maps: () => request<MapsResponse>("/api/maps"),
  addMap: (map: { name: string } & Partial<MapEntry>) => request<MapsResponse & { write: ConfigWriteResult }>("/api/maps", { method: "POST", body: JSON.stringify(map) }),
  updateMap: (name: string, patch: Partial<MapEntry>) => request<MapsResponse & { write: ConfigWriteResult }>(`/api/maps/${encodeURIComponent(name)}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteMap: (name: string) => request<MapsResponse & { write: ConfigWriteResult }>(`/api/maps/${encodeURIComponent(name)}`, { method: "DELETE" }),
  putMapGroups: (groups: Record<string, MapGroup>) => request<MapsResponse & { write: ConfigWriteResult }>("/api/maps/groups", { method: "PUT", body: JSON.stringify(groups) }),
  reloadMaps: () => request<{ output: string; executedAt: string }>("/api/maps/reload", { method: "POST", body: JSON.stringify({ confirmMapRestart: true }) }),
  changeMap: (map: string) => request<{ output: string; executedAt: string }>("/api/maps/current", { method: "POST", body: JSON.stringify({ map, confirmMapChange: true }) }),
  setNextMap: (map: string | null) => request<{ output: string; executedAt: string }>("/api/maps/next", { method: "POST", body: JSON.stringify({ map }) }),
  workshopItem: (id: string) => request<WorkshopItem>(`/api/workshop/${encodeURIComponent(id)}`),
  workshopCollection: (id: string) => request<{ id: string; items: WorkshopItem[] }>(`/api/workshop/collection/${encodeURIComponent(id)}`),
  admins: () => request<AdminsResponse>("/api/admins"),
  addAdmin: (admin: { steamid: string; name: string; flags: string; immunity: number; groups: string[] }) => request<AdminsResponse & { write: ConfigWriteResult }>("/api/admins", { method: "POST", body: JSON.stringify(admin) }),
  updateAdmin: (steamid: string, patch: Partial<AdminEntry>) => request<AdminsResponse & { write: ConfigWriteResult }>(`/api/admins/${encodeURIComponent(steamid)}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteAdmin: (steamid: string) => request<AdminsResponse & { write: ConfigWriteResult }>(`/api/admins/${encodeURIComponent(steamid)}`, { method: "DELETE" }),
  putAdminGroups: (groups: Record<string, AdminGroup>) => request<AdminsResponse & { write: ConfigWriteResult }>("/api/admins/groups", { method: "PUT", body: JSON.stringify(groups) }),
  reloadAdmins: () => request<{ output: string; executedAt: string }>("/api/admins/reload", { method: "POST", body: "{}" }),
  migrateEnvAdmin: () => request<AdminsResponse & { write: ConfigWriteResult }>("/api/admins/migrate-env-steamid", { method: "POST", body: JSON.stringify({ confirm: true }) }),
  players: () => request<RconStatusResponse>("/api/players"),
  playerAction: (id: string, action: PlayerAction, options: { reason?: string; durationMinutes?: number; amount?: number } = {}) => request<PlayerActionResult>(`/api/players/${encodeURIComponent(id)}/${action}`, { method: "POST", body: JSON.stringify({ action, ...options }) }),
  playerClasses: () => request<PlayerClassesResponse>("/api/player-classes"),
  putPlayerClasses: (classes: PlayerClasses) => request<PlayerClassesResponse & { write: ConfigWriteResult }>("/api/player-classes", { method: "PUT", body: JSON.stringify({ classes }) }),
};
