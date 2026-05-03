/**
 * Config file I/O utilities
 *
 * Provides read/write operations for Codex and Claude config files with:
 * - Environment variable override for test isolation
 * - Atomic writes via temp file + rename
 * - Timestamped backups before modifications
 */

import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, basename } from 'node:path';
import { resolveCodexConfigPath } from './codex-config-audit.js';

export type ConfigType = 'codex' | 'claude';

export interface ConfigReadResult {
  /** Absolute path to the config file */
  configPath: string;
  /** File content (empty string if doesn't exist) */
  content: string;
  /** Whether the file exists */
  exists: boolean;
}

export interface ConfigWriteResult {
  /** Whether the write succeeded */
  success: boolean;
  /** Path to the backup file (null if no backup created) */
  backupPath: string | null;
  /** Error message if write failed */
  error?: string;
}

/**
 * Resolve config file path with environment variable override support.
 *
 * Priority for Codex:
 * 1. CODER_STUDIO_CODEX_HOME (test isolation)
 * 2. CODEX_HOME (existing behavior)
 * 3. ~/.codex (default)
 *
 * Priority for Claude:
 * 1. CODER_STUDIO_CLAUDE_HOME (test isolation)
 * 2. ~/.claude (default)
 */
export function resolveConfigPath(configType: ConfigType): string {
  if (configType === 'codex') {
    const testHome = process.env.CODER_STUDIO_CODEX_HOME;
    if (testHome && testHome.trim()) {
      return join(testHome, 'config.toml');
    }
    return resolveCodexConfigPath();
  }

  if (configType === 'claude') {
    const testHome = process.env.CODER_STUDIO_CLAUDE_HOME;
    if (testHome && testHome.trim()) {
      return join(testHome, 'settings.json');
    }
    return join(homedir(), '.claude', 'settings.json');
  }

  throw new Error(`Unknown config type: ${configType}`);
}

/**
 * Read config file content.
 *
 * Returns empty string if file doesn't exist.
 * Never throws - returns exists: false on any error.
 */
export function readConfigFile(configType: ConfigType): ConfigReadResult {
  const configPath = resolveConfigPath(configType);

  if (!existsSync(configPath)) {
    return { configPath, content: '', exists: false };
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    return { configPath, content, exists: true };
  } catch {
    return { configPath, content: '', exists: false };
  }
}

/**
 * Write config file with atomic write and backup.
 *
 * - Creates parent directory if needed
 * - Creates timestamped backup before overwrite
 * - Atomic write via .tmp file + rename
 */
export function writeConfigFile(
  configType: ConfigType,
  content: string
): ConfigWriteResult {
  try {
    const configPath = resolveConfigPath(configType);

    // Ensure parent directory exists
    const parentDir = dirname(configPath);
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }

    // Create backup if file exists
    let backupPath: string | null = null;
    if (existsSync(configPath)) {
      backupPath = createBackup(configPath);
    }

    // Atomic write
    const tempPath = `${configPath}.tmp`;
    writeFileSync(tempPath, content, 'utf-8');
    renameSync(tempPath, configPath);

    return { success: true, backupPath };
  } catch (error) {
    return {
      success: false,
      backupPath: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Create timestamped backup of a file.
 *
 * Format: <basename>.bak.<YYYYMMDD-HHmmss>.<ext>
 */
function createBackup(filePath: string): string {
  const original = readFileSync(filePath, 'utf-8');

  const ext = filePath.split('.').pop() ?? '';
  const base = basename(filePath, `.${ext}`);
  const dir = dirname(filePath);

  const ts = formatTimestamp(new Date());
  const backupPath = join(dir, `${base}.bak.${ts}.${ext}`);

  writeFileSync(backupPath, original, 'utf-8');
  return backupPath;
}

/**
 * Format timestamp for backup filename.
 *
 * Format: YYYYMMDD-HHmmss
 */
function formatTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}
