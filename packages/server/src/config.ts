/**
 * Server Configuration
 *
 * Parses CLI args and environment variables.
 *
 * State anchor path resolution:
 * - Development: uses OS temp directory so local state files stay out of the repo
 * - Production: uses ~/.coder-studio/data/coder-studio.db by default
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface ServerConfig {
  host: string;
  port: number;
  dataDir: string;
  uploadsDir: string;
  logLevel: "trace" | "debug" | "info" | "warn" | "error";
  webRoot?: string;
  appVersion?: string;
  auth: {
    enabled: boolean;
    password?: string;
  };
}

let cachedTestUploadsDir: string | undefined;
let cachedAppVersion: string | undefined;

function parseLogLevel(value: string | undefined): ServerConfig["logLevel"] | undefined {
  switch (value) {
    case "trace":
    case "debug":
    case "info":
    case "warn":
    case "error":
      return value;
    default:
      return undefined;
  }
}

function resolveDefaultAppVersion(): string {
  if (cachedAppVersion) {
    return cachedAppVersion;
  }

  const packageJsonPath = [new URL("../../cli/package.json", import.meta.url)].find((candidate) =>
    fs.existsSync(candidate)
  );

  if (!packageJsonPath) {
    cachedAppVersion = "0.0.0";
    return cachedAppVersion;
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as { version?: unknown };
    cachedAppVersion = typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    cachedAppVersion = "0.0.0";
  }

  return cachedAppVersion;
}

/**
 * Resolve the state anchor file path.
 *
 * In development (NODE_ENV !== 'production') the anchor file is placed in the OS temp
 * directory so it never pollutes the working tree. In production the path
 * defaults to ~/.coder-studio/data/coder-studio.db and can be overridden via
 * the DATA_DIR env var.
 */
function resolveDataPath(explicit?: string): string {
  if (explicit) return explicit;
  if (process.env.NODE_ENV !== "production") {
    return path.join(os.tmpdir(), "coder-studio-dev.db");
  }
  return path.join(os.homedir(), ".coder-studio", "data", "coder-studio.db");
}

function getOrCreateTestUploadsDir(): string {
  if (cachedTestUploadsDir) {
    return cachedTestUploadsDir;
  }

  cachedTestUploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "coder-studio-test-uploads-"));
  return cachedTestUploadsDir;
}

function resolveUploadsDir(explicit?: string): string {
  if (explicit) {
    return explicit;
  }
  if (process.env.NODE_ENV === "test") {
    return getOrCreateTestUploadsDir();
  }
  if (process.env.NODE_ENV === "development") {
    return path.join(os.tmpdir(), "coder-studio-dev", "uploads");
  }
  return path.join(os.homedir(), ".coder-studio", "uploads");
}

/**
 * Parse server configuration from environment and CLI args
 */
export function parseServerConfig(overrides?: Partial<ServerConfig>): ServerConfig {
  const noAuth = process.env.NO_AUTH === "true";
  const password = process.env.AUTH_PASSWORD;
  const dataDir = resolveDataPath(overrides?.dataDir || process.env.DATA_DIR);
  const uploadsDir = resolveUploadsDir(overrides?.uploadsDir || process.env.UPLOADS_DIR);

  // NOTE: use `??` on port so callers can pass 0 to request an
  // OS-assigned port. `||` would silently fall through to 4173 for port=0.
  return {
    host: overrides?.host || process.env.HOST || "localhost",
    port: overrides?.port ?? parseInt(process.env.PORT || "4173", 10),
    dataDir,
    uploadsDir,
    logLevel: overrides?.logLevel ?? parseLogLevel(process.env.LOG_LEVEL) ?? "info",
    webRoot: overrides?.webRoot,
    appVersion:
      overrides?.appVersion ?? process.env.CODER_STUDIO_APP_VERSION ?? resolveDefaultAppVersion(),
    auth: overrides?.auth || {
      enabled: !noAuth && !!password,
      password,
    },
  };
}

/**
 * Ensure the local state parent directory exists.
 */
export function ensureDataDir(config: ServerConfig): void {
  if (config.dataDir === ":memory:") {
    return;
  }

  fs.mkdirSync(path.dirname(config.dataDir), { recursive: true });
}
