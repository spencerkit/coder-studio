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
  webRoot?: string;
  auth: {
    enabled: boolean;
    password?: string;
  };
}

/**
 * Parse server configuration from environment and CLI args
 */
export function parseServerConfig(overrides?: Partial<ServerConfig>): ServerConfig {
  const noAuth = process.env.NO_AUTH === 'true';
  const password = process.env.AUTH_PASSWORD;

  return {
    host: overrides?.host || process.env.HOST || 'localhost',
    port: overrides?.port || parseInt(process.env.PORT || '3000', 10),
    dataDir: overrides?.dataDir || process.env.DATA_DIR || './data',
    runtimeDir: overrides?.runtimeDir || process.env.RUNTIME_DIR || './runtime',
    logLevel: overrides?.logLevel || (process.env.LOG_LEVEL as any) || 'info',
    webRoot: overrides?.webRoot,
    auth: overrides?.auth || {
      enabled: !noAuth && !!password,
      password: password,
    },
  };
}
