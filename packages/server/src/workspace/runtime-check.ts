import {
  type CommandAvailabilityCheck,
  type CommandCheckDeps,
  checkCommandAvailable,
} from "../provider-runtime/command-check.js";
import { execFileAsString } from "../provider-runtime/exec-file.js";

export interface RuntimeCheckResult {
  ok: boolean;
  missing: string[];
}

export type TargetRuntime = "native" | "wsl";

export interface RuntimeCheckDeps extends CommandCheckDeps {
  commandExists?: CommandAvailabilityCheck;
}

async function checkGit(execRunner: RuntimeCheckDeps["execFile"]): Promise<boolean> {
  try {
    const runner = execRunner ?? execFileAsString;
    const { stdout } = await runner("git", ["--version"], { windowsHide: true });
    return stdout.includes("git version");
  } catch {
    return false;
  }
}

async function checkNode(execRunner: RuntimeCheckDeps["execFile"]): Promise<boolean> {
  try {
    const runner = execRunner ?? execFileAsString;
    const { stdout } = await runner("node", ["--version"], { windowsHide: true });
    return stdout.startsWith("v");
  } catch {
    return false;
  }
}

/**
 * Performs runtime checks for the target environment.
 *
 * @param _path - Workspace path (unused in Phase 1)
 * @param targetRuntime - Target runtime environment
 * @returns Runtime check result with list of missing tools
 */
export async function runtimeCheck(
  _path: string,
  targetRuntime: TargetRuntime,
  deps: RuntimeCheckDeps = {}
): Promise<RuntimeCheckResult> {
  const missing: string[] = [];
  const commandExists =
    deps.commandExists ?? ((command: string) => checkCommandAvailable(command, deps));

  const gitAvailable = await checkGit(deps.execFile);
  if (!gitAvailable) {
    missing.push("git");
  }

  const nodeAvailable = await checkNode(deps.execFile);
  if (!nodeAvailable) {
    missing.push("node");
  }

  if (targetRuntime === "wsl") {
    const wslAvailable = await commandExists("wsl");
    if (!wslAvailable) {
      missing.push("wsl");
    }
  }

  return {
    ok: missing.length === 0,
    missing,
  };
}

/**
 * Error thrown when runtime checks fail.
 */
export class RuntimeCheckFailedError extends Error {
  constructor(public readonly missing: string[]) {
    super(`Missing required tools: ${missing.join(", ")}`);
    this.name = "RuntimeCheckFailedError";
  }
}
