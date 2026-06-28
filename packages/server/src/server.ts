/**
 * Server Entry Point
 *
 * Creates and assembles all server components.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AutomationPermission, DomainEvent } from "@coder-studio/core";
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
import { AgentInstructionsPublisher } from "./agent-instructions/publisher.js";
import { buildFastifyApp } from "./app.js";
import { SessionTokenRepo } from "./auth/session-token-repo.js";
import { AutomationAuditLog } from "./automation/audit-log.js";
import { EventBus } from "./bus/event-bus.js";
import { CanvasService } from "./canvas/service.js";
import { registerAllCommands } from "./commands/index.js";
import {
  ensureStateDir,
  parseServerConfig,
  resolveConfiguredStateDir,
  type ServerConfigInput,
} from "./config.js";
import { AutoFetchScheduler } from "./git/auto-fetch.js";
import type { HostCommandContext } from "./host/context.js";
import { createRuntimeOrchestrator } from "./host/runtime-orchestrator.js";
import { RuntimeRegistry } from "./host/runtime-registry.js";
import { RuntimeRouter } from "./host/runtime-router.js";
import { WorkspaceRuntimeBindingStore } from "./host/workspace-runtime-binding.js";
import { HostCollector } from "./monitoring/host-collector.js";
import { createProcessTableCollector } from "./monitoring/process-table/index.js";
import { MonitoringService } from "./monitoring/service.js";
import { buildCustomProviderDefinition } from "./provider-runtime/custom-provider.js";
import { createE2EProviderMockOverrides } from "./provider-runtime/e2e-provider-mock.js";
import { type RuntimeStatusDeps } from "./provider-runtime/runtime-status.js";
import type { RuntimeHandle, RuntimeRouteTarget } from "./runtime/contract.js";
import { createNativeRuntime } from "./runtime/native-runtime.js";
import { buildRemoteStateSnapshot } from "./runtime/remote/state-snapshot.js";
import {
  issueRemoteSessionBootstrap,
  resolveWslSessionHostApiUrl,
} from "./runtime/wsl-bootstrap.js";
import type { RelayHostCommandInput } from "./runtime/wsl-host-api-proxy.js";
import { createWslRuntime } from "./runtime/wsl-runtime.js";
import { SessionManager } from "./session/manager.js";
import { AppearanceAssetRepo } from "./storage/repositories/appearance-asset-repo.js";
import { AuthLoginBlockRepo } from "./storage/repositories/auth-login-block-repo.js";
import { AuthSessionRepo } from "./storage/repositories/auth-session-repo.js";
import { CanvasRepo } from "./storage/repositories/canvas-repo.js";
import { CustomProviderRepo } from "./storage/repositories/custom-provider-repo.js";
import { MemoryRepo } from "./storage/repositories/memory-repo.js";
import { SettingsRepo } from "./storage/repositories/settings-repo.js";
import { UpdateStateRepo } from "./storage/repositories/update-state-repo.js";
import { WorkspaceRepo } from "./storage/repositories/workspace-repo.js";
import { UpdateService } from "./update/update-service.js";
import { deleteWorkspaceUploads, runStartupGc } from "./uploads/cleanup.js";
import { STARTUP_GC_DELAY_MS } from "./uploads/constants.js";
import { WorkspaceManager } from "./workspace/manager.js";
import { ActivationManager } from "./ws/activation.js";
import type { CommandContext } from "./ws/dispatch.js";
import {
  dispatch,
  dispatchRelayedSessionCommand,
  executeRuntimeCommandOnTarget,
} from "./ws/dispatch.js";
import { FencingManager } from "./ws/fencing.js";
import { WsHub } from "./ws/hub.js";

const WS_KEEPALIVE_INTERVAL_MS = 15_000;

function logStartupPhase(app: FastifyInstance | null, label: string, startedAt: number): void {
  const elapsedMs = Date.now() - startedAt;
  const message = `[startup] ${label}=${elapsedMs}ms`;
  if (app) {
    app.log.info(message);
    return;
  }

  console.log(message);
}

function resolveSessionAnalysisAutoRunTarget(
  bindings: WorkspaceRuntimeBindingStore,
  event: Extract<DomainEvent, { type: "session.state.changed" }>
): RuntimeRouteTarget {
  const boundWorkspaceId = bindings.findWorkspaceIdBySessionId(event.sessionId);
  if (boundWorkspaceId) {
    return { kind: "session", sessionId: event.sessionId };
  }

  if (!event.workspaceId) {
    return { kind: "default" };
  }

  return { kind: "workspace", workspaceId: event.workspaceId };
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export interface Server {
  app: FastifyInstance;
  stop: () => Promise<void>;
  __test__?: {
    sessionMgr: SessionManager;
    commandContext: CommandContext;
    hostContext: HostCommandContext;
    nativeRuntime: RuntimeHandle;
    sessionTokenRepo: SessionTokenRepo;
  };
}

export interface ServerRuntimeOptions {
  writeRuntimeConfig?: boolean;
}

export async function createServer(
  configOverrides?: ServerConfigInput & ServerRuntimeOptions
): Promise<Server> {
  const startupAt = Date.now();
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
  const runtimeBindings = new WorkspaceRuntimeBindingStore();
  const runtimeRegistry = new RuntimeRegistry();
  const runtimeRouter = new RuntimeRouter({
    runtimeRegistry,
    bindings: runtimeBindings,
    defaultRuntimeId: "native-default",
  });
  let runtimeOrchestrator: ReturnType<typeof createRuntimeOrchestrator> | undefined;
  let workspaceMgr: WorkspaceManager;
  let commandContext: CommandContext;
  let hostContext: HostCommandContext;
  let agentInstructionPublisher: AgentInstructionsPublisher | undefined;
  let activeApp: FastifyInstance | null = null;
  const sessionTokenRepo = new SessionTokenRepo();

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

  const customProviderRepo = new CustomProviderRepo({
    filePath: join(stateRoot, "state", "custom-providers.json"),
  });
  let activeProviderRegistry = [
    ...providerRegistry,
    ...customProviderRepo.list().map((config) => buildCustomProviderDefinition(config)),
  ];
  const providerMockOverrides = createE2EProviderMockOverrides();
  const providerRuntimeDeps: RuntimeStatusDeps = providerMockOverrides
    ? {
        commandExists: providerMockOverrides.commandExists,
        runCommand: providerMockOverrides.runCommand,
      }
    : {};
  const workspaceRepo = new WorkspaceRepo({
    filePath: join(stateRoot, "state", "workspaces.json"),
  });
  const automationAuditLog = new AutomationAuditLog({
    filePath: join(stateRoot, "state", "automation-audit.jsonl"),
  });
  const memoryRepo = new MemoryRepo({
    rootDir: join(stateRoot, "state", "memory", "workspaces"),
  });
  const canvasRepo = new CanvasRepo({
    rootDir: join(stateRoot, "state", "canvases", "workspaces"),
  });
  const canvasService = new CanvasService({
    canvasRepo,
    now: () => Date.now(),
  });

  const hostBridge = {
    issueSessionToken: (input: {
      sessionId: string;
      workspaceId: string;
      providerId: string;
      permissions: readonly AutomationPermission[];
    }) => sessionTokenRepo.issue(input),
    revokeSessionTokensBySessionId: (sessionId: string) => {
      sessionTokenRepo.revokeBySessionId(sessionId);
    },
    getHostApiUrl: () => {
      const port = activeApp ? (extractListenPort(activeApp) ?? config.port) : config.port;
      return `http://${config.host === "0.0.0.0" ? "127.0.0.1" : config.host}:${port}`;
    },
    emitDomainEvent: (event: DomainEvent) => {
      eventBus.emit(event);
    },
    broadcast: (topic: string, payload: unknown) => {
      wsHub.broadcast(topic, payload);
    },
    recordWorkspaceFetch: (workspaceId: string) => {
      workspaceMgr.recordFetch(workspaceId);
    },
    resolveClientOwnerId: (clientId: string) => {
      const activeLease = activationMgr.getLease();
      if (activeLease?.wsClientId === clientId) {
        return activeLease.clientInstanceId;
      }

      return clientId;
    },
    sendToClient: (clientId: string, payload: unknown) => {
      return wsHub.sendToClient(clientId as never, payload as never);
    },
    sendBinaryToClient: (clientId: string, payload: Buffer) => {
      return wsHub.sendBinaryToClient(clientId as never, payload);
    },
  };
  let updateService: UpdateService | undefined;
  let monitoringService: MonitoringService | undefined;
  let nativeRuntime: RuntimeHandle;
  let teardownNativeRuntime: RuntimeHandle | undefined;

  workspaceMgr = new WorkspaceManager({
    workspaceRepo,
    eventBus,
    broadcaster: wsHub,
    autoFetch,
    onDirty: (workspaceId) => {
      agentInstructionPublisher?.scheduleWorkspaceSync(workspaceId);
    },
    teardown: async (workspaceId) => {
      const runtimeId = runtimeBindings.getRuntimeIdForWorkspace(workspaceId);
      const runtime = runtimeId ? runtimeRegistry.get(runtimeId) : teardownNativeRuntime;

      memoryRepo.removeWorkspace(workspaceId);
      canvasRepo.removeWorkspace(workspaceId);
      await runtimeOrchestrator?.disposeWorkspaceRuntime(workspaceId);

      const resources = runtime?.getResources?.();
      if (!resources) {
        return;
      }

      const persistedSessions = resources.sessionRepo.findByWorkspaceId(workspaceId);
      for (const session of persistedSessions) {
        resources.sessionRepo.delete(session.id);
        resources.sessionMetadataRepo.delete(session.id);
      }

      for (const terminal of resources.terminalRepo.listByWorkspace(workspaceId)) {
        resources.terminalRepo.delete(terminal.id);
      }
    },
    onClose: (workspaceId) =>
      deleteWorkspaceUploads(config.uploadsDir, workspaceId).catch((err) =>
        console.warn("[uploads] cascade cleanup failed", { wsId: workspaceId, err })
      ),
  });

  const buildCurrentRemoteStateSnapshot = () =>
    buildRemoteStateSnapshot({
      settings: settingsRepo.getAll(),
      workspaces: workspaceMgr.list(),
      customProviders: customProviderRepo.list(),
    });

  const syncRemoteRuntimeSnapshot = async (): Promise<void> => {
    if (runtimeRegistry.listByKind("wsl").length === 0) {
      return;
    }

    await runtimeRegistry.syncSnapshot(buildCurrentRemoteStateSnapshot());
  };

  const scheduleRemoteRuntimeSnapshotSync = (reason: string): void => {
    void syncRemoteRuntimeSnapshot().catch((error) => {
      activeApp?.log.warn({ err: error, reason }, "remote runtime snapshot sync failed");
    });
  };

  const relayHostCommandRef: {
    current?: (input: RelayHostCommandInput) => ReturnType<typeof dispatchRelayedSessionCommand>;
  } = {};

  const authSessionRepo = new AuthSessionRepo({
    filePath: join(stateRoot, "state", "auth-sessions.json"),
  });
  const authLoginBlockRepo = new AuthLoginBlockRepo({
    filePath: join(stateRoot, "state", "auth-login-blocks.json"),
  });
  const appearanceAssetRepo = new AppearanceAssetRepo({
    filePath: join(stateRoot, "state", "appearance-assets.json"),
  });

  nativeRuntime = await createNativeRuntime({
    runtimeId: "native-default",
    stateRoot,
    hostBridge,
    providerRegistry: activeProviderRegistry,
    workspaceLookup: {
      get: (workspaceId) => workspaceMgr.get(workspaceId),
      list: () => workspaceMgr.list(),
    },
    providerRuntimeDeps,
    settingsRepo,
  });
  teardownNativeRuntime = nativeRuntime;
  runtimeRegistry.register(nativeRuntime);
  runtimeOrchestrator = createRuntimeOrchestrator({
    runtimeRegistry,
    bindings: runtimeBindings,
    workspaceLookup: {
      get: (workspaceId) => workspaceMgr.get(workspaceId),
    },
    nativeRuntimeId: "native-default",
    createWslRuntime: async (workspace, runtimeId) => {
      return createWslRuntime({
        runtimeId,
        workspace,
        stateRoot,
        hostBridge,
        providerRegistry: activeProviderRegistry,
        workspaceLookup: {
          get: (workspaceId) => workspaceMgr.get(workspaceId),
          list: () => workspaceMgr.list(),
        },
        settingsSnapshot: settingsRepo.getAll(),
        customProviderConfigs: customProviderRepo.list(),
        providerRuntimeDeps,
        createSessionBootstrap: async ({
          workspaceId,
          providerId,
          runtimeId: sessionRuntimeId,
        }) => {
          return issueRemoteSessionBootstrap({
            sessionTokenRepo,
            workspaceId,
            providerId,
            runtimeId: sessionRuntimeId,
            callbackApiUrl: resolveWslSessionHostApiUrl(),
          });
        },
        relayHostCommand: (input) => {
          const relay = relayHostCommandRef.current;
          if (!relay) {
            throw {
              code: "relay_unavailable",
              message: "Host command relay is not ready",
            };
          }
          return relay(input);
        },
        resolveClientOwnerId: (clientId: string) => {
          const activeLease = activationMgr.getLease();
          if (activeLease?.wsClientId === clientId) {
            return activeLease.clientInstanceId;
          }

          return clientId;
        },
        revokeRuntimeTokens: (runtimeIdToRevoke: string) => {
          sessionTokenRepo.revokeByRuntimeId(runtimeIdToRevoke);
        },
        runtimeBindings,
      });
    },
  });

  const runtimeContext = nativeRuntime.getContext?.();
  const runtimeResources = nativeRuntime.getResources?.();
  if (!runtimeContext || !runtimeResources) {
    throw new Error("Native runtime did not expose assembly context/resources");
  }
  const {
    sessionMgr,
    terminalMgr,
    taskMgr,
    lspMgr,
    lspToolMgr,
    lspToolInstallMgr,
    supervisorMgr,
    providerInstallMgr,
    systemDependencyInstallMgr,
    skillLibraryRepo,
    skillTargetRepo,
    skillMountRepo,
    skillInstallMgr,
    skillMountMgr,
    skillHealthMgr,
    builtinSkillSyncMgr,
    sessionMetadataRepo,
    sessionAnalysisService,
    workAnalysisService,
    managedProcessRegistry,
    skillsHubClient,
    providerConfigRepo,
  } = runtimeResources;

  logStartupPhase(null, "builtinSkillSync", startupAt);

  const app = await buildFastifyApp({
    wsHub,
    workspaceMgr,
    skillLibraryRepo,
    runtimeRouter,
    webRoot: config.webRoot,
    config,
    authSessionRepo,
    authLoginBlockRepo,
    sessionTokenRepo,
    appearanceAssetRepo,
    canvasService,
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
  activeApp = app;
  logStartupPhase(app, "buildFastifyApp", startupAt);

  wsHub.setLogger(app.log);
  workspaceMgr.setLogger(app.log);
  supervisorMgr.setLogger(app.log);
  agentInstructionPublisher = new AgentInstructionsPublisher({
    workspaceMgr,
    getProviderRegistry: () => activeProviderRegistry,
    commandExists: providerRuntimeDeps.commandExists,
    logger: app.log,
  });
  runtimeContext.agentInstructionPublisher = agentInstructionPublisher;
  eventBus.on("fs.dirty", ({ workspaceId }) => {
    if (!workspaceId) {
      return;
    }
    agentInstructionPublisher?.scheduleWorkspaceSync(workspaceId);
  });

  logStartupPhase(app, "sessionHydrate", startupAt);

  await runtimeOrchestrator.rehydrateWorkspaces(workspaceMgr.list());
  for (const session of sessionMgr.getAll()) {
    runtimeBindings.bindSession(session);
  }
  for (const terminal of terminalMgr.getAll()) {
    runtimeBindings.bindTerminal(terminal.toDTO());
  }

  eventBus.on<Extract<DomainEvent, { type: "workspace.meta.changed" }>>(
    "workspace.meta.changed",
    (event) => {
      void (async () => {
        try {
          await runtimeOrchestrator?.syncWorkspaceBinding(event.workspaceId);
          await syncRemoteRuntimeSnapshot();
        } catch (error) {
          activeApp?.log.warn(
            {
              err: error,
              workspaceId: event.workspaceId,
            },
            "workspace runtime sync failed"
          );
        }
      })();
    }
  );
  eventBus.on<Extract<DomainEvent, { type: "session.state.changed" }>>(
    "session.state.changed",
    (event) => {
      if (event.session) {
        runtimeBindings.bindSession(event.session);
      }
    }
  );
  eventBus.on<Extract<DomainEvent, { type: "session.lifecycle" }>>("session.lifecycle", (event) => {
    if (event.event === "removed") {
      runtimeBindings.removeSession(event.sessionId);
    }
  });
  eventBus.on<Extract<DomainEvent, { type: "terminal.created" }>>("terminal.created", (event) => {
    runtimeBindings.bindTerminal({
      id: event.terminalId,
      workspaceId: event.workspaceId,
      kind: event.kind,
      title: event.title,
      cwd: event.cwd,
      argv: [],
      cols: 120,
      rows: 30,
      alive: true,
      createdAt: Date.now(),
    });
  });
  eventBus.on<Extract<DomainEvent, { type: "terminal.exited" }>>("terminal.exited", (event) => {
    runtimeBindings.removeTerminal(event.terminalId);
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
  monitoringService = new MonitoringService({
    broadcaster: wsHub,
    settingsRepo,
    registry: managedProcessRegistry,
    sessionMgr,
    workspaceMgr,
    terminalMgr,
    hostCollector: new HostCollector(),
    processCollector: createProcessTableCollector(),
  });

  hostContext = {
    workspaceMgr,
    sessionMgr,
    terminalMgr,
    settingsRepo,
    memoryRepo,
    activationMgr,
    automationAuditLog,
    broadcaster: wsHub,
    autoFetch,
    runtimeRouter,
    runtimeBindings,
    runtimeRegistry,
    runtimeOrchestrator,
    fencingMgr,
    config,
    updateService,
    monitoringService,
    customProviderRepo,
    providerRegistry: activeProviderRegistry,
    setProviderRegistry: (providers) => {
      activeProviderRegistry = providers;
      hostContext.providerRegistry = providers;
      commandContext.providerRegistry = providers;
      runtimeRegistry.setProviderRegistry(providers);
      scheduleRemoteRuntimeSnapshotSync("host.setProviderRegistry");
    },
  };

  await registerAllCommands();

  commandContext = {
    workspaceMgr,
    sessionMgr,
    terminalMgr,
    taskMgr,
    eventBus,
    broadcaster: wsHub,
    settingsRepo,
    providerConfigRepo,
    providerRegistry: activeProviderRegistry,
    fencingMgr,
    supervisorMgr,
    autoFetch,
    runtimeRouter,
    runtimeBindings,
    runtimeRegistry,
    runtimeOrchestrator,
    providerRuntimeDeps,
    providerInstallMgr,
    systemDependencyInstallMgr,
    activationMgr,
    canvasService,
    config,
    lspMgr,
    lspToolMgr,
    lspToolInstallMgr,
    updateService,
    customProviderRepo,
    sessionMetadataRepo,
    sessionAnalysisService,
    workAnalysisService,
    setProviderRegistry: (providers) => {
      activeProviderRegistry = providers;
      hostContext.providerRegistry = providers;
      commandContext.providerRegistry = providers;
      runtimeRegistry.setProviderRegistry(providers);
      scheduleRemoteRuntimeSnapshotSync("command.setProviderRegistry");
    },
    monitoringService,
    skillsHubClient,
    skillInstallMgr,
    skillMountMgr,
    skillHealthMgr,
    skillLibraryRepo,
    skillTargetRepo,
    skillMountRepo,
    builtinSkillSyncMgr,
    automationAuditLog,
    memoryRepo,
    stateRoot,
    sessionTokenRepo,
    agentInstructionPublisher,
  };

  wsHub.setCommandContext(commandContext);

  relayHostCommandRef.current = (input) =>
    dispatchRelayedSessionCommand(
      { kind: "command", id: input.id, op: input.op, args: input.args },
      commandContext,
      input.sessionToken ?? ""
    );

  eventBus.on(
    "session.state.changed",
    (event: Extract<DomainEvent, { type: "session.state.changed" }>) => {
      if (event.to !== "ended") {
        return;
      }

      void executeRuntimeCommandOnTarget(
        "session.analysis.run",
        {
          sessionId: event.sessionId,
          ...(event.session ? { sessionSnapshot: event.session } : {}),
        },
        commandContext,
        undefined,
        resolveSessionAnalysisAutoRunTarget(runtimeBindings, event)
      ).catch((error) => {
        const code = getErrorCode(error);
        if (code === "session_analysis_context_unavailable") {
          app.log.debug(
            {
              err: error,
              sessionId: event.sessionId,
            },
            "Session analysis auto-run skipped because session context is unavailable"
          );
          return;
        }

        app.log.warn(
          {
            err: error,
            sessionId: event.sessionId,
          },
          "Session analysis auto-run failed"
        );
      });
    }
  );

  await app.listen({
    host: config.host,
    port: config.port,
  });
  logStartupPhase(app, "listen", startupAt);

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
  logStartupPhase(app, "runtimeConfigWritten", startupAt);

  const runPostListenWarmup = async (): Promise<void> => {
    workspaceMgr.hydrateWatchers();
    await agentInstructionPublisher.syncAllOpenWorkspaces();
    updateService.start();
    monitoringService.start();
  };

  void runPostListenWarmup().catch((error) => {
    app.log.warn({ err: error }, "post-listen warmup failed");
  });
  logStartupPhase(app, "postListenWarmupScheduled", startupAt);

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
    autoFetch.stop();
    monitoringService?.stop();
    updateService?.stop();
    await runtimeOrchestrator?.stopAllRuntimes();
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
    __test__: {
      sessionMgr,
      commandContext,
      hostContext,
      nativeRuntime,
      sessionTokenRepo,
    },
  };
}

function extractListenPort(app: FastifyInstance): number | undefined {
  const address = app.server.address();
  if (address && typeof address === "object" && typeof address.port === "number") {
    return address.port;
  }
  return undefined;
}

if (isDirectExecution(import.meta.url) && process.env.CODER_STUDIO_WSL_RUNTIME_ENTRY !== "1") {
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
