import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

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

async function writeState(filePath: string, value: UpdateStateSnapshot): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(filePath, JSON.stringify(value, null, 2) + "\n", "utf-8")
  );
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

function runCommand(
  command: string,
  args: string[],
  options?: { stdio?: "ignore" | "pipe"; logStream?: NodeJS.WritableStream }
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: options?.stdio === "ignore" ? "ignore" : "pipe",
      env: process.env,
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
  }
): Promise<void> {
  const now = deps?.now ?? Date.now;
  await mkdir(dirname(input.logFilePath), { recursive: true });
  const logStream = createWriteStream(input.logFilePath, { flags: "a" });
  const execute = deps?.runCommand ?? runCommand;

  try {
    await execute(
      input.npmCommand,
      [...input.installArgsPrefix, `${input.packageName}@${input.targetVersion}`],
      { logStream }
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
    logStream.end();
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
    await execute(input.cliCommand, input.restartArgs, { logStream });
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
    logStream.end();
  }
}

if (process.env.CODER_STUDIO_UPDATE_STATE_PATH) {
  void runUpdateWorker().catch((error) => {
    console.error("[update-worker]", error);
    process.exitCode = 1;
  });
}
