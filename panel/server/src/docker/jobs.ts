import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import type { Job, JobKind, SessionUser } from "@cs2ze/shared";
import { audit, findJob, finishJob, insertJob, listJobs, updateJobOutput } from "../db.js";
import {
  ComposeBusyError,
  composeOps,
  describeComposeOperation,
  isLifecycleBusy,
  withLifecycleLock,
} from "./compose.js";

const MAX_OUTPUT = 4 * 1024 * 1024;
const TRUNCATED = "[earlier output truncated]\n";
const events = new EventEmitter();
events.setMaxListeners(0);

function retainRecentOutput(current: string, chunk: string): string {
  const combined = current + chunk;
  if (combined.length <= MAX_OUTPUT) return combined;
  return TRUNCATED + combined.slice(-(MAX_OUTPUT - TRUNCATED.length));
}

function publish(id: string): void {
  const job = findJob(id);
  if (job) events.emit(id, job);
}

export function onJobUpdate(id: string, listener: (job: Job) => void): () => void {
  events.on(id, listener);
  return () => events.off(id, listener);
}

export { findJob as getJob, listJobs as getJobs };

export function startLifecycleJob(kind: JobKind, user: SessionUser): Job {
  // Reserve the process-wide lock synchronously before returning to Fastify so
  // two requests in the same event-loop turn cannot both create running jobs.
  if (isLifecycleBusy()) throw new ComposeBusyError();

  const job: Job = {
    id: crypto.randomUUID(),
    kind,
    state: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    command: describeComposeOperation(kind),
    output: "",
    startedBy: user.username,
  };
  insertJob(job);
  audit(user, `server.${kind}`, job.id, job.command);

  let output = "";
  const operation = withLifecycleLock(async () => {
    const result = await composeOps[kind]({
      onOutput: (chunk) => {
        output = retainRecentOutput(output, chunk);
        updateJobOutput(job.id, output);
        publish(job.id);
      },
    });
    const state = result.code === 0 ? "success" : "failed";
    finishJob(job.id, state, result.code, output);
    audit(user, `server.${kind}.${state}`, job.id, `exitCode=${result.code}`);
    publish(job.id);
  });

  void operation.catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    output = retainRecentOutput(output, `${output && !output.endsWith("\n") ? "\n" : ""}[panel] ${message}\n`);
    finishJob(job.id, "failed", -1, output);
    audit(user, `server.${kind}.failed`, job.id, message);
    publish(job.id);
  });

  return job;
}
