import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'fs';
import { dirname, join } from 'path';
import type { HooksDescriptor, ManagedHooks } from '@coder-studio/core';

/**
 * Result of a merge-write operation
 */
export interface MergeWriteResult {
  success: boolean;
  backupPath?: string;
  error?: string;
}

/**
 * Merges managed hooks into existing provider config
 * CRITICAL: Preserves all user-defined configuration
 *
 * @param configPath - Path to provider's global config file
 * @param hooksDescriptor - Provider's hooks descriptor
 * @param managedHooks - Managed hooks to inject
 * @param backupDir - Directory to store backups
 * @returns Result of the operation
 */
export function mergeWriteConfig(
  configPath: string,
  hooksDescriptor: HooksDescriptor,
  managedHooks: ManagedHooks,
  backupDir: string
): MergeWriteResult {
  try {
    // Read existing config (or empty object if doesn't exist)
    let existingConfig: unknown = {};

    if (existsSync(configPath)) {
      try {
        const content = readFileSync(configPath, 'utf-8');
        existingConfig = JSON.parse(content);
      } catch {
        // If file exists but is malformed, start with empty object
        existingConfig = {};
      }
    }

    // Check if upgrade is needed
    const currentManaged = hooksDescriptor.extractManaged(existingConfig);

    if (currentManaged && hooksDescriptor.markerVersion === hooksDescriptor.markerVersion) {
      // Already up to date, skip
      return { success: true };
    }

    // Backup existing config if it exists
    let backupPath: string | undefined;
    if (existsSync(configPath)) {
      const timestamp = Date.now();
      const providerId = configPath.split('/').pop()?.split('.')[0] || 'unknown';
      backupPath = `${backupDir}/${providerId}-${timestamp}.json`;

      // Ensure backup directory exists
      if (!existsSync(backupDir)) {
        mkdirSync(backupDir, { recursive: true });
      }

      // Copy existing config to backup
      const existingContent = readFileSync(configPath, 'utf-8');
      writeFileSync(backupPath, existingContent, 'utf-8');
    }

    // Merge managed hooks into existing config
    const mergedConfig = hooksDescriptor.mergeInto(existingConfig, managedHooks);

    // Ensure parent directory exists
    const configDir = dirname(configPath);
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }

    // Atomic write: write to temp file then rename
    const tempPath = `${configPath}.tmp`;
    writeFileSync(tempPath, JSON.stringify(mergedConfig, null, 2), 'utf-8');

    // Rename temp to final (atomic on most filesystems)
    renameSync(tempPath, configPath);

    return { success: true, backupPath };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Reads a config file and returns its contents
 * Returns null if file doesn't exist or is malformed
 */
export function readConfigFile(configPath: string): unknown | null {
  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}
