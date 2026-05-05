/**
 * Workspace path validation and permission checks.
 */

import { constants } from "fs";
import { access, stat } from "fs/promises";

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates that a path exists, is a directory, and is readable/writable.
 */
export async function validatePath(path: string): Promise<ValidationResult> {
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

/**
 * Validates workspace path with detailed error messages.
 */
export class WorkspaceValidator {
  async validate(path: string): Promise<void> {
    const result = await validatePath(path);

    if (!result.valid) {
      throw new Error(`Invalid workspace path: ${result.error}`);
    }
  }
}
