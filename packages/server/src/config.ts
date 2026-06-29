/**
 * Server Configuration
 *
 * Parses CLI args and environment variables.
 *
 * State directory resolution:
 * - Development: uses OS temp directory so local state files stay out of the repo
 * - Production: uses ~/.coder-studio/data by default
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  IN_MEMORY_STATE_DIR,
  normalizeLegacyStateDir,
  normalizeStateDir,
} from "@coder-studio/core/state-paths";

export interface ServerConfig {
  host: string;
  port: number;
  stateDir: string;
  uploadsDir: string;
  logLevel: "trace" | "debug" | "info" | "warn" | "error";
  webRoot?: string;
  appVersion?: string;
  runtimeVersion?: string;
  auth: {
    enabled: boolean;
    password?: string;
  };
  proxy: {
    enabled: boolean;
    host: string;
    port: number;
    publicOrigin?: string;
    maxGrantTtlMs: number;
    allowedHosts: string[];
    allowedCidrs: string[];
    allowLoopback: boolean;
  };
  update: {
    supported: boolean;
    installKind: "global_npm" | "desktop_managed" | "unsupported";
    packageName: string;
    cliCommand: string;
    workerEntryPath?: string;
    npmCommand: string;
    restartArgs: string[];
    installArgsPrefix: string[];
    unsupportedReason: string | null;
  };
}

export type ServerConfigInput = Partial<ServerConfig> & {
  dataDir?: string;
};

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
 * Resolve the state directory path.
 *
 * In development (NODE_ENV !== 'production') the state directory is placed in
 * the OS temp directory so it never pollutes the working tree. In production
 * the path defaults to ~/.coder-studio/data and can be overridden via the
 * STATE_DIR env var. Legacy DATA_DIR file anchors are normalized to their
 * parent directory.
 */
function resolveStatePath({
  stateDir,
  dataDir,
  envStateDir,
  envDataDir,
}: {
  stateDir?: string;
  dataDir?: string;
  envStateDir?: string;
  envDataDir?: string;
}): string {
  if (stateDir !== undefined) {
    return normalizeStateDir(stateDir);
  }
  if (dataDir !== undefined) {
    return normalizeLegacyStateDir(dataDir);
  }
  if (envStateDir !== undefined) {
    return normalizeStateDir(envStateDir);
  }
  if (envDataDir !== undefined) {
    return normalizeLegacyStateDir(envDataDir);
  }
  if (process.env.NODE_ENV !== "production") {
    return path.join(os.tmpdir(), "coder-studio-dev");
  }
  return path.join(os.homedir(), ".coder-studio", "data");
}

type StateDirConfigInput = { stateDir?: string; dataDir?: string };

export function resolveConfiguredStateDir(config: StateDirConfigInput): string {
  if (config.stateDir !== undefined) {
    return normalizeStateDir(config.stateDir);
  }
  if (config.dataDir !== undefined) {
    return normalizeLegacyStateDir(config.dataDir);
  }
  throw new Error("State directory is required");
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

function parseCsvEnv(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Parse server configuration from environment and CLI args
 */
export function parseServerConfig(overrides?: ServerConfigInput): ServerConfig {
  const noAuth = process.env.NO_AUTH === "true";
  const password = process.env.AUTH_PASSWORD;
  const stateDir = resolveStatePath({
    stateDir: overrides?.stateDir,
    dataDir: overrides?.dataDir,
    envStateDir: process.env.STATE_DIR,
    envDataDir: process.env.DATA_DIR,
  });
  const uploadsDir = resolveUploadsDir(overrides?.uploadsDir || process.env.UPLOADS_DIR);
  const port = overrides?.port ?? parseInt(process.env.PORT || "4173", 10);
  const proxyPort = overrides?.proxy?.port ?? process.env.PROXY_PORT;

  // NOTE: use `??` on port so callers can pass 0 to request an
  // OS-assigned port. `||` would silently fall through to 4173 for port=0.
  return {
    host: overrides?.host || process.env.HOST || "localhost",
    port,
    stateDir,
    uploadsDir,
    logLevel: overrides?.logLevel ?? parseLogLevel(process.env.LOG_LEVEL) ?? "info",
    webRoot: overrides?.webRoot,
    runtimeVersion:
      overrides?.runtimeVersion ??
      process.env.CODER_STUDIO_RUNTIME_VERSION ??
      resolveDefaultAppVersion(),
    appVersion:
      overrides?.appVersion ??
      process.env.CODER_STUDIO_APP_VERSION ??
      overrides?.runtimeVersion ??
      process.env.CODER_STUDIO_RUNTIME_VERSION ??
      resolveDefaultAppVersion(),
    auth: overrides?.auth || {
      enabled: !noAuth && !!password,
      password,
    },
    proxy: {
      enabled: process.env.PROXY_ENABLED === "true",
      host: process.env.PROXY_HOST || overrides?.proxy?.host || process.env.HOST || "localhost",
      port: proxyPort !== undefined ? Number(proxyPort) : port + 1,
      publicOrigin: process.env.PROXY_PUBLIC_ORIGIN,
      maxGrantTtlMs: Number(process.env.PROXY_MAX_GRANT_TTL_MS || 7 * 24 * 60 * 60 * 1000),
      allowedHosts: parseCsvEnv(process.env.PROXY_ALLOWED_HOSTS),
      allowedCidrs: parseCsvEnv(process.env.PROXY_ALLOWED_CIDRS),
      allowLoopback: process.env.PROXY_ALLOW_LOOPBACK !== "false",
    },
    update: overrides?.update ?? {
      supported: false,
      installKind: "unsupported",
      packageName: "@spencer-kit/coder-studio",
      cliCommand: "coder-studio",
      workerEntryPath: undefined,
      npmCommand: "npm",
      restartArgs: ["serve", "--restart"],
      installArgsPrefix: ["install", "-g"],
      unsupportedReason: "In-app update is only supported for global npm installs",
    },
  };
}

/**
 * Ensure the local state directory exists.
 */
export function ensureStateDir(config: StateDirConfigInput): void {
  const stateDir = resolveConfiguredStateDir(config);
  if (stateDir === IN_MEMORY_STATE_DIR) {
    return;
  }

  fs.mkdirSync(stateDir, { recursive: true });
}
