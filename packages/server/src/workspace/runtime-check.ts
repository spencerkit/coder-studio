/**
 * Runtime environment checks for git, node, and provider CLI availability.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface RuntimeCheckResult {
  ok: boolean;
  missing: string[];
}

export type TargetRuntime = 'native' | 'wsl';

/**
 * Checks if a command is available in PATH.
 */
async function isCommandAvailable(command: string): Promise<boolean> {
  try {
    await execFileAsync('which', [command]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks if git is available and validates basic functionality.
 */
async function checkGit(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('git', ['--version']);
    return stdout.includes('git version');
  } catch {
    return false;
  }
}

/**
 * Checks if node is available.
 */
async function checkNode(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('node', ['--version']);
    return stdout.startsWith('v');
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
  targetRuntime: TargetRuntime
): Promise<RuntimeCheckResult> {
  const missing: string[] = [];

  // Check git availability (required for all runtimes)
  const gitAvailable = await checkGit();
  if (!gitAvailable) {
    missing.push('git');
  }

  // Check node availability (required for all runtimes)
  const nodeAvailable = await checkNode();
  if (!nodeAvailable) {
    missing.push('node');
  }

  // WSL-specific checks
  if (targetRuntime === 'wsl') {
    const wslAvailable = await isCommandAvailable('wsl');
    if (!wslAvailable) {
      missing.push('wsl');
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
    super(`Missing required tools: ${missing.join(', ')}`);
    this.name = 'RuntimeCheckFailedError';
  }
}
