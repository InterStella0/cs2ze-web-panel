import crypto from "node:crypto";
import fs from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import type { Job, JobKind, JobState, Role, SessionUser } from "@cs2ze/shared";
import { config, dbPath } from "./config.js";
import { hashPassword } from "./auth/password.js";

let database: DatabaseSync | null = null;

function db(): DatabaseSync {
  if (!database) throw new Error("Database is not initialized");
  return database;
}

export async function initDatabase(): Promise<void> {
  await fs.mkdir(config.dataDir, { recursive: true });
  database = new DatabaseSync(dbPath);
  await fs.chmod(dbPath, 0o600);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('owner', 'operator')),
      must_change_password INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      csrf_token TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      refreshed_at INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS login_failures (
      scope TEXT NOT NULL,
      identity TEXT NOT NULL,
      failures INTEGER NOT NULL,
      blocked_until INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (scope, identity)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      username TEXT,
      action TEXT NOT NULL,
      target TEXT,
      detail TEXT,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('start', 'stop', 'restart', 'apply', 'pull')),
      state TEXT NOT NULL CHECK (state IN ('running', 'success', 'failed')),
      started_at TEXT NOT NULL,
      finished_at TEXT,
      exit_code INTEGER,
      command TEXT NOT NULL,
      output TEXT NOT NULL DEFAULT '',
      started_by TEXT NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS audit_created_idx ON audit(created_at DESC);
    CREATE INDEX IF NOT EXISTS jobs_started_idx ON jobs(started_at DESC);
  `);

  // A process exit necessarily terminates the child process that owned these
  // jobs. Leaving them as "running" would permanently lie to the UI.
  database.prepare(`
    UPDATE jobs
    SET state = 'failed', finished_at = ?, exit_code = -1,
        output = output || CASE WHEN output = '' THEN '' ELSE char(10) END || ?
    WHERE state = 'running'
  `).run(new Date().toISOString(), "[panel restarted before this operation completed]");
}

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: Role;
  must_change_password: number;
}

export function findUser(username: string): UserRow | null {
  return (db().prepare(
    "SELECT id, username, password_hash, role, must_change_password FROM users WHERE username = ?",
  ).get(username) as unknown as UserRow | undefined) ?? null;
}

export async function bootstrapOwner(): Promise<void> {
  const row = db().prepare("SELECT COUNT(*) AS count FROM users").get() as unknown as { count: number };
  if (row.count > 0) return;

  const configuredUser = config.bootstrapUser.trim();
  const configuredPassword = config.bootstrapPassword;
  if ((configuredUser === "") !== (configuredPassword === "")) {
    throw new Error("PANEL_ADMIN_USER and PANEL_ADMIN_PASSWORD must either both be set or both be empty");
  }

  const username = configuredUser || "admin";
  const password = configuredPassword || crypto.randomBytes(18).toString("base64url");
  if (!/^[a-zA-Z0-9_.-]{3,64}$/.test(username)) {
    throw new Error("PANEL_ADMIN_USER must be 3-64 characters using letters, digits, dot, underscore, or dash");
  }
  if (password.length < 12) throw new Error("PANEL_ADMIN_PASSWORD must be at least 12 characters");

  const passwordHash = await hashPassword(password);
  db().prepare(
    "INSERT INTO users (username, password_hash, role, must_change_password, created_at) VALUES (?, ?, 'owner', 1, ?)",
  ).run(username, passwordHash, new Date().toISOString());

  if (configuredPassword) {
    console.warn("[cs2ze-panel] Bootstrap owner created. Remove PANEL_ADMIN_PASSWORD from .env after first login.");
  } else {
    console.warn(`[cs2ze-panel] Bootstrap login (shown once): ${username} / ${password}`);
  }
}

const sha256 = (value: string): string => crypto.createHash("sha256").update(value).digest("hex");
const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const REFRESH_INTERVAL_MS = 60 * 60 * 1000;

export interface SessionRecord {
  token: string;
  csrfToken: string;
  user: SessionUser;
}

export function createSession(userId: number): SessionRecord {
  const token = crypto.randomBytes(32).toString("base64url");
  const csrfToken = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  db().prepare(
    "INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at, refreshed_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(sha256(token), userId, csrfToken, now, now + SESSION_LIFETIME_MS, now);
  const user = findUserById(userId);
  if (!user) throw new Error("Session user disappeared");
  return { token, csrfToken, user: publicUser(user) };
}

function findUserById(id: number): UserRow | null {
  return (db().prepare(
    "SELECT id, username, password_hash, role, must_change_password FROM users WHERE id = ?",
  ).get(id) as unknown as UserRow | undefined) ?? null;
}

function publicUser(user: UserRow): SessionUser {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    mustChangePassword: user.must_change_password === 1,
  };
}

export function resolveSession(token: string): Omit<SessionRecord, "token"> | null {
  const now = Date.now();
  const row = db().prepare(`
    SELECT s.csrf_token, s.expires_at, s.refreshed_at,
           u.id, u.username, u.password_hash, u.role, u.must_change_password
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).get(sha256(token), now) as unknown as (UserRow & {
    csrf_token: string;
    expires_at: number;
    refreshed_at: number;
  }) | undefined;
  if (!row) return null;

  if (now - row.refreshed_at >= REFRESH_INTERVAL_MS) {
    db().prepare("UPDATE sessions SET expires_at = ?, refreshed_at = ? WHERE token_hash = ?")
      .run(now + SESSION_LIFETIME_MS, now, sha256(token));
  }
  return { csrfToken: row.csrf_token, user: publicUser(row) };
}

export function deleteSession(token: string): void {
  db().prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
}

export async function changeUserPassword(userId: number, password: string): Promise<void> {
  const passwordHash = await hashPassword(password);
  db().exec("BEGIN IMMEDIATE");
  try {
    db().prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?")
      .run(passwordHash, userId);
    db().prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
    db().exec("COMMIT");
  } catch (error) {
    db().exec("ROLLBACK");
    throw error;
  }
}

interface FailureRow { failures: number; blocked_until: number; updated_at: number }

function failure(scope: string, identity: string): FailureRow | null {
  return (db().prepare(
    "SELECT failures, blocked_until, updated_at FROM login_failures WHERE scope = ? AND identity = ?",
  ).get(scope, identity.toLowerCase()) as unknown as FailureRow | undefined) ?? null;
}

export function retryAfterSeconds(ip: string, username: string): number {
  const now = Date.now();
  const rows = [failure("ip", ip), failure("username", username)];
  return Math.max(0, ...rows.map((row) => row ? Math.ceil((row.blocked_until - now) / 1000) : 0));
}

export function recordLoginFailure(ip: string, username: string): void {
  const now = Date.now();
  const identities: Array<[string, string]> = [["ip", ip], ["username", username.toLowerCase()]];
  for (const [scope, identity] of identities) {
    const old = failure(scope, identity);
    const failures = old && now - old.updated_at < 24 * 60 * 60 * 1000 ? old.failures + 1 : 1;
    const delay = failures >= 5 ? Math.min(30_000 * 2 ** (failures - 5), 15 * 60_000) : 0;
    db().prepare(`
      INSERT INTO login_failures (scope, identity, failures, blocked_until, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(scope, identity) DO UPDATE SET
        failures = excluded.failures, blocked_until = excluded.blocked_until, updated_at = excluded.updated_at
    `).run(scope, identity, failures, now + delay, now);
  }
}

export function clearLoginFailures(ip: string, username: string): void {
  db().prepare("DELETE FROM login_failures WHERE (scope = 'ip' AND identity = ?) OR (scope = 'username' AND identity = ?)")
    .run(ip, username.toLowerCase());
}

export function audit(user: SessionUser | null, action: string, target?: string, detail?: string): void {
  db().prepare(
    "INSERT INTO audit (user_id, username, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(user?.id ?? null, user?.username ?? null, action, target ?? null, detail ?? null, new Date().toISOString());
}

interface JobRow {
  id: string;
  kind: JobKind;
  state: JobState;
  started_at: string;
  finished_at: string | null;
  exit_code: number | null;
  command: string;
  output: string;
  started_by: string;
}

function publicJob(row: JobRow): Job {
  return {
    id: row.id,
    kind: row.kind,
    state: row.state,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    exitCode: row.exit_code,
    command: row.command,
    output: row.output,
    startedBy: row.started_by,
  };
}

export function insertJob(job: Job): void {
  db().prepare(`
    INSERT INTO jobs (id, kind, state, started_at, finished_at, exit_code, command, output, started_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    job.id, job.kind, job.state, job.startedAt, job.finishedAt, job.exitCode,
    job.command, job.output, job.startedBy,
  );
}

export function updateJobOutput(id: string, output: string): void {
  db().prepare("UPDATE jobs SET output = ? WHERE id = ?").run(output, id);
}

export function finishJob(id: string, state: Exclude<JobState, "running">, exitCode: number, output: string): void {
  db().prepare("UPDATE jobs SET state = ?, finished_at = ?, exit_code = ?, output = ? WHERE id = ?")
    .run(state, new Date().toISOString(), exitCode, output, id);
}

export function findJob(id: string): Job | null {
  const row = db().prepare(`
    SELECT id, kind, state, started_at, finished_at, exit_code, command, output, started_by
    FROM jobs WHERE id = ?
  `).get(id) as unknown as JobRow | undefined;
  return row ? publicJob(row) : null;
}

export function listJobs(limit = 50): Job[] {
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  const rows = db().prepare(`
    SELECT id, kind, state, started_at, finished_at, exit_code, command, output, started_by
    FROM jobs ORDER BY started_at DESC LIMIT ?
  `).all(safeLimit) as unknown as JobRow[];
  return rows.map(publicJob);
}

/**
 * Panel-owned key/value settings. These belong in the panel database rather
 * than .env because they configure the panel itself, and writing them must not
 * mark the game-server container as needing a recreate.
 */
export function getSetting(key: string): string | null {
  const row = db().prepare("SELECT value FROM settings WHERE key = ?").get(key) as unknown as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db().prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value, new Date().toISOString());
}

export function closeDatabase(): void {
  database?.close();
  database = null;
}
