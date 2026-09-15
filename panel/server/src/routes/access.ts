import type { FastifyReply, FastifyRequest } from "fastify";
import { requireAuth, type RequestAuth } from "../auth/routes.js";
import { getSetupError } from "../project.js";

export function requireOperator(request: FastifyRequest, reply: FastifyReply): RequestAuth | null {
  const auth = requireAuth(request, reply);
  if (!auth) return null;
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

export function firstIssue(result: { success: false; error: { issues: Array<{ message: string }> } }, fallback: string): string {
  return result.error.issues[0]?.message ?? fallback;
}
