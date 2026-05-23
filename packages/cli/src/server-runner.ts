import type { Server, ServerConfigInput } from "@coder-studio/server";
import { parseServerConfig } from "@coder-studio/server";
import { mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { readCliConfig } from "./config-store.js";
import { getStaticAssetsDir, hasWebAssets } from "./embed.js";
import { assertSupportedNodeVersion } from "./node-version.js";
import { getCliVersion } from "./package-manifest.js";
import { getUpdateRuntimeInfo } from "./update-runtime.js";

const MISSING_WEB_ASSETS_WARNING = "Warning: Web assets not found. Frontend will not be available.";

export const buildServerConfig = (): ServerConfigInput => {
  const savedConfig = readCliConfig();
  const config: ServerConfigInput = {
    appVersion: getCliVersion(import.meta.url),
    update: getUpdateRuntimeInfo(import.meta.url),
    ...(savedConfig?.host !== undefined ? { host: savedConfig.host } : {}),
    ...(savedConfig?.port !== undefined && savedConfig.port > 0 ? { port: savedConfig.port } : {}),
    ...(savedConfig?.stateDir !== undefined ? { stateDir: savedConfig.stateDir } : {}),
    ...(savedConfig?.password !== undefined
      ? {
          auth: {
            enabled: true,
            password: savedConfig.password,
          },
        }
      : {}),
  };

  if (hasWebAssets()) {
    return {
      ...config,
      webRoot: getStaticAssetsDir(),
    };
  }

  console.warn(MISSING_WEB_ASSETS_WARNING);
  return config;
};

export const prepareLocalStateStorage = (): void => {
  const config = parseServerConfig(buildServerConfig());
  if (config.stateDir !== ":memory:") {
    mkdirSync(config.stateDir, { recursive: true });
  }
};

const createShutdownHandler = (server: Server) => async () => {
  await server.stop();
  process.exit(0);
};

const isServerEntrypoint = (moduleUrl: string, argvEntry?: string): boolean => {
  if (argvEntry === undefined) {
    return true;
  }

  if (argvEntry.endsWith("ProcessContainerFork.js")) {
    return true;
  }

  const modulePath = fileURLToPath(moduleUrl);
  const [entryScript] = argvEntry.split(/\s+/, 1);
  return entryScript === modulePath;
};

export const runServerEntrypoint = async (moduleUrl: string, argvEntry?: string): Promise<void> => {
  if (!isServerEntrypoint(moduleUrl, argvEntry)) {
    return;
  }

  await startServer();
};

export const startServer = async (): Promise<Server> => {
  assertSupportedNodeVersion();
  const { createServer } = await import("@coder-studio/server");
  const server = await createServer(buildServerConfig());
  const shutdown = createShutdownHandler(server);

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return server;
};

void runServerEntrypoint(import.meta.url, process.argv[1]);
