import { buildWslRuntimeSource } from "@coder-studio/runtime";
import type { Server, ServerConfigInput } from "@coder-studio/server";
import { parseServerConfig } from "@coder-studio/server";
import { existsSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { readCliConfig } from "./config-store.js";
import { getStaticAssetsDir, hasWebAssets } from "./embed.js";
import { assertSupportedNodeVersion } from "./node-version.js";
import { getCliVersion } from "./package-manifest.js";
import { getUpdateRuntimeInfo } from "./update-runtime.js";

const MISSING_WEB_ASSETS_WARNING = "Warning: Web assets not found. Frontend will not be available.";

export const resolveCliPackageRoot = (importMetaUrl: string): string => {
  const currentDir = dirname(fileURLToPath(importMetaUrl));
  const candidates = [
    resolve(currentDir, "../package.json"),
    resolve(currentDir, "../../package.json"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return dirname(candidate);
    }
  }

  return dirname(candidates.at(-1) ?? candidates[0]);
};

export interface StartServerOptions {
  serverConfig?: ServerConfigInput;
  writeRuntimeConfig?: boolean;
  runtimeJsonPath?: string;
}

export const buildServerConfig = (overrides: ServerConfigInput = {}): ServerConfigInput => {
  const savedConfig = readCliConfig();
  const cliVersion = getCliVersion(import.meta.url);
  const packageRoot = resolveCliPackageRoot(import.meta.url);
  const config: ServerConfigInput = {
    appVersion: cliVersion,
    runtimeVersion: cliVersion,
    wslRuntime: {
      source: buildWslRuntimeSource({
        runtimeVersion: cliVersion,
        packageRoot,
        entryRelativePath: "dist/esm/wsl-runtime-entry.mjs",
      }),
    },
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
    ...overrides,
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

export const startServer = async (options: StartServerOptions = {}): Promise<Server> => {
  assertSupportedNodeVersion();
  const { createServer } = await import("@coder-studio/server");
  const server = await createServer({
    ...buildServerConfig(options.serverConfig),
    ...(options.writeRuntimeConfig === undefined
      ? {}
      : { writeRuntimeConfig: options.writeRuntimeConfig }),
    ...(options.runtimeJsonPath ? { runtimeJsonPath: options.runtimeJsonPath } : {}),
  });
  const shutdown = createShutdownHandler(server);

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return server;
};

void runServerEntrypoint(import.meta.url, process.argv[1]);
