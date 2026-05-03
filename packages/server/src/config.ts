/**
 * Server Configuration
 *
 * Parses CLI args and environment variables.
 *
 * Database path resolution:
 * - Development: uses OS temp directory so SQLite files stay out of the repo
 * - Production: uses ~/.coder-studio/data/coder-studio.db by default
 */

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export interface ServerConfig {
  host: string;
  port: number;
  dataDir: string;
  runtimeDir: string;
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  webRoot?: string;
  auth: {
    enabled: boolean;
    password?: string;
  };
  /**
   * Whether to persist the per-process runtime handshake ({port, token,
   * serverInstanceId, startedAt}) to `~/.coder-studio/runtime.json`.
   *
   * The bridge scripts deployed into Claude/Codex global configs read this
   * file to locate the running server and authenticate hook events. It must
   * be `true` for the hook chain (SessionStart, agent-turn-complete, …) to
   * work end-to-end.
   *
   * Tests set it to `false` to avoid racing on the shared `~/.coder-studio/`
   * directory when multiple `createServer` instances run in parallel.
   *
   * Defaults: `true` normally; `false` when the server is invoked from a
   * vitest run (detected via VITEST/NODE_ENV=test).
   */
  writeRuntime: boolean;
}

/**
 * Resolve the database file path.
 *
 * In development (NODE_ENV !== 'production') the DB is placed in the OS temp
 * directory so it never pollutes the working tree. In production the path
 * defaults to ~/.coder-studio/data/coder-studio.db and can be overridden via
 * the DATA_DIR env var.
 */
function resolveDbPath(explicit?: string): string {
  if (explicit) return explicit;
  if (process.env.NODE_ENV !== 'production') {
    return path.join(os.tmpdir(), 'coder-studio-dev.db');
  }
  return path.join(os.homedir(), '.coder-studio', 'data', 'coder-studio.db');
}

/**
 * Parse server configuration from environment and CLI args
 */
export function parseServerConfig(overrides?: Partial<ServerConfig>): ServerConfig {
  const noAuth = process.env.NO_AUTH === 'true';
  const password = process.env.AUTH_PASSWORD;
  const dataDir = resolveDbPath(overrides?.dataDir || process.env.DATA_DIR);
  const isTestRun =
    process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';

  // NOTE: use `??` on port so callers can pass 0 to request an
  // OS-assigned port. `||` would silently fall through to 4173 for port=0.
  return {
    host: overrides?.host || process.env.HOST || 'localhost',
    port: overrides?.port ?? parseInt(process.env.PORT || '4173', 10),
    dataDir,
    runtimeDir: overrides?.runtimeDir || process.env.RUNTIME_DIR || './runtime',
    logLevel: overrides?.logLevel || (process.env.LOG_LEVEL as any) || 'info',
    webRoot: overrides?.webRoot,
    auth: overrides?.auth || {
      enabled: !noAuth && !!password,
      password,
    },
    writeRuntime: overrides?.writeRuntime ?? !isTestRun,
  };
}

/**
 * Ensure the database parent directory exists for file-backed databases.
 */
export function ensureDataDir(config: ServerConfig): void {
  if (config.dataDir === ':memory:') {
    return;
  }

  fs.mkdirSync(path.dirname(config.dataDir), { recursive: true });
}
