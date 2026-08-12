import { normalizeLegacyStateDir, normalizeStateDir } from "@coder-studio/core/state-paths";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getCoderStudioHome } from "./paths.js";

export interface CliConfig {
  host?: string;
  port?: number;
  stateDir?: string;
  password?: string;
}

export function getCliConfigPath(): string {
  return join(getCoderStudioHome(), "config.json");
}

export function normalizeLegacyDataDir(input: string): string {
  return normalizeLegacyStateDir(input);
}

export function readCliConfig(): CliConfig | null {
  const path = getCliConfigPath();
  if (!existsSync(path)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as {
      host?: unknown;
      port?: unknown;
      stateDir?: unknown;
      dataDir?: unknown;
      password?: unknown;
    };
    if (
      (parsed.host !== undefined && typeof parsed.host !== "string") ||
      (parsed.port !== undefined && typeof parsed.port !== "number") ||
      (parsed.stateDir !== undefined && typeof parsed.stateDir !== "string") ||
      (parsed.dataDir !== undefined && typeof parsed.dataDir !== "string") ||
      (parsed.password !== undefined && typeof parsed.password !== "string")
    ) {
      return null;
    }

    return {
      ...(parsed.host !== undefined ? { host: parsed.host } : {}),
      ...(parsed.port !== undefined ? { port: parsed.port } : {}),
      ...(parsed.stateDir !== undefined
        ? { stateDir: normalizeStateDir(parsed.stateDir) }
        : parsed.dataDir !== undefined
          ? { stateDir: normalizeLegacyDataDir(parsed.dataDir) }
          : {}),
      ...(parsed.password !== undefined ? { password: parsed.password } : {}),
    };
  } catch {
    return null;
  }
}

export function writeCliConfig(config: CliConfig): void {
  const path = getCliConfigPath();
  const dir = getCoderStudioHome();
  const normalizedConfig: CliConfig = {
    ...(config.host !== undefined ? { host: config.host } : {}),
    ...(config.port !== undefined && config.port > 0 ? { port: config.port } : {}),
    ...(config.stateDir !== undefined ? { stateDir: normalizeStateDir(config.stateDir) } : {}),
    ...(config.password !== undefined ? { password: config.password } : {}),
  };
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(normalizedConfig, null, 2), "utf-8");
}
