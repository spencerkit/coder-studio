import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface RuntimeConfig {
  host: string;
  port: number;
  pid: number;
  token: string;
  serverInstanceId: string;
  startedAt: number;
}

export interface RestartIntent {
  requestId: string;
  expectedServerInstanceId: string;
  createdAt: number;
  expiresAt: number;
  mode: "preserve_terminals";
}

export interface TerminalBrokerRuntimeConfig {
  endpoint: string;
  pid: number;
  startedAt: number;
}

export function getRuntimeDir(): string {
  const override = process.env.CODER_STUDIO_RUNTIME_DIR;
  if (override && override.trim()) {
    return override;
  }

  return join(homedir(), ".coder-studio");
}

export function getRuntimePath(): string {
  const pathOverride = process.env.CODER_STUDIO_RUNTIME_JSON_PATH;
  if (pathOverride && pathOverride.trim()) {
    return pathOverride;
  }

  return join(getRuntimeDir(), "runtime.json");
}

export function readRuntimeConfig(): RuntimeConfig | null {
  const config = readJsonFile(getRuntimePath()) as Partial<RuntimeConfig> | null;
  if (
    !config ||
    typeof config.port !== "number" ||
    typeof config.pid !== "number" ||
    typeof config.token !== "string" ||
    typeof config.serverInstanceId !== "string" ||
    typeof config.startedAt !== "number"
  ) {
    return null;
  }

  return {
    host: typeof config.host === "string" ? config.host : "localhost",
    port: config.port,
    pid: config.pid,
    token: config.token,
    serverInstanceId: config.serverInstanceId,
    startedAt: config.startedAt,
  };
}

export function writeRuntimeConfig(config: RuntimeConfig): void {
  writeJsonFile(getRuntimePath(), config);
}

export function deleteRuntimeConfig(): void {
  deleteFileIfExists(getRuntimePath());
}

export function getRestartIntentPath(): string {
  return join(getRuntimeDir(), "restart-intent.json");
}

export function readRestartIntent(): RestartIntent | null {
  const intent = readJsonFile(getRestartIntentPath());
  return isRestartIntent(intent) ? intent : null;
}

export function writeRestartIntent(intent: RestartIntent): void {
  writeJsonFile(getRestartIntentPath(), intent);
}

export function deleteRestartIntent(): void {
  deleteFileIfExists(getRestartIntentPath());
}

export function getTerminalBrokerRuntimePath(): string {
  return join(getRuntimeDir(), "terminal-broker.json");
}

export function getTerminalBrokerSocketPath(): string {
  if (process.platform === "win32") {
    const runtimeDirHash = createHash("sha256").update(getRuntimeDir()).digest("hex");
    return `\\\\.\\pipe\\coder-studio-terminal-broker-${runtimeDirHash}`;
  }

  return join(getRuntimeDir(), "terminal-broker.sock");
}

export function readTerminalBrokerRuntime(): TerminalBrokerRuntimeConfig | null {
  const config = readJsonFile(getTerminalBrokerRuntimePath());
  return isTerminalBrokerRuntimeConfig(config) ? config : null;
}

export function writeTerminalBrokerRuntime(config: TerminalBrokerRuntimeConfig): void {
  writeJsonFile(getTerminalBrokerRuntimePath(), config);
}

export function deleteTerminalBrokerRuntime(): void {
  deleteFileIfExists(getTerminalBrokerRuntimePath());
}

function readJsonFile(path: string): unknown | null {
  if (!existsSync(path)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function writeJsonFile(path: string, value: unknown): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(value, null, 2), "utf-8");
}

function deleteFileIfExists(path: string): void {
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

function isRestartIntent(value: unknown): value is RestartIntent {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof value.requestId === "string" &&
    typeof value.expectedServerInstanceId === "string" &&
    typeof value.createdAt === "number" &&
    typeof value.expiresAt === "number" &&
    value.mode === "preserve_terminals"
  );
}

function isTerminalBrokerRuntimeConfig(value: unknown): value is TerminalBrokerRuntimeConfig {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof value.endpoint === "string" &&
    typeof value.pid === "number" &&
    typeof value.startedAt === "number"
  );
}
