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
import { RuntimeRegistry } from "./host/runtime-registry.js";
import { RuntimeRouter } from "./host/runtime-router.js";
import { WorkspaceRuntimeBindingStore } from "./host/workspace-runtime-binding.js";
import { LspManager } from "./lsp/manager.js";
import { LspToolInstallManager } from "./lsp-tools/install-manager.js";
import { LspToolManager } from "./lsp-tools/manager.js";
import { FileManifestStore } from "./lsp-tools/manifest-store.js";
import { resolveLspToolRoot } from "./lsp-tools/tool-root.js";
import { HostCollector } from "./monitoring/host-collector.js";
import { ManagedProcessRegistry } from "./monitoring/managed-process-registry.js";
import { createProcessTableCollector } from "./monitoring/process-table/index.js";
import { MonitoringService } from "./monitoring/service.js";
import { runCommandAsString } from "./provider-runtime/command-runner.js";
import { buildCustomProviderDefinition } from "./provider-runtime/custom-provider.js";
import { createE2EProviderMockOverrides } from "./provider-runtime/e2e-provider-mock.js";
import { ProviderInstallManager } from "./provider-runtime/install-manager.js";
import {
  buildProviderRuntimeStatus,
  type RuntimeStatusDeps,
} from "./provider-runtime/runtime-status.js";
import type { RuntimeHandle } from "./runtime/contract.js";
import { createNativeRuntime } from "./runtime/native-runtime.js";
import { SessionManager } from "./session/manager.js";
import { SessionAnalysisRunner } from "./session-analysis/runner.js";
import { SessionAnalysisService } from "./session-analysis/service.js";
import { BuiltinSkillSyncManager } from "./skills/builtin/sync-manager.js";
import { SkillHealthManager } from "./skills/health-manager.js";
import { SkillInstallManager } from "./skills/install-manager.js";
import { resolveDefaultLocalSkillRoots } from "./skills/local-skill-scanner.js";
import { SkillMountManager } from "./skills/mount-manager.js";
import { SkillsHubClient } from "./skills/skills-hub-client.js";
import { AppearanceAssetRepo } from "./storage/repositories/appearance-asset-repo.js";
import { AuthLoginBlockRepo } from "./storage/repositories/auth-login-block-repo.js";
import { AuthSessionRepo } from "./storage/repositories/auth-session-repo.js";
import { CanvasAnchorCommentRepo } from "./storage/repositories/canvas-anchor-comment-repo.js";
import { CanvasOverlayRepo } from "./storage/repositories/canvas-overlay-repo.js";
import { CanvasRepo } from "./storage/repositories/canvas-repo.js";
import { CanvasSnapshotRepo } from "./storage/repositories/canvas-snapshot-repo.js";
import { CustomProviderRepo } from "./storage/repositories/custom-provider-repo.js";
import { MemoryRepo } from "./storage/repositories/memory-repo.js";
import { ProviderConfigRepo } from "./storage/repositories/provider-config-repo.js";
import { SessionAnalysisRepo } from "./storage/repositories/session-analysis-repo.js";
import { SessionMetadataRepo } from "./storage/repositories/session-metadata-repo.js";
import { SessionRepo } from "./storage/repositories/session-repo.js";
import { SettingsRepo } from "./storage/repositories/settings-repo.js";
import { SkillLibraryRepo } from "./storage/repositories/skill-library-repo.js";
import { SkillMountRepo } from "./storage/repositories/skill-mount-repo.js";
import { SkillTargetRepo } from "./storage/repositories/skill-target-repo.js";
import { SupervisorRepo } from "./storage/repositories/supervisor-repo.js";
import { TerminalRepo } from "./storage/repositories/terminal-repo.js";
import { UpdateStateRepo } from "./storage/repositories/update-state-repo.js";
import { WorkAnalysisRepo } from "./storage/repositories/work-analysis-repo.js";
import { WorkspaceRepo } from "./storage/repositories/workspace-repo.js";
import { SupervisorManager } from "./supervisor/manager.js";
import * as targetStore from "./supervisor/target-store.js";
import { SystemDependencyInstallManager } from "./system-deps/install-manager.js";
import { TaskManager } from "./tasks/manager.js";
import { TerminalManager } from "./terminal/manager.js";
import { NodePtyHost } from "./terminal/pty-host.js";
import { UpdateService } from "./update/update-service.js";
import { deleteWorkspaceUploads, runStartupGc } from "./uploads/cleanup.js";
import { STARTUP_GC_DELAY_MS } from "./uploads/constants.js";
import { WorkDeepAnalysisRunner } from "./work-analysis/deep-runner.js";
import { createClaudeWorkLogSource } from "./work-analysis/log-sources/claude.js";
import { createCodexWorkLogSource } from "./work-analysis/log-sources/codex.js";
import { createWorkLogCollector } from "./work-analysis/log-sources/collector.js";
import { createCursorWorkLogSource } from "./work-analysis/log-sources/cursor.js";
import { createGeminiWorkLogSource } from "./work-analysis/log-sources/gemini.js";
import { createOpenCodeWorkLogSource } from "./work-analysis/log-sources/opencode.js";
import { WorkAnalysisService } from "./work-analysis/service.js";
import { WorkspaceManager } from "./workspace/manager.js";
import { ActivationManager } from "./ws/activation.js";
import type { CommandContext } from "./ws/dispatch.js";
import { dispatch } from "./ws/dispatch.js";
import { FencingManager } from "./ws/fencing.js";
import { WsHub } from "./ws/hub.js";

const WS_KEEPALIVE_INTERVAL_MS = 15_000;
const INITIAL_WATCHER_RESTORE_COUNT = 2;
const WATCHER_RESTORE_BATCH_SIZE = 2;
const WATCHER_RESTORE_BATCH_INTERVAL_MS = 750;
const INITIAL_AGENT_SYNC_COUNT = 1;
const AGENT_SYNC_BATCH_SIZE = 2;
const AGENT_SYNC_BATCH_INTERVAL_MS = 1_000;
const POST_LISTEN_AGENT_SYNC_DELAY_MS = 1_000;
const POST_LISTEN_UPDATE_SERVICE_DELAY_MS = 5_000;
const POST_LISTEN_WORK_ANALYSIS_DELAY_MS = 10_000;

function logStartupPhase(app: FastifyInstance | null, label: string, startedAt: number): void {
  const elapsedMs = Date.now() - startedAt;
  const message = `[startup] ${label}=${elapsedMs}ms`;
  if (app) {
    app.log.info(message);
    return;
  }

  console.log(message);
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
  let workspaceMgr: WorkspaceManager;
  let commandContext: CommandContext;
  let hostContext: HostCommandContext;
  let agentInstructionPublisher: AgentInstructionsPublisher | undefined;
  let lspMgr: LspManager | null = null;
  const managedProcessRegistry = new ManagedProcessRegistry({
    now: () => Date.now(),
  });

  const terminalRepo = new TerminalRepo({
    filePath: join(stateRoot, "state", "terminals.json"),
  });
  const sessionRepo = new SessionRepo({
    filePath: join(stateRoot, "state", "sessions.json"),
  });
  const sessionTokenRepo = new SessionTokenRepo();

  const terminalMgr = new TerminalManager({
    ptyHost: createPtyHost(),
    eventBus,
    db: terminalRepo,
  });
  const taskMgr = new TaskManager({
    eventBus,
    terminalMgr,
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
  const skillLibraryRepo = new SkillLibraryRepo({
    filePath: join(stateRoot, "state", "skills", "library-index.json"),
    builtinRoot: join(stateRoot, "state", "skills", "builtin"),
    managedLibraryRoot: join(stateRoot, "state", "skills", "library"),
    customSkillRoot: join(stateRoot, "state", "skills", "custom"),
    externalSkillRoots: resolveDefaultLocalSkillRoots(),
  });
  const skillTargetRepo = new SkillTargetRepo({
    filePath: join(stateRoot, "state", "skills", "targets.json"),
  });
  const skillMountRepo = new SkillMountRepo({
    filePath: join(stateRoot, "state", "skills", "mounts.json"),
  });
  const skillsHubClient = new SkillsHubClient({ runCommand: runCommandAsString });
  const skillLibraryRoot = join(stateRoot, "state", "skills", "library");
  const skillMountMgr = new SkillMountManager({
    getProviderRegistry: () => activeProviderRegistry,
    skillLibraryRepo,
    skillMountRepo,
  });
  const skillInstallMgr = new SkillInstallManager({
    skillsHubClient,
    skillLibraryRepo,
    libraryRoot: skillLibraryRoot,
    skillMountMgr,
    getInstalledSkillTargetProviderIds: async () => {
      const runtimeStatus = await buildProviderRuntimeStatus(
        activeProviderRegistry,
        providerRuntimeDeps
      );
      return Object.values(runtimeStatus.providers)
        .filter((provider) => provider.available && provider.supportsSkillsMount)
        .map((provider) => provider.providerId);
    },
  });
  const skillHealthMgr = new SkillHealthManager({
    getProviderRegistry: () => activeProviderRegistry,
    skillLibraryRepo,
  });
  const workspaceRepo = new WorkspaceRepo({
    filePath: join(stateRoot, "state", "workspaces.json"),
  });
  const sessionMetadataRepo = new SessionMetadataRepo({
    workspaceLookup: {
      list: () => workspaceMgr.list(),
      get: (workspaceId) => workspaceMgr.get(workspaceId),
    },
  });
  const sessionAnalysisRepo = new SessionAnalysisRepo({
    filePath: join(stateRoot, "state", "session-analysis.json"),
  });
  const workAnalysisRepo = new WorkAnalysisRepo({
    filePath: join(stateRoot, "state", "work-analysis.sqlite"),
    legacyJsonFilePath: join(stateRoot, "state", "work-analysis.json"),
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
  const canvasOverlayRepo = new CanvasOverlayRepo({
    rootDir: join(stateRoot, "state", "canvas-overlays", "workspaces"),
  });
  const canvasAnchorCommentRepo = new CanvasAnchorCommentRepo({
    rootDir: join(stateRoot, "state", "canvas-anchor-comments", "workspaces"),
  });
  const canvasSnapshotRepo = new CanvasSnapshotRepo({
    filePath: join(stateRoot, "state", "canvases", "snapshots.json"),
  });
  const canvasService = new CanvasService({
    canvasRepo,
    canvasAnchorCommentRepo,
    canvasOverlayRepo,
    canvasSnapshotRepo,
    now: () => Date.now(),
  });
  const builtinSkillSyncMgr = new BuiltinSkillSyncManager({
    builtinRoot: join(stateRoot, "state", "skills", "builtin"),
    getProviderRegistry: () => activeProviderRegistry,
    skillLibraryRepo,
    skillMountRepo,
    skillMountMgr,
    settingsRepo,
  });
  await builtinSkillSyncMgr.sync();
  logStartupPhase(null, "builtinSkillSync", startupAt);

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
    getHostApiUrl: () =>
      `http://${config.host === "0.0.0.0" ? "127.0.0.1" : config.host}:${config.port}`,
    emitDomainEvent: (event: DomainEvent) => {
      eventBus.emit(event);
    },
    broadcast: (topic: string, payload: unknown) => {
      wsHub.broadcast(topic, payload);
    },
    recordWorkspaceFetch: (workspaceId: string) => {
      workspaceMgr.recordFetch(workspaceId);
    },
    sendToClient: (clientId: string, payload: unknown) => {
      return wsHub.sendToClient(clientId as never, payload as never);
    },
    sendBinaryToClient: (clientId: string, payload: Buffer) => {
      return wsHub.sendBinaryToClient(clientId as never, payload);
    },
  };

  const sessionMgr = new SessionManager({
    terminalMgr,
    eventBus,
    db: sessionRepo,
    broadcaster: wsHub,
    providerRegistry: activeProviderRegistry,
    providerConfigRepo,
    hostBridge,
  });

  let supervisorMgr: SupervisorManager | undefined;
  let updateService: UpdateService | undefined;
  let monitoringService: MonitoringService | undefined;
  const sessionAnalysisRunner = new SessionAnalysisRunner({
    providerRegistry: activeProviderRegistry,
    providerConfigRepo,
  });
  const sessionAnalysisService = new SessionAnalysisService({
    repo: sessionAnalysisRepo,
    sessionMgr,
    workspaceMgr: {
      get: (workspaceId) => workspaceMgr.get(workspaceId),
    } as WorkspaceManager,
    runner: sessionAnalysisRunner,
  });
  const workLogCollector = createWorkLogCollector({
    sources: [
      createClaudeWorkLogSource(),
      createCodexWorkLogSource(),
      createGeminiWorkLogSource(),
      createCursorWorkLogSource(),
      createOpenCodeWorkLogSource(),
    ],
  });
  const workAnalysisService = new WorkAnalysisService({
    repo: workAnalysisRepo,
    workspaceMgr: {
      get: (workspaceId) => workspaceMgr.get(workspaceId),
    } as WorkspaceManager,
    workLogCollector,
    skillLibraryRepo,
    skillMountRepo,
    deepRunner: new WorkDeepAnalysisRunner({
      providerRegistry: activeProviderRegistry,
      providerConfigRepo,
    }),
  });

  workspaceMgr = new WorkspaceManager({
    workspaceRepo,
    eventBus,
    broadcaster: wsHub,
    autoFetch,
    onDirty: (workspaceId) => {
      agentInstructionPublisher?.scheduleWorkspaceSync(workspaceId);
    },
    teardown: async (workspaceId) => {
      const persistedSessions = sessionRepo.findByWorkspaceId(workspaceId);
      await lspMgr?.disposeWorkspace(workspaceId);
      await supervisorMgr?.deleteForWorkspace(workspaceId);
      await sessionMgr.stopForWorkspace(workspaceId);
      taskMgr.clearWorkspace(workspaceId);
      await terminalMgr.closeForWorkspace(workspaceId);
      sessionMgr.deleteEndedForWorkspace(workspaceId);
      memoryRepo.removeWorkspace(workspaceId);
      canvasRepo.removeWorkspace(workspaceId);

      for (const session of persistedSessions) {
        sessionRepo.delete(session.id);
        sessionMetadataRepo.delete(session.id);
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
    skillLibraryRepo,
    webRoot: config.webRoot,
    config,
    authSessionRepo,
    authLoginBlockRepo,
    sessionTokenRepo,
    appearanceAssetRepo,
    canvasService,
    logger:
      process.env.CODER_STUDIO_LOG_FORMAT === "json"
        ? { level: "info" }
        : {
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
  logStartupPhase(app, "buildFastifyApp", startupAt);

  wsHub.setLogger(app.log);
  workspaceMgr.setLogger(app.log);
  agentInstructionPublisher = new AgentInstructionsPublisher({
    workspaceMgr,
    getProviderRegistry: () => activeProviderRegistry,
    commandExists: providerRuntimeDeps.commandExists,
    logger: app.log,
  });
  eventBus.on("fs.dirty", ({ workspaceId }) => {
    if (!workspaceId) {
      return;
    }
    agentInstructionPublisher?.scheduleWorkspaceSync(workspaceId);
  });
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
    // Semantic queries (hover/definition/references/...) should fail fast so
    // the editor's "Loading..." popup doesn't linger. 8s is comfortable for
    // any LSP that's actually responsive.
    requestTimeoutMs: 8_000,
    // The one-off `initialize` request is a different beast — rust-analyzer
    // can take 20-30s to scan a Cargo workspace and load proc-macros on
    // first boot, and the Vue companion can be slow to start tsserver too.
    // 60s is generous but caps the wait when the server is truly dead.
    initializeTimeoutMs: 60_000,
    idleTtlMs: 60_000,
    restartLimit: 2,
    lspToolMgr,
    managedProcessRegistry,
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
    providerRegistry: activeProviderRegistry,
    providerConfigRepo,
    settingsRepo,
    supervisorRepo,
    targetStore,
    logger: app.log,
  });
  await sessionMgr.hydrate();
  logStartupPhase(app, "sessionHydrate", startupAt);
  supervisorMgr.start();

  for (const workspace of workspaceMgr.list()) {
    runtimeBindings.bindWorkspace(workspace.id, "native-default");
  }
  for (const session of sessionMgr.getAll()) {
    runtimeBindings.bindSession(session);
  }
  for (const terminal of terminalMgr.getAll()) {
    runtimeBindings.bindTerminal(terminal.toDTO());
  }

  eventBus.on<Extract<DomainEvent, { type: "workspace.meta.changed" }>>(
    "workspace.meta.changed",
    (event) => {
      const workspace = workspaceMgr.get(event.workspaceId);
      if (!workspace) {
        runtimeBindings.unbindWorkspace(event.workspaceId);
        return;
      }

      const runtimeId = workspace.targetRuntime === "native" ? "native-default" : "native-default";
      runtimeBindings.bindWorkspace(workspace.id, runtimeId);
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

  const providerInstallMgr = new ProviderInstallManager(activeProviderRegistry, {
    ...providerRuntimeDeps,
    runCommand: providerMockOverrides?.runCommand ?? runCommandAsString,
  });
  const systemDependencyInstallMgr = new SystemDependencyInstallManager({
    ...providerRuntimeDeps,
    runCommand: providerMockOverrides?.runCommand ?? runCommandAsString,
    ptyHost: createPtyHost(),
    hostBridge,
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
      providerInstallMgr.setProviders(providers);
    },
  };

  await registerAllCommands();

  const nativeRuntime = await createNativeRuntime({
    runtimeId: "native-default",
    stateRoot,
    hostBridge,
    providerRegistry: activeProviderRegistry,
    workspaceLookup: {
      get: (workspaceId) => workspaceMgr.get(workspaceId),
      list: () => workspaceMgr.list(),
    },
    providerRuntimeDeps,
    contextOverrides: {
      eventBus,
      providerConfigRepo,
      providerRegistry: activeProviderRegistry,
      sessionMgr,
      terminalMgr,
      taskMgr,
      lspMgr,
      lspToolMgr,
      lspToolInstallMgr,
      supervisorMgr,
      providerRuntimeDeps,
      providerInstallMgr,
      systemDependencyInstallMgr,
      skillsHubClient,
      skillInstallMgr,
      skillMountMgr,
      skillHealthMgr,
      skillLibraryRepo,
      skillTargetRepo,
      skillMountRepo,
      builtinSkillSyncMgr,
      sessionMetadataRepo,
      sessionAnalysisService,
      workAnalysisService,
      agentInstructionPublisher,
    },
  });
  runtimeRegistry.register(nativeRuntime);

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
      providerInstallMgr.setProviders(providers);
      sessionMgr.setProviderRegistry(providers);
      supervisorMgr?.setProviderRegistry(providers);
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
    agentInstructionPublisher,
  };

  wsHub.setCommandContext(commandContext);

  eventBus.on(
    "session.state.changed",
    (event: Extract<DomainEvent, { type: "session.state.changed" }>) => {
      if (event.to !== "ended") {
        return;
      }

      void sessionAnalysisService.run({ sessionId: event.sessionId }).catch((error) => {
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

  const readyAgentInstructionPublisher = agentInstructionPublisher!;
  const readyUpdateService = updateService;
  const readyMonitoringService = monitoringService;
  const persistedWorkspaces = workspaceMgr.list();
  const isTestEnv =
    process.env.NODE_ENV === "test" ||
    process.env.VITEST === "true" ||
    process.env.VITEST_WORKER_ID !== undefined;
  const immediateWatcherRestoreCount = isTestEnv
    ? persistedWorkspaces.length
    : INITIAL_WATCHER_RESTORE_COUNT;
  const watcherRestoreBatchSize = isTestEnv
    ? persistedWorkspaces.length
    : WATCHER_RESTORE_BATCH_SIZE;
  const watcherRestoreBatchIntervalMs = isTestEnv ? 0 : WATCHER_RESTORE_BATCH_INTERVAL_MS;
  const immediateAgentSyncCount = isTestEnv ? persistedWorkspaces.length : INITIAL_AGENT_SYNC_COUNT;
  const agentSyncBatchSize = isTestEnv ? persistedWorkspaces.length : AGENT_SYNC_BATCH_SIZE;
  const agentSyncBatchIntervalMs = isTestEnv ? 0 : AGENT_SYNC_BATCH_INTERVAL_MS;
  const agentSyncDelayMs = isTestEnv ? 0 : POST_LISTEN_AGENT_SYNC_DELAY_MS;
  const updateServiceDelayMs = isTestEnv ? 0 : POST_LISTEN_UPDATE_SERVICE_DELAY_MS;
  const workAnalysisDelayMs = isTestEnv ? 0 : POST_LISTEN_WORK_ANALYSIS_DELAY_MS;
  let stopped = false;
  const warmupTimers = new Set<ReturnType<typeof setTimeout>>();
  const runWarmupTask = (task: string, runner: () => unknown): void => {
    if (stopped) {
      return;
    }

    try {
      const result = runner();
      if (result && typeof (result as Promise<unknown>).catch === "function") {
        void (result as Promise<unknown>).catch((error) => {
          app.log.warn({ err: error, task }, "post-listen warmup failed");
        });
      }
    } catch (error) {
      app.log.warn({ err: error, task }, "post-listen warmup failed");
    }
  };
  const scheduleWarmupTask = (task: string, delayMs: number, runner: () => unknown): void => {
    if (delayMs <= 0) {
      runWarmupTask(task, runner);
      return;
    }

    const timer = setTimeout(() => {
      warmupTimers.delete(timer);
      runWarmupTask(task, runner);
    }, delayMs);
    timer.unref?.();
    warmupTimers.add(timer);
  };

  scheduleWarmupTask("workspaceWatchers:recent", 0, () => {
    workspaceMgr.hydrateWatchers({
      workspaces: persistedWorkspaces.slice(0, immediateWatcherRestoreCount),
    });
  });
  for (
    let offset = immediateWatcherRestoreCount;
    offset < persistedWorkspaces.length;
    offset += watcherRestoreBatchSize
  ) {
    const batch = persistedWorkspaces.slice(offset, offset + watcherRestoreBatchSize);
    const batchIndex =
      Math.floor((offset - immediateWatcherRestoreCount) / watcherRestoreBatchSize) + 1;
    scheduleWarmupTask(
      `workspaceWatchers:batch:${batchIndex}`,
      watcherRestoreBatchIntervalMs * batchIndex,
      () => {
        workspaceMgr.hydrateWatchers({ workspaces: batch });
      }
    );
  }
  scheduleWarmupTask("monitoringService", 0, () => {
    readyMonitoringService.start();
  });
  const syncWorkspaceBatch = (batch: typeof persistedWorkspaces) =>
    Promise.all(
      batch.map((workspace) => readyAgentInstructionPublisher.syncWorkspace(workspace.id))
    );
  scheduleWarmupTask("workspaceInstructionSync:recent", agentSyncDelayMs, () =>
    syncWorkspaceBatch(persistedWorkspaces.slice(0, immediateAgentSyncCount))
  );
  for (
    let offset = immediateAgentSyncCount;
    offset < persistedWorkspaces.length;
    offset += agentSyncBatchSize
  ) {
    const batch = persistedWorkspaces.slice(offset, offset + agentSyncBatchSize);
    const batchIndex = Math.floor((offset - immediateAgentSyncCount) / agentSyncBatchSize) + 1;
    scheduleWarmupTask(
      `workspaceInstructionSync:batch:${batchIndex}`,
      agentSyncDelayMs + agentSyncBatchIntervalMs * batchIndex,
      () => syncWorkspaceBatch(batch)
    );
  }
  scheduleWarmupTask("updateService", updateServiceDelayMs, () => {
    readyUpdateService.start();
  });
  scheduleWarmupTask("workAnalysisAutoScan", workAnalysisDelayMs, () => {
    workAnalysisService.startAutoScan();
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

  const stopServer = async () => {
    if (stopped) return;
    stopped = true;

    clearTimeout(gcTimer);
    clearInterval(wsKeepaliveTimer);
    for (const timer of warmupTimers) {
      clearTimeout(timer);
    }
    warmupTimers.clear();
    await app.close();
    await lspMgr?.disposeAll();
    autoFetch.stop();
    supervisorMgr.stop();
    monitoringService?.stop();
    updateService?.stop();
    workAnalysisService.stopAutoScan();
    workAnalysisRepo.close();
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

function createPtyHost() {
  return new NodePtyHost();
}
