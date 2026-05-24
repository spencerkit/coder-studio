import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

interface UpdateStateSnapshot {
  version: 1;
  currentVersion: string;
  latestVersion: string | null;
  availability: "unknown" | "up_to_date" | "update_available" | "check_failed";
  updateStatus:
    | "idle"
    | "checking"
    | "installing"
    | "restarting"
    | "succeeded"
    | "failed"
    | "manual_required";
  lastCheckedAt: number | null;
  targetVersion: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  requiresManualStep: boolean;
  manualCommand: string | null;
  errorSummary: string | null;
}

interface WorkerEnv {
  stateFilePath: string;
  logFilePath: string;
  packageName: string;
  targetVersion: string;
  cliCommand: string;
  currentVersion: string;
  npmCommand: string;
  restartArgs: string[];
  installArgsPrefix: string[];
}

type WorkerMode = "install" | "restart-handoff";

const RESTART_HANDOFF_MODE: WorkerMode = "restart-handoff";
const DEFAULT_MODE: WorkerMode = "install";
const RESTART_HANDOFF_WAIT_MS = 5_000;
const WORKER_ENTRY_PATH = fileURLToPath(import.meta.url);

async function writeState(filePath: string, value: UpdateStateSnapshot): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(filePath, JSON.stringify(value, null, 2) + "\n", "utf-8")
  );
}

function closeLogStream(stream: NodeJS.WritableStream): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.once("error", reject);
    stream.end(() => {
      stream.off("error", reject);
      resolve();
    });
  });
}

function parseJsonArray(value: string | undefined, fallback: string[]): string[] {
  if (!value) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return parsed;
    }
  } catch {}
  return fallback;
}

function readEnv(env = process.env): WorkerEnv {
  const stateFilePath = env.CODER_STUDIO_UPDATE_STATE_PATH;
  const logFilePath = env.CODER_STUDIO_UPDATE_LOG_PATH;
  const packageName = env.CODER_STUDIO_UPDATE_PACKAGE_NAME;
  const targetVersion = env.CODER_STUDIO_UPDATE_TARGET_VERSION;
  const cliCommand = env.CODER_STUDIO_UPDATE_CLI_COMMAND;
  const currentVersion = env.CODER_STUDIO_UPDATE_CURRENT_VERSION;
  if (
    !stateFilePath ||
    !logFilePath ||
    !packageName ||
    !targetVersion ||
    !cliCommand ||
    !currentVersion
  ) {
    throw new Error("Missing detached update worker environment");
  }
  return {
    stateFilePath,
    logFilePath,
    packageName,
    targetVersion,
    cliCommand,
    currentVersion,
    npmCommand: env.CODER_STUDIO_UPDATE_NPM_COMMAND || "npm",
    restartArgs: parseJsonArray(env.CODER_STUDIO_UPDATE_RESTART_ARGS, ["serve", "--restart"]),
    installArgsPrefix: parseJsonArray(env.CODER_STUDIO_UPDATE_INSTALL_ARGS_PREFIX, [
      "install",
      "-g",
    ]),
  };
}

function buildManualCommand(input: WorkerEnv): string {
  return [
    `${input.npmCommand} ${[...input.installArgsPrefix, `${input.packageName}@${input.targetVersion}`].join(" ")}`,
    `${input.cliCommand} ${input.restartArgs.join(" ")}`,
  ].join("\n");
}

function readWorkerMode(env = process.env): WorkerMode {
  return env.CODER_STUDIO_UPDATE_WORKER_MODE === RESTART_HANDOFF_MODE
    ? RESTART_HANDOFF_MODE
    : DEFAULT_MODE;
}

function readRestartParentPid(env = process.env): number | null {
  const raw = env.CODER_STUDIO_UPDATE_PARENT_PID;
  if (!raw) {
    return null;
  }

  const pid = Number.parseInt(raw, 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

const INTERNAL_ENV_KEYS = new Set([
  "CODER_STUDIO_RUNTIME_JSON_PATH",
  "CODER_STUDIO_SESSION_ID",
  "NODE_APP_INSTANCE",
  "NODE_CHANNEL_FD",
  "NODE_CHANNEL_SERIALIZATION_MODE",
  "PM2_INTERACTOR_PROCESSING",
  "PM2_JSON_PROCESSING",
  "PM2_PROGRAMMATIC",
]);

function buildChildProcessEnv(env = process.env): NodeJS.ProcessEnv {
  const nextEnv: NodeJS.ProcessEnv = { ...env };

  for (const key of Object.keys(nextEnv)) {
    if (INTERNAL_ENV_KEYS.has(key)) {
      delete nextEnv[key];
      continue;
    }

    if (key.startsWith("CODER_STUDIO_UPDATE_") || key.startsWith("pm_")) {
      delete nextEnv[key];
    }
  }

  return nextEnv;
}

function buildWorkerEnv(input: WorkerEnv): NodeJS.ProcessEnv {
  return {
    CODER_STUDIO_UPDATE_STATE_PATH: input.stateFilePath,
    CODER_STUDIO_UPDATE_LOG_PATH: input.logFilePath,
    CODER_STUDIO_UPDATE_PACKAGE_NAME: input.packageName,
    CODER_STUDIO_UPDATE_TARGET_VERSION: input.targetVersion,
    CODER_STUDIO_UPDATE_CLI_COMMAND: input.cliCommand,
    CODER_STUDIO_UPDATE_CURRENT_VERSION: input.currentVersion,
    CODER_STUDIO_UPDATE_NPM_COMMAND: input.npmCommand,
    CODER_STUDIO_UPDATE_RESTART_ARGS: JSON.stringify(input.restartArgs),
    CODER_STUDIO_UPDATE_INSTALL_ARGS_PREFIX: JSON.stringify(input.installArgsPrefix),
  };
}

function spawnDetachedProcess(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      env,
    });

    child.on("error", reject);
    child.unref();
    resolve();
  });
}

const isMissingProcessError = (error: unknown): boolean =>
  Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ESRCH"
  );

async function waitForProcessExit(pid: number, waitMs = RESTART_HANDOFF_WAIT_MS): Promise<void> {
  const deadline = Date.now() + waitMs;

  while (Date.now() <= deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (isMissingProcessError(error)) {
        return;
      }

      throw error;
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      break;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, Math.min(100, remainingMs));
    });
  }
}

function runCommand(
  command: string,
  args: string[],
  options?: {
    stdio?: "ignore" | "pipe";
    logStream?: NodeJS.WritableStream;
    env?: NodeJS.ProcessEnv;
  }
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: options?.stdio === "ignore" ? "ignore" : "pipe",
      env: options?.env ?? process.env,
    });

    if (options?.logStream && child.stdout) {
      child.stdout.pipe(options.logStream, { end: false });
    }
    if (options?.logStream && child.stderr) {
      child.stderr.pipe(options.logStream, { end: false });
    }

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code ?? 1}`));
    });
  });
}

export async function runUpdateWorker(
  input = readEnv(),
  deps?: {
    runCommand?: typeof runCommand;
    now?: () => number;
    processId?: number;
    spawnDetachedProcess?: typeof spawnDetachedProcess;
  }
): Promise<void> {
  const now = deps?.now ?? Date.now;
  await mkdir(dirname(input.logFilePath), { recursive: true });
  const logStream = createWriteStream(input.logFilePath, { flags: "a" });
  const execute = deps?.runCommand ?? runCommand;
  const childEnv = buildChildProcessEnv(process.env);
  const processId = deps?.processId ?? process.pid;
  const spawnRestartHandoff = deps?.spawnDetachedProcess ?? spawnDetachedProcess;

  try {
    await execute(
      input.npmCommand,
      [...input.installArgsPrefix, `${input.packageName}@${input.targetVersion}`],
      { logStream, env: childEnv }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const permissionRelated =
      /EACCES|EPERM|permission|not permitted/i.test(message) ||
      /requires elevated privileges/i.test(message);
    await writeState(input.stateFilePath, {
      version: 1,
      currentVersion: input.currentVersion,
      latestVersion: input.targetVersion,
      availability: "update_available",
      updateStatus: permissionRelated ? "manual_required" : "failed",
      lastCheckedAt: now(),
      targetVersion: input.targetVersion,
      startedAt: now(),
      finishedAt: now(),
      requiresManualStep: permissionRelated,
      manualCommand: permissionRelated ? buildManualCommand(input) : null,
      errorSummary: message,
    });
    await closeLogStream(logStream);
    return;
  }

  await writeState(input.stateFilePath, {
    version: 1,
    currentVersion: input.currentVersion,
    latestVersion: input.targetVersion,
    availability: "update_available",
    updateStatus: "restarting",
    lastCheckedAt: now(),
    targetVersion: input.targetVersion,
    startedAt: now(),
    finishedAt: null,
    requiresManualStep: false,
    manualCommand: null,
    errorSummary: null,
  });

  try {
    await spawnRestartHandoff(process.execPath, [WORKER_ENTRY_PATH], {
      ...childEnv,
      ...buildWorkerEnv(input),
      CODER_STUDIO_UPDATE_WORKER_MODE: RESTART_HANDOFF_MODE,
      CODER_STUDIO_UPDATE_PARENT_PID: String(processId),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeState(input.stateFilePath, {
      version: 1,
      currentVersion: input.currentVersion,
      latestVersion: input.targetVersion,
      availability: "update_available",
      updateStatus: "failed",
      lastCheckedAt: now(),
      targetVersion: input.targetVersion,
      startedAt: now(),
      finishedAt: now(),
      requiresManualStep: true,
      manualCommand: `${input.cliCommand} ${input.restartArgs.join(" ")}`,
      errorSummary: `new version installed but service restart failed: ${message}`,
    });
  } finally {
    await closeLogStream(logStream);
  }
}

export async function runRestartHandoff(
  input = readEnv(),
  deps?: {
    runCommand?: typeof runCommand;
    now?: () => number;
    waitForProcessExit?: typeof waitForProcessExit;
    restartParentPid?: number | null;
  }
): Promise<void> {
  const now = deps?.now ?? Date.now;
  await mkdir(dirname(input.logFilePath), { recursive: true });
  const logStream = createWriteStream(input.logFilePath, { flags: "a" });
  const execute = deps?.runCommand ?? runCommand;
  const waitForParentExit = deps?.waitForProcessExit ?? waitForProcessExit;
  const childEnv = buildChildProcessEnv(process.env);
  const restartParentPid = deps?.restartParentPid ?? readRestartParentPid(process.env);

  try {
    if (restartParentPid !== null) {
      await waitForParentExit(restartParentPid);
    }

    await execute(input.cliCommand, input.restartArgs, { logStream, env: childEnv });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeState(input.stateFilePath, {
      version: 1,
      currentVersion: input.currentVersion,
      latestVersion: input.targetVersion,
      availability: "update_available",
      updateStatus: "failed",
      lastCheckedAt: now(),
      targetVersion: input.targetVersion,
      startedAt: now(),
      finishedAt: now(),
      requiresManualStep: true,
      manualCommand: `${input.cliCommand} ${input.restartArgs.join(" ")}`,
      errorSummary: `new version installed but service restart failed: ${message}`,
    });
  } finally {
    await closeLogStream(logStream);
  }
}

if (process.env.CODER_STUDIO_UPDATE_STATE_PATH) {
  const run =
    readWorkerMode(process.env) === RESTART_HANDOFF_MODE ? runRestartHandoff : runUpdateWorker;

  void run().catch((error) => {
    console.error("[update-worker]", error);
    process.exitCode = 1;
  });
}
