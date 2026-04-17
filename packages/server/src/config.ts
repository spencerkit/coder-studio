/**
 * Server Configuration
 *
 * Parses CLI args and environment variables.
 *
 * Database path resolution:
 * - Development: uses OS temp directory so SQLite files stay out of the repo
 * - Production: uses CWD-relative path (configurable via DATA_DIR env)
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
}

/**
 * Resolve the database file path.
 *
 * In development (NODE_ENV !== 'production') the DB is placed in the OS temp
 * directory so it never pollutes the working tree.  In production the path
 * defaults to `<cwd>/data` and can be overridden via the DATA_DIR env var.
 */
function resolveDbPath(explicit?: string): string {
  if (explicit) return explicit;
  if (process.env.NODE_ENV !== 'production') {
    return path.join(os.tmpdir(), 'coder-studio-dev.db');
  }
  return path.resolve(process.cwd(), 'data');
}

/**
 * Parse server configuration from environment and CLI args
 */
export function parseServerConfig(overrides?: Partial<ServerConfig>): ServerConfig {
  const noAuth = process.env.NO_AUTH === 'true';
  const password = process.env.AUTH_PASSWORD;
  const dataDir = resolveDbPath(overrides?.dataDir || process.env.DATA_DIR);

  return {
    host: overrides?.host || process.env.HOST || 'localhost',
    port: overrides?.port || parseInt(process.env.PORT || '3000', 10),
    dataDir,
    runtimeDir: overrides?.runtimeDir || process.env.RUNTIME_DIR || './runtime',
    logLevel: overrides?.logLevel || (process.env.LOG_LEVEL as any) || 'info',
    webRoot: overrides?.webRoot,
    auth: overrides?.auth || {
      enabled: !noAuth && !!password,
      password,
    },
  };
}

/**
 * Ensure the database directory exists (production only).
 * In dev the OS temp dir always exists.
 */
export function ensureDataDir(config: ServerConfig): void {
  if (process.env.NODE_ENV === 'production') {
    fs.mkdirSync(config.dataDir, { recursive: true });
  }
}
