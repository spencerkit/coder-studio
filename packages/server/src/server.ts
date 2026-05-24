/**
 * Server Entry Point
 *
 * Creates and assembles all server components.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deleteRuntimeConfig,
  getRuntimePath,
  type RuntimeConfig,
  writeRuntimeConfig,
} from "@coder-studio/core/runtime";
import { IN_MEMORY_STATE_DIR } from "@coder-studio/core/state-paths";
import { providerRegistry } from "@coder-studio/providers";
import { isDirectExecution } from "@coder-studio/utils";
import type { FastifyInstance } from "fastify";
import { buildFastifyApp } from "./app.js";
import { EventBus } from "./bus/event-bus.js";
import {
  ensureStateDir,
  parseServerConfig,
  resolveConfiguredStateDir,
  type ServerConfigInput,
} from "./config.js";
import { AutoFetchScheduler } from "./git/auto-fetch.js";
import { LspManager } from "./lsp/manager.js";
import { LspToolInstallManager } from "./lsp-tools/install-manager.js";
import { LspToolManager } from "./lsp-tools/manager.js";
import { FileManifestStore } from "./lsp-tools/manifest-store.js";
import { resolveLspToolRoot } from "./lsp-tools/tool-root.js";
import { runCommandAsString } from "./provider-runtime/command-runner.js";
import { createE2EProviderMockOverrides } from "./provider-runtime/e2e-provider-mock.js";
import { ProviderInstallManager } from "./provider-runtime/install-manager.js";
import type { RuntimeStatusDeps } from "./provider-runtime/runtime-status.js";
import { SessionManager } from "./session/manager.js";
import { AppearanceAssetRepo } from "./storage/repositories/appearance-asset-repo.js";
import { AuthLoginBlockRepo } from "./storage/repositories/auth-login-block-repo.js";
import { AuthSessionRepo } from "./storage/repositories/auth-session-repo.js";
import { ProviderConfigRepo } from "./storage/repositories/provider-config-repo.js";
import { SessionRepo } from "./storage/repositories/session-repo.js";
import { SettingsRepo } from "./storage/repositories/settings-repo.js";
import { SupervisorRepo } from "./storage/repositories/supervisor-repo.js";
import { TerminalRepo } from "./storage/repositories/terminal-repo.js";
import { UpdateStateRepo } from "./storage/repositories/update-state-repo.js";
import { WorkspaceRepo } from "./storage/repositories/workspace-repo.js";
import { SupervisorManager } from "./supervisor/manager.js";
import * as targetStore from "./supervisor/target-store.js";
import { TerminalManager } from "./terminal/manager.js";
import { NodePtyHost } from "./terminal/pty-host.js";
import { UpdateService } from "./update/update-service.js";
import { deleteWorkspaceUploads, runStartupGc } from "./uploads/cleanup.js";
import { STARTUP_GC_DELAY_MS } from "./uploads/constants.js";
import { WorkspaceManager } from "./workspace/manager.js";
import { ActivationManager } from "./ws/activation.js";
import type { CommandContext } from "./ws/dispatch.js";
import { dispatch } from "./ws/dispatch.js";
import { FencingManager } from "./ws/fencing.js";
import { WsHub } from "./ws/hub.js";

import "./commands/index.js";

const WS_KEEPALIVE_INTERVAL_MS = 15_000;

export interface Server {
  app: FastifyInstance;
  stop: () => Promise<void>;
  __test__?: { sessionMgr: SessionManager; commandContext: CommandContext };
}

export interface ServerRuntimeOptions {
  writeRuntimeConfig?: boolean;
}

export async function createServer(
  configOverrides?: ServerConfigInput & ServerRuntimeOptions
): Promise<Server> {
  const config = parseServerConfig(configOverrides);
  const configuredStateDir = resolveConfiguredStateDir(config);
  const shouldCleanupStateRoot = configuredStateDir === IN_MEMORY_STATE_DIR;
  const stateRoot = shouldCleanupStateRoot
    ? mkdtempSync(join(tmpdir(), "coder-studio-state-"))
    : configuredStateDir;

  ensureStateDir(config);

  const eventBus = new EventBus();
  const activationMgr = new ActivationManager();
  const fencingMgr = new FencingManager();
  const wsHub = new WsHub({ eventBus, commandContext: null, config, fencingMgr });
  let workspaceMgr: WorkspaceManager;
  let commandContext: CommandContext;
  let lspMgr: LspManager | null = null;

  const terminalRepo = new TerminalRepo({
    filePath: join(stateRoot, "state", "terminals.json"),
  });
  const sessionRepo = new SessionRepo({
    filePath: join(stateRoot, "state", "sessions.json"),
  });

  const terminalMgr = new TerminalManager({
    ptyHost: createPtyHost(),
    eventBus,
    db: terminalRepo,
  });

  const settingsRepo = new SettingsRepo({
    filePath: join(stateRoot, "state", "settings.json"),
  });
  const updateStateRepo = new UpdateStateRepo({
    filePath: join(stateRoot, "state", "update-state.json"),
    currentVersion: config.appVersion ?? "0.0.0",
  });
  const autoFetch = new AutoFetchScheduler({
    workspaceMgr: { get: (workspaceId) => workspaceMgr.get(workspaceId) },
    eventBus,
    settingsRepo,
    runFetch: async (workspaceId) => {
      if (!workspaceMgr.get(workspaceId)) {
        return;
      }

      const result = await dispatch(
        {
          kind: "command",
          id: `auto-fetch:${workspaceId}:${Date.now()}`,
          op: "git.fetch",
          args: {
            workspaceId,
            background: true,
          },
        },
        commandContext
      );

      if (!result.ok) {
        throw new Error(result.error?.message ?? "Background fetch failed");
      }

      const data = result.data as { success?: boolean; message?: string };
      if (data.success === false) {
        throw new Error(data.message ?? "Background fetch failed");
      }
    },
  });

  const providerConfigRepo = new ProviderConfigRepo({
    filePath: join(stateRoot, "state", "provider-configs.json"),
  });
  const workspaceRepo = new WorkspaceRepo({
    filePath: join(stateRoot, "state", "workspaces.json"),
  });
  const sessionMgr = new SessionManager({
    terminalMgr,
    eventBus,
    db: sessionRepo,
    broadcaster: wsHub,
    providerRegistry,
    providerConfigRepo,
  });

  let supervisorMgr: SupervisorManager | undefined;
  let updateService: UpdateService | undefined;

  workspaceMgr = new WorkspaceManager({
    workspaceRepo,
    eventBus,
    broadcaster: wsHub,
    autoFetch,
    teardown: async (workspaceId) => {
      await lspMgr?.disposeWorkspace(workspaceId);
      await supervisorMgr?.deleteForWorkspace(workspaceId);
      await sessionMgr.stopForWorkspace(workspaceId);
      await terminalMgr.closeForWorkspace(workspaceId);
      sessionMgr.deleteEndedForWorkspace(workspaceId);

      for (const session of sessionRepo.findByWorkspaceId(workspaceId)) {
        sessionRepo.delete(session.id);
      }

      for (const terminal of terminalRepo.listByWorkspace(workspaceId)) {
        terminalRepo.delete(terminal.id);
      }
    },
    onClose: (workspaceId) =>
      deleteWorkspaceUploads(config.uploadsDir, workspaceId).catch((err) =>
        console.warn("[uploads] cascade cleanup failed", { wsId: workspaceId, err })
      ),
  });

  const authSessionRepo = new AuthSessionRepo({
    filePath: join(stateRoot, "state", "auth-sessions.json"),
  });
  const authLoginBlockRepo = new AuthLoginBlockRepo({
    filePath: join(stateRoot, "state", "auth-login-blocks.json"),
  });
  const appearanceAssetRepo = new AppearanceAssetRepo({
    filePath: join(stateRoot, "state", "appearance-assets.json"),
  });

  const app = await buildFastifyApp({
    wsHub,
    workspaceMgr,
    webRoot: config.webRoot,
    config,
    authSessionRepo,
    authLoginBlockRepo,
    appearanceAssetRepo,
    logger: {
      level: "info",
      transport: {
        target: "pino-pretty",
        options: {
          translateTime: "HH:MM:ss Z",
          ignore: "pid,hostname",
        },
      },
    },
  });

  wsHub.setLogger(app.log);
  workspaceMgr.setLogger(app.log);
  workspaceMgr.hydrateWatchers();

  const lspManifestStore = new FileManifestStore(resolveLspToolRoot(stateRoot));
  const lspToolMgr = new LspToolManager({
    manifestStore: lspManifestStore,
  });
  const lspToolInstallMgr = new LspToolInstallManager({
    manifestStore: lspManifestStore,
  });

  lspMgr = new LspManager({
    workspaceMgr: { get: (workspaceId) => workspaceMgr.get(workspaceId) },
    eventBus,
    logger: app.log,
    requestTimeoutMs: 2000,
    idleTtlMs: 60_000,
    restartLimit: 2,
    lspToolMgr,
  });
  const persistedLspMode = settingsRepo.get<"auto" | "off">("lsp.mode");
  if (persistedLspMode === "off") {
    await lspMgr.setRuntimeMode("off");
  }

  const supervisorRepo = new SupervisorRepo();
  supervisorMgr = new SupervisorManager({
    eventBus,
    broadcaster: wsHub,
    terminalMgr,
    workspaceMgr,
    sessionMgr,
    providerRegistry,
    providerConfigRepo,
    settingsRepo,
    supervisorRepo,
    targetStore,
    logger: app.log,
  });
  await sessionMgr.hydrate();
  supervisorMgr.start();

  const providerMockOverrides = createE2EProviderMockOverrides();
  const providerRuntimeDeps: RuntimeStatusDeps = providerMockOverrides
    ? {
        commandExists: providerMockOverrides.commandExists,
      }
    : {};
  const providerInstallMgr = new ProviderInstallManager(providerRegistry, {
    ...providerRuntimeDeps,
    runCommand: providerMockOverrides?.runCommand ?? runCommandAsString,
  });

  updateService = new UpdateService({
    settingsRepo,
    updateStateRepo,
    broadcaster: wsHub,
    runtime: {
      ...config.update,
      currentVersion: config.appVersion ?? "0.0.0",
    },
    updateWorkerLogFilePath: join(stateRoot, "logs", "update-worker.log"),
    countRunningTerminals: () => terminalMgr.getAll().filter((terminal) => terminal.alive).length,
    countRunningSessions: () =>
      sessionMgr
        .getAll()
        .filter((session) => session.state === "starting" || session.state === "running").length,
    countActiveSupervisors: () => supervisorMgr?.countActive() ?? 0,
  });
  updateService.start();

  commandContext = {
    workspaceMgr,
    sessionMgr,
    terminalMgr,
    eventBus,
    broadcaster: wsHub,
    settingsRepo,
    providerConfigRepo,
    providerRegistry,
    fencingMgr,
    supervisorMgr,
    autoFetch,
    providerRuntimeDeps,
    providerInstallMgr,
    activationMgr,
    config,
    lspMgr,
    lspToolMgr,
    lspToolInstallMgr,
    updateService,
  };

  wsHub.setCommandContext(commandContext);

  await app.listen({
    host: config.host,
    port: config.port,
  });

  if (configOverrides?.writeRuntimeConfig ?? process.env.NODE_ENV === "production") {
    const runtime: RuntimeConfig = {
      host: config.host,
      port: extractListenPort(app) ?? config.port,
      pid: process.pid,
      token: `server-${process.pid}`,
      serverInstanceId: `server-${process.pid}`,
      startedAt: Date.now(),
    };
    process.env.CODER_STUDIO_RUNTIME_JSON_PATH = getRuntimePath();
    writeRuntimeConfig(runtime);
  }

  const gcTimer = setTimeout(() => {
    runStartupGc(config.uploadsDir, app.log).catch((err) =>
      app.log.warn({ err }, "startup GC failed")
    );
  }, STARTUP_GC_DELAY_MS);
  gcTimer.unref();

  const wsKeepaliveTimer = setInterval(() => {
    wsHub.pingAll();
  }, WS_KEEPALIVE_INTERVAL_MS);
  wsKeepaliveTimer.unref();

  let stopped = false;
  const stopServer = async () => {
    if (stopped) return;
    stopped = true;

    clearTimeout(gcTimer);
    clearInterval(wsKeepaliveTimer);
    await app.close();
    await lspMgr?.disposeAll();
    autoFetch.stop();
    supervisorMgr.stop();
    updateService?.stop();
    terminalMgr.shutdown();
    wsHub.destroy();
    eventBus.clear();
    if (shouldCleanupStateRoot) {
      rmSync(stateRoot, { recursive: true, force: true });
    }
    deleteRuntimeConfig();
  };

  const actualPort = extractListenPort(app) ?? config.port;
  console.log(`Server listening on http://${config.host}:${actualPort}`);

  return {
    app,
    stop: stopServer,
    __test__: { sessionMgr, commandContext },
  };
}

function extractListenPort(app: FastifyInstance): number | undefined {
  const address = app.server.address();
  if (address && typeof address === "object" && typeof address.port === "number") {
    return address.port;
  }
  return undefined;
}

function createPtyHost() {
  return new NodePtyHost();
}

if (isDirectExecution(import.meta.url)) {
  const server = await createServer();

  process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    await server.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("\nShutting down...");
    await server.stop();
    process.exit(0);
  });
}
