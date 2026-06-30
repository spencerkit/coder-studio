import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { normalizeLegacyStateDir, normalizeStateDir } from "@coder-studio/core/state-paths";

export interface DesktopLaunchConfig {
  hostOverride?: string;
  portOverride?: number;
  stateDir: string;
  password?: string;
  runtimeReleaseIndexUrl?: string;
}

interface PersistedDesktopConfig {
  host?: string;
  port?: number;
  stateDir?: string;
  dataDir?: string;
  password?: string;
  desktopRuntimeReleaseIndexUrl?: string;
}

function readPersistedDesktopConfig(): PersistedDesktopConfig | null {
  const configPath = join(homedir(), ".coder-studio", "config.json");
  if (!existsSync(configPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(configPath, "utf8")) as PersistedDesktopConfig;
  } catch {
    return null;
  }
}

export function resolveDesktopLaunchConfig(input: {
  readCliConfig?: () => PersistedDesktopConfig | null;
  userDataDir: string;
}): DesktopLaunchConfig {
  const config = (input.readCliConfig ?? readPersistedDesktopConfig)();
  const fallbackStateDir = join(input.userDataDir, "state");
  const resolvedStateDir =
    config?.stateDir !== undefined
      ? normalizeStateDir(config.stateDir)
      : config?.dataDir !== undefined
        ? normalizeLegacyStateDir(config.dataDir)
        : fallbackStateDir;

  return {
    ...(config?.host ? { hostOverride: config.host } : {}),
    ...(typeof config?.port === "number" ? { portOverride: config.port } : {}),
    stateDir: resolvedStateDir,
    ...(config?.password ? { password: config.password } : {}),
    ...(config?.desktopRuntimeReleaseIndexUrl
      ? { runtimeReleaseIndexUrl: config.desktopRuntimeReleaseIndexUrl }
      : {}),
  };
}
