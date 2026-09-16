import fs from "node:fs/promises";
import { constants as FS } from "node:fs";
import path from "node:path";
import type { SetupError } from "@cs2ze/shared";
import { config } from "./config.js";
import { dockerAvailable, dockerInspect } from "./docker/cli.js";

/**
 * Compose project self-discovery and boot preflight.
 *
 * Bind-mount sources in compose.yaml resolve as HOST paths. For the panel to be
 * able to run `docker compose up -d --force-recreate cs2-server` against the host
 * daemon, the project directory must be mounted inside this container at the very
 * same absolute path -- otherwise `./cs2-data` would resolve to a directory the
 * daemon cannot see and the server would boot without its mods.
 *
 * Rather than trust configuration, this module proves the mount: it reads the
 * host project path out of the compose labels and then verifies that the compose
 * file is readable *inside this container at that same path*. A successful read
 * is the proof. On any failure the API refuses to serve and /api/health returns a
 * structured setupError instead of silently corrupting the stack.
 */

export interface ProjectInfo {
  projectName: string;
  workingDir: string;
  configFiles: string[];
  envFile: string;
}

let cached: ProjectInfo | null = null;
let setupError: SetupError | null = null;

const LABEL_PROJECT = "com.docker.compose.project";
const LABEL_WORKING_DIR = "com.docker.compose.project.working_dir";
const LABEL_CONFIG_FILES = "com.docker.compose.project.config_files";

interface InspectShape {
  Config?: { Labels?: Record<string, string> };
}

async function labelsOf(name: string): Promise<Record<string, string> | null> {
  const info = await dockerInspect<InspectShape>(name);
  return info?.Config?.Labels ?? null;
}

async function isWritable(p: string): Promise<boolean> {
  try {
    await fs.access(p, FS.W_OK);
    return true;
  } catch {
    return false;
  }
}

export async function runPreflight(): Promise<ProjectInfo | null> {
  setupError = null;
  cached = null;

  if (!(await dockerAvailable())) {
    setupError = {
      code: "docker_unavailable",
      message: "Cannot reach the Docker daemon",
      detail:
        "The panel needs /var/run/docker.sock mounted and its user in the docker group. " +
        "Check the `group_add` entry on the cs2-panel service matches the host's docker gid.",
    };
    return null;
  }

  // Prefer the panel's own container: it is definitely running, whereas
  // cs2-server may be stopped or not yet created on a fresh clone.
  let labels = await labelsOf(config.panelContainerName);
  let source = config.panelContainerName;
  if (!labels?.[LABEL_WORKING_DIR]) {
    labels = await labelsOf(config.cs2ContainerName);
    source = config.cs2ContainerName;
  }

  if (!labels) {
    setupError = {
      code: "container_not_found",
      message: "Could not find this stack's containers",
      detail:
        `Neither "${config.panelContainerName}" nor "${config.cs2ContainerName}" could be inspected. ` +
        "Set CS2_CONTAINER_NAME / PANEL_CONTAINER_NAME to match your CONTAINER_NAME in .env.",
    };
    return null;
  }

  const workingDir = config.projectDirOverride || labels[LABEL_WORKING_DIR] || "";
  const projectName = labels[LABEL_PROJECT] ?? "cs2ze";
  const configFilesRaw = labels[LABEL_CONFIG_FILES] ?? "";

  if (!workingDir) {
    setupError = {
      code: "missing_compose_labels",
      message: "Compose project labels are missing",
      detail:
        `Container "${source}" has no ${LABEL_WORKING_DIR} label, so the host project directory is unknown. ` +
        "Start the stack with `docker compose up -d`, or set CS2ZE_PROJECT_DIR explicitly.",
    };
    return null;
  }

  const configFiles = configFilesRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const resolved = configFiles.length > 0 ? configFiles : [path.join(workingDir, "compose.yaml")];

  // The proof: each compose file must be readable inside this container at its host path.
  for (const file of resolved) {
    try {
      await fs.access(file, FS.R_OK);
    } catch {
      setupError = {
        code: "project_dir_not_mounted",
        message: "The project directory is not mounted at its host path",
        detail:
          "The panel must bind-mount the project directory at the SAME absolute path it has on the host, " +
          "because compose resolves relative bind mounts as host paths. Check the cs2-panel service's " +
          "volume entry: source and target must be identical.",
        expected: file,
        actual: `not readable inside the panel container`,
      };
      return null;
    }
  }

  if (!(await isWritable(workingDir))) {
    setupError = {
      code: "project_dir_not_writable",
      message: "The project directory is not writable",
      detail:
        `${workingDir} must be writable by the panel (uid 1000) so it can update .env and server-config/. ` +
        "Check the mount is not read_only and that the directory is owned by 1000:1000.",
      expected: `${workingDir} writable by uid 1000`,
    };
    return null;
  }

  const envFile = path.join(workingDir, ".env");
  try {
    await fs.access(envFile, FS.R_OK | FS.W_OK);
  } catch {
    setupError = {
      code: "env_file_missing",
      message: ".env is missing or not writable",
      detail: `Expected a readable and writable .env at ${envFile}. Copy .env.example to .env first.`,
      expected: envFile,
    };
    return null;
  }

  cached = { projectName, workingDir, configFiles: resolved, envFile };
  return cached;
}

export function getProject(): ProjectInfo {
  if (!cached) throw new Error("Project preflight has not completed successfully");
  return cached;
}

export function getProjectOrNull(): ProjectInfo | null {
  return cached;
}

export function getSetupError(): SetupError | null {
  return setupError;
}

/** Absolute path inside the project directory, guarded against traversal. */
export function projectPath(...parts: string[]): string {
  const { workingDir } = getProject();
  const full = path.resolve(workingDir, ...parts);
  if (full !== workingDir && !full.startsWith(workingDir + path.sep)) {
    throw new Error(`Path escapes the project directory: ${full}`);
  }
  return full;
}
