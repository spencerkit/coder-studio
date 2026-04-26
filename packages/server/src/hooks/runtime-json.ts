import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * Runtime configuration stored in ~/.coder-studio/runtime.json
 * Used by bridge scripts to communicate with the server
 */
export interface RuntimeConfig {
  /** Server port (HTTP + WebSocket) */
  port: number;
  /** Server process ID */
  pid: number;
  /** Authentication token for internal hooks endpoint */
  token: string;
  /** Server instance ID (unique per server startup) */
  serverInstanceId: string;
  /** Server startup timestamp */
  startedAt: number;
}

/**
 * Reads runtime.json from disk
 * Returns null if file doesn't exist or is malformed
 */
export function readRuntimeConfig(): RuntimeConfig | null {
  const runtimePath = getRuntimePath();

  if (!existsSync(runtimePath)) {
    return null;
  }

  try {
    const content = readFileSync(runtimePath, 'utf-8');
    const config = JSON.parse(content) as RuntimeConfig;

    if (
      typeof config.port !== 'number' ||
      typeof config.pid !== 'number' ||
      typeof config.token !== 'string' ||
      typeof config.serverInstanceId !== 'string' ||
      typeof config.startedAt !== 'number'
    ) {
      return null;
    }

    return config;
  } catch {
    return null;
  }
}

/**
 * Writes runtime.json to disk atomically
 * Creates parent directory if it doesn't exist
 */
export function writeRuntimeConfig(config: RuntimeConfig): void {
  const runtimePath = getRuntimePath();
  const runtimeDir = join(homedir(), '.coder-studio');

  if (!existsSync(runtimeDir)) {
    mkdirSync(runtimeDir, { recursive: true });
  }

  writeFileSync(runtimePath, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Deletes runtime.json from disk
 * Used during server shutdown for clean state
 */
export function deleteRuntimeConfig(): void {
  const runtimePath = getRuntimePath();

  if (existsSync(runtimePath)) {
    unlinkSync(runtimePath);
  }
}

/**
 * Gets the path to runtime.json
 */
export function getRuntimePath(): string {
  return join(homedir(), '.coder-studio', 'runtime.json');
}
