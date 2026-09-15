import path from "node:path";

const num = (v: string | undefined, d: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

export const config = {
  port: num(process.env.PANEL_PORT, 8090),
  host: process.env.PANEL_HOST ?? "0.0.0.0",
  dataDir: process.env.PANEL_DATA_DIR ?? "/data",
  /** Read-only mount of cs2-data, used for live config comparison and game logs. */
  cs2DataDir: process.env.PANEL_CS2_DATA_DIR ?? "/srv/cs2-data",
  cs2ContainerName: process.env.CS2_CONTAINER_NAME ?? "cs2ze-server",
  cs2ServiceName: process.env.CS2_SERVICE_NAME ?? "cs2-server",
  panelContainerName: process.env.PANEL_CONTAINER_NAME ?? "cs2ze-server-panel",
  rconHost: process.env.PANEL_RCON_HOST ?? "cs2-server",
  rconPort: num(process.env.PANEL_RCON_PORT, 27050),
  cookieSecure: process.env.PANEL_COOKIE_SECURE === "1",
  trustProxy: process.env.PANEL_TRUST_PROXY === "1",
  bootstrapUser: process.env.PANEL_ADMIN_USER ?? "",
  bootstrapPassword: process.env.PANEL_ADMIN_PASSWORD ?? "",
  /** Explicit override for the project directory; normally discovered from compose labels. */
  projectDirOverride: process.env.CS2ZE_PROJECT_DIR ?? "",
  version: "1.0.0",
} as const;

export const dbPath = path.join(config.dataDir, "panel.db");
export const backupsDir = path.join(config.dataDir, "backups");
export const SESSION_COOKIE = "cs2ze_sid";
export const CSRF_HEADER = "x-cs2ze-csrf";
