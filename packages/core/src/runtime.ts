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

export function getRuntimeDir(): string {
  const override = process.env.CODER_STUDIO_RUNTIME_DIR;
  if (override && override.trim()) {
    return override;
  }

  return join(homedir(), ".coder-studio");
}

export function getRuntimePath(pathOverride?: string): string {
  if (pathOverride && pathOverride.trim()) {
    return pathOverride;
  }

  const envOverride = process.env.CODER_STUDIO_RUNTIME_JSON_PATH;
  if (envOverride && envOverride.trim()) {
    return envOverride;
  }

  return join(getRuntimeDir(), "runtime.json");
}

export function readRuntimeConfig(pathOverride?: string): RuntimeConfig | null {
  const runtimePath = getRuntimePath(pathOverride);
  if (!existsSync(runtimePath)) {
    return null;
  }

  try {
    const config = JSON.parse(readFileSync(runtimePath, "utf-8")) as Partial<RuntimeConfig>;
    if (
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
  } catch {
    return null;
  }
}

export function writeRuntimeConfig(config: RuntimeConfig, pathOverride?: string): void {
  const runtimePath = getRuntimePath(pathOverride);
  const runtimeDir = dirname(runtimePath);
  if (!existsSync(runtimeDir)) {
    mkdirSync(runtimeDir, { recursive: true });
  }

  writeFileSync(runtimePath, JSON.stringify(config, null, 2), "utf-8");
}

export function deleteRuntimeConfig(pathOverride?: string): void {
  const runtimePath = getRuntimePath(pathOverride);
  if (!existsSync(runtimePath)) {
    return;
  }

  try {
    unlinkSync(runtimePath);
  } catch (error) {
    const candidate = error as { code?: string };
    if (candidate.code !== "ENOENT") {
      throw error;
    }
  }
}
