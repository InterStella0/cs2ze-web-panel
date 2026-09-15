import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { changePasswordSchema, loginSchema, type AuthResponse, type SessionUser } from "@cs2ze/shared";
import { config, CSRF_HEADER, SESSION_COOKIE } from "../config.js";
import {
  audit,
  changeUserPassword,
  clearLoginFailures,
  createSession,
  deleteSession,
  findUser,
  recordLoginFailure,
  resolveSession,
  retryAfterSeconds,
} from "../db.js";
import { hashPassword, verifyPassword } from "./password.js";

const COOKIE_MAX_AGE = 30 * 24 * 60 * 60;
let dummyPasswordHash = "";

const cookieOptions = {
  httpOnly: true,
  sameSite: "strict" as const,
  secure: config.cookieSecure,
  path: "/",
  maxAge: COOKIE_MAX_AGE,
};

export interface RequestAuth {
  user: SessionUser;
  csrfToken: string;
  rawToken: string;
}

export function requestAuth(request: FastifyRequest): RequestAuth | null {
  const rawToken = request.cookies[SESSION_COOKIE];
  if (!rawToken) return null;
  const session = resolveSession(rawToken);
  return session ? { ...session, rawToken } : null;
}

export function requireAuth(request: FastifyRequest, reply: FastifyReply): RequestAuth | null {
  const auth = requestAuth(request);
  if (!auth) {
    void reply.code(401).send({ error: "Authentication required" });
    return null;
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const csrf = request.headers[CSRF_HEADER];
    if (typeof csrf !== "string" || csrf !== auth.csrfToken) {
      void reply.code(403).send({ error: "Invalid CSRF token" });
      return null;
    }
  }
  return auth;
}

function authResponse(auth: { user: SessionUser; csrfToken: string }): AuthResponse {
  return { user: auth.user, csrfToken: auth.csrfToken };
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  dummyPasswordHash = await hashPassword("not-a-real-panel-password");

  app.post("/api/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Username and password are required" });

    const { username, password } = parsed.data;
    const retryAfter = retryAfterSeconds(request.ip, username);
    if (retryAfter > 0) {
      return reply.code(429).header("Retry-After", String(retryAfter)).send({
        error: `Too many failed logins. Try again in ${retryAfter} seconds.`,
      });
    }

    const user = findUser(username);
    const valid = await verifyPassword(password, user?.password_hash ?? dummyPasswordHash);
    if (!user || !valid) {
      recordLoginFailure(request.ip, username);
      audit(null, "auth.login_failed", username, request.ip);
      return reply.code(401).send({ error: "Invalid username or password" });
    }

    clearLoginFailures(request.ip, user.username);
    const session = createSession(user.id);
    reply.setCookie(SESSION_COOKIE, session.token, cookieOptions);
    audit(session.user, "auth.login", undefined, request.ip);
    return authResponse(session);
  });

  app.get("/api/auth/me", async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) return;
    return authResponse(auth);
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) return;
    deleteSession(auth.rawToken);
    audit(auth.user, "auth.logout");
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.code(204).send();
  });

  app.post("/api/auth/password", async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) return;
    const parsed = changePasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid password" });
    }

    const user = findUser(auth.user.username);
    if (!user || !(await verifyPassword(parsed.data.currentPassword, user.password_hash))) {
      return reply.code(400).send({ error: "Current password is incorrect" });
    }

    await changeUserPassword(user.id, parsed.data.newPassword);
    const session = createSession(user.id);
    reply.setCookie(SESSION_COOKIE, session.token, cookieOptions);
    audit(session.user, "auth.password_changed");
    return authResponse(session);
  });
}
