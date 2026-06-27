/**
 * Workspace path validation and permission checks.
 */

import type { Workspace } from "@coder-studio/core";
import { constants } from "fs";
import { access, stat } from "fs/promises";
import type { CommandAvailabilityCheck } from "../provider-runtime/command-check.js";
import type { CommandRunner } from "../provider-runtime/command-runner.js";
import { listWslDistros } from "./wsl-discovery.js";
import { canonicalizeWslWorkspacePath } from "./wsl-paths.js";

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export interface WorkspaceValidationOptions {
  targetRuntime?: Workspace["targetRuntime"];
  wslDistro?: string;
  commandExists?: CommandAvailabilityCheck;
  runCommand?: CommandRunner;
}

/**
 * Validates that a path exists, is a directory, and is readable/writable.
 */
async function validateNativePath(path: string): Promise<ValidationResult> {
  try {
    // Check if path exists
    const stats = await stat(path);

    // Check if it's a directory
    if (!stats.isDirectory()) {
      return { valid: false, error: "Path is not a directory" };
    }

    // Check read permissions
    await access(path, constants.R_OK);

    // Check write permissions
    await access(path, constants.W_OK);

    return { valid: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { valid: false, error: "Path does not exist" };
    }
    if ((error as NodeJS.ErrnoException).code === "EACCES") {
      return { valid: false, error: "Permission denied" };
    }
    return { valid: false, error: `Validation failed: ${(error as Error).message}` };
  }
}

async function validateWslPath(
  path: string,
  options: WorkspaceValidationOptions
): Promise<ValidationResult> {
  const distro = options.wslDistro?.trim();
  if (!distro) {
    return { valid: false, error: "WSL distro is required" };
  }

  try {
    canonicalizeWslWorkspacePath(path, distro);
  } catch (error) {
    return { valid: false, error: (error as Error).message };
  }

  try {
    const distros = await listWslDistros({
      commandExists: options.commandExists,
      runCommand: options.runCommand,
    });

    if (distros.length === 0) {
      return { valid: false, error: "WSL is not available" };
    }

    if (!distros.includes(distro)) {
      return { valid: false, error: `WSL distro not found: ${distro}` };
    }

    return { valid: true };
  } catch (error) {
    return { valid: false, error: `Validation failed: ${(error as Error).message}` };
  }
}

export async function validatePath(
  path: string,
  options: WorkspaceValidationOptions = {}
): Promise<ValidationResult> {
  const targetRuntime = options.targetRuntime ?? "native";
  if (targetRuntime === "wsl") {
    return validateWslPath(path, options);
  }

  return validateNativePath(path);
}

/**
 * Validates workspace path with detailed error messages.
 */
export class WorkspaceValidator {
  constructor(private readonly defaults: WorkspaceValidationOptions = {}) {}

  async validate(path: string, options: WorkspaceValidationOptions = {}): Promise<void> {
    const result = await validatePath(path, { ...this.defaults, ...options });

    if (!result.valid) {
      throw new Error(`Invalid workspace path: ${result.error}`);
    }
  }
}
