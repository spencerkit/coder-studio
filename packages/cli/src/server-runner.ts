import { type RestartIntent, readRestartIntent } from "@coder-studio/core/runtime";
import type { Server, ServerConfig } from "@coder-studio/server";
import { closeDatabase, openDatabase, parseServerConfig } from "@coder-studio/server";
import { existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { readCliConfig } from "./config-store.js";
import { getStaticAssetsDir, hasWebAssets } from "./embed.js";
import { assertSupportedNodeVersion } from "./node-version.js";
import { getCliVersion } from "./package-manifest.js";
import { debugRestartTrace, warnRestartTrace } from "./restart-trace.js";
import { ensureTerminalBroker } from "./terminal-broker-control.js";

const MISSING_WEB_ASSETS_WARNING = "Warning: Web assets not found. Frontend will not be available.";

export const buildServerConfig = (): Partial<ServerConfig> => {
  const savedConfig = readCliConfig();
  const config: Partial<ServerConfig> = {
    appVersion: getCliVersion(import.meta.url),
    ...(savedConfig?.host !== undefined ? { host: savedConfig.host } : {}),
    ...(savedConfig?.port !== undefined && savedConfig.port > 0 ? { port: savedConfig.port } : {}),
    ...(savedConfig?.dataDir !== undefined ? { dataDir: savedConfig.dataDir } : {}),
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

export const verifyLocalDatabaseCompatibility = (): void => {
  const config = parseServerConfig(buildServerConfig());
  if (config.dataDir !== ":memory:") {
    mkdirSync(dirname(config.dataDir), { recursive: true });
  }

  const db = openDatabase(config.dataDir);
  closeDatabase(db);
};

function readValidRestartIntent(): RestartIntent | null {
  const intent = readRestartIntent();
  if (!intent) {
    return null;
  }

  return intent.expiresAt > Date.now() ? intent : null;
}

const createShutdownHandler =
  (server: Server, serverInstanceId: string, signal: NodeJS.Signals) => async () => {
    const startedAt = Date.now();
    const intent = readValidRestartIntent();
    const shouldPreserve = intent?.expectedServerInstanceId === serverInstanceId;
    const ttlMs = shouldPreserve && intent ? Math.max(1, intent.expiresAt - Date.now()) : null;

    debugRestartTrace("server_runner.shutdown_signal", {
      signal,
      serverInstanceId,
      requestId: intent?.requestId ?? null,
      intentExpectedServerInstanceId: intent?.expectedServerInstanceId ?? null,
      shouldPreserve,
      ttlMs,
    });

    try {
      if (shouldPreserve && intent && ttlMs !== null) {
        await server.stop({
          mode: "restart-preserve",
          requestId: intent.requestId,
          ttlMs,
        });
      } else {
        await server.stop();
      }

      debugRestartTrace("server_runner.shutdown_complete", {
        signal,
        serverInstanceId,
        shouldPreserve,
        durationMs: Date.now() - startedAt,
      });
      process.exit(0);
    } catch (error) {
      warnRestartTrace("server_runner.shutdown_failed", {
        signal,
        serverInstanceId,
        shouldPreserve,
        durationMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    }
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

function resolveTerminalBrokerScriptPath(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = dirname(currentFile);
  const candidates = [
    join(currentDir, "terminal-broker-runner.js"),
    join(currentDir, "terminal-broker-runner.mjs"),
    join(currentDir, "../src/terminal-broker-runner.ts"),
  ];

  const scriptPath = candidates.find((candidate) => existsSync(candidate));
  if (!scriptPath) {
    throw new Error("Unable to locate the terminal broker entry script");
  }

  return scriptPath;
}

export const startServer = async (): Promise<Server> => {
  assertSupportedNodeVersion();
  const broker = await ensureTerminalBroker({
    script: resolveTerminalBrokerScriptPath(),
    cwd: process.cwd(),
    waitMs: 5000,
  });
  const serverInstanceId = `server-${process.pid}`;
  const restartIntent = readValidRestartIntent();
  const { createServer } = await import("@coder-studio/server");
  const server = await createServer({
    ...buildServerConfig(),
    serverInstanceId,
    restartClaimRequestId: restartIntent?.requestId,
    terminalBrokerEndpoint: broker.endpoint,
  });
  process.on("SIGINT", createShutdownHandler(server, serverInstanceId, "SIGINT"));
  process.on("SIGTERM", createShutdownHandler(server, serverInstanceId, "SIGTERM"));

  return server;
};

void runServerEntrypoint(import.meta.url, process.argv[1]);
