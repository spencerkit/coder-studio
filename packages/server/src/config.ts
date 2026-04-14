/**
 * Server Configuration
 *
 * Parses CLI args and environment variables
 */

export interface ServerConfig {
  host: string;
  port: number;
  dataDir: string;
  runtimeDir: string;
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Parse server configuration from environment and CLI args
 */
export function parseServerConfig(overrides?: Partial<ServerConfig>): ServerConfig {
  return {
    host: overrides?.host || process.env.HOST || 'localhost',
    port: overrides?.port || parseInt(process.env.PORT || '3000', 10),
    dataDir: overrides?.dataDir || process.env.DATA_DIR || './data',
    runtimeDir: overrides?.runtimeDir || process.env.RUNTIME_DIR || './runtime',
    logLevel: overrides?.logLevel || (process.env.LOG_LEVEL as any) || 'info',
  };
}
