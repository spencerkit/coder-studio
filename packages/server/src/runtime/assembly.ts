import { join } from "node:path";
import { EventBus } from "../bus/event-bus.js";
import { LspManager } from "../lsp/manager.js";
import { LspToolInstallManager } from "../lsp-tools/install-manager.js";
import { LspToolManager } from "../lsp-tools/manager.js";
import { FileManifestStore } from "../lsp-tools/manifest-store.js";
import { resolveLspToolRoot } from "../lsp-tools/tool-root.js";
import { ManagedProcessRegistry } from "../monitoring/managed-process-registry.js";
import { runCommandAsString } from "../provider-runtime/command-runner.js";
import { ProviderInstallManager } from "../provider-runtime/install-manager.js";
import { buildProviderRuntimeStatus } from "../provider-runtime/runtime-status.js";
import { SessionManager } from "../session/manager.js";
import { SessionAnalysisRunner } from "../session-analysis/runner.js";
import { SessionAnalysisService } from "../session-analysis/service.js";
import { BuiltinSkillSyncManager } from "../skills/builtin/sync-manager.js";
import { SkillHealthManager } from "../skills/health-manager.js";
import { SkillInstallManager } from "../skills/install-manager.js";
import { resolveDefaultLocalSkillRoots } from "../skills/local-skill-scanner.js";
import { SkillMountManager } from "../skills/mount-manager.js";
import { SkillsHubClient } from "../skills/skills-hub-client.js";
import { ProviderConfigRepo } from "../storage/repositories/provider-config-repo.js";
import { SessionAnalysisRepo } from "../storage/repositories/session-analysis-repo.js";
import { SessionMetadataRepo } from "../storage/repositories/session-metadata-repo.js";
import { SessionRepo } from "../storage/repositories/session-repo.js";
import { SettingsRepo } from "../storage/repositories/settings-repo.js";
import { SkillLibraryRepo } from "../storage/repositories/skill-library-repo.js";
import { SkillMountRepo } from "../storage/repositories/skill-mount-repo.js";
import { SkillTargetRepo } from "../storage/repositories/skill-target-repo.js";
import { SupervisorRepo } from "../storage/repositories/supervisor-repo.js";
import { TerminalRepo } from "../storage/repositories/terminal-repo.js";
import { WorkAnalysisRepo } from "../storage/repositories/work-analysis-repo.js";
import { SupervisorManager } from "../supervisor/manager.js";
import * as targetStore from "../supervisor/target-store.js";
import { SystemDependencyInstallManager } from "../system-deps/install-manager.js";
import { TaskManager } from "../tasks/manager.js";
import { TerminalManager } from "../terminal/manager.js";
import { NodePtyHost } from "../terminal/pty-host.js";
import { WorkDeepAnalysisRunner } from "../work-analysis/deep-runner.js";
import { createClaudeWorkLogSource } from "../work-analysis/log-sources/claude.js";
import { createCodexWorkLogSource } from "../work-analysis/log-sources/codex.js";
import { createWorkLogCollector } from "../work-analysis/log-sources/collector.js";
import { createCursorWorkLogSource } from "../work-analysis/log-sources/cursor.js";
import { createGeminiWorkLogSource } from "../work-analysis/log-sources/gemini.js";
import { createOpenCodeWorkLogSource } from "../work-analysis/log-sources/opencode.js";
import { WorkAnalysisService } from "../work-analysis/service.js";
import type { Broadcaster } from "../ws/hub.js";
import type { RuntimeCommandContext } from "./context.js";
import type { RuntimeHostBridge } from "./contract.js";
import { getRuntimeStateRoot } from "./runtime-state.js";

type RuntimeWorkspaceLookup = RuntimeCommandContext["workspaceLookup"];

interface RuntimeProjectionWorkspaceManager {
  get(workspaceId: string): ReturnType<RuntimeWorkspaceLookup["get"]>;
  list(): ReturnType<RuntimeWorkspaceLookup["list"]>;
}

function createPtyHost() {
  return new NodePtyHost();
}

function createRuntimeBroadcaster(hostBridge: RuntimeHostBridge): Broadcaster {
  return {
    broadcast: (topic, data) => {
      hostBridge.broadcast(topic, data);
    },
    sendToClient: (clientId, msg) => hostBridge.sendToClient(clientId as never, msg),
    sendBinaryToClient: (clientId, data) => hostBridge.sendBinaryToClient(clientId as never, data),
  };
}

function createRuntimeWorkspaceManager(
  workspaceLookup: RuntimeWorkspaceLookup
): RuntimeProjectionWorkspaceManager {
  return {
    get: (workspaceId) => workspaceLookup.get(workspaceId),
    list: () => workspaceLookup.list(),
  };
}

export interface RuntimeAssemblyResources {
  eventBus: EventBus;
  terminalRepo: TerminalRepo;
  sessionRepo: SessionRepo;
  providerConfigRepo: ProviderConfigRepo;
  skillLibraryRepo: SkillLibraryRepo;
  skillTargetRepo: SkillTargetRepo;
  skillMountRepo: SkillMountRepo;
  sessionMetadataRepo: SessionMetadataRepo;
  sessionAnalysisRepo: SessionAnalysisRepo;
  workAnalysisRepo: WorkAnalysisRepo;
  terminalMgr: TerminalManager;
  taskMgr: TaskManager;
  sessionMgr: SessionManager;
  lspMgr: LspManager;
  lspToolMgr: LspToolManager;
  lspToolInstallMgr: LspToolInstallManager;
  supervisorMgr: SupervisorManager;
  providerInstallMgr: ProviderInstallManager;
  systemDependencyInstallMgr: SystemDependencyInstallManager;
  skillsHubClient: SkillsHubClient;
  skillMountMgr: SkillMountManager;
  skillInstallMgr: SkillInstallManager;
  skillHealthMgr: SkillHealthManager;
  builtinSkillSyncMgr: BuiltinSkillSyncManager;
  sessionAnalysisRunner: SessionAnalysisRunner;
  sessionAnalysisService: SessionAnalysisService;
  workAnalysisService: WorkAnalysisService;
  managedProcessRegistry: ManagedProcessRegistry;
}

export interface RuntimeAssembly {
  context: RuntimeCommandContext;
  resources: RuntimeAssemblyResources;
  stop(): Promise<void>;
}

export async function assembleRuntime(input: {
  runtimeId: string;
  stateRoot: string;
  runtimeStateRoot?: string;
  hostBridge: RuntimeHostBridge;
  providerRegistry: RuntimeCommandContext["providerRegistry"];
  workspaceLookup: RuntimeCommandContext["workspaceLookup"];
  providerRuntimeDeps?: RuntimeCommandContext["providerRuntimeDeps"];
  settingsRepo?: SettingsRepo;
  agentInstructionPublisher?: RuntimeCommandContext["agentInstructionPublisher"];
  providerConfigRepoFactory?:
    | ((filePath: string) => RuntimeCommandContext["providerConfigRepo"])
    | undefined;
  contextOverrides?: Partial<RuntimeCommandContext>;
}): Promise<RuntimeAssembly> {
  const runtimeStateRoot =
    input.runtimeStateRoot ?? getRuntimeStateRoot(input.stateRoot, input.runtimeId);
  const getStateFile = (...parts: string[]) => join(runtimeStateRoot, ...parts);
  const broadcaster = createRuntimeBroadcaster(input.hostBridge);
  const runtimeWorkspaceMgr = createRuntimeWorkspaceManager(input.workspaceLookup);
  const eventBus = new EventBus();
  const emitDomainEvent = eventBus.emit.bind(eventBus);
  eventBus.emit = ((event) => {
    emitDomainEvent(event);
    input.hostBridge.emitDomainEvent(event);
  }) as EventBus["emit"];
  const managedProcessRegistry = new ManagedProcessRegistry({
    now: () => Date.now(),
  });

  const terminalRepo = new TerminalRepo({
    filePath: getStateFile("terminals.json"),
  });
  const sessionRepo = new SessionRepo({
    filePath: getStateFile("sessions.json"),
  });
  const providerConfigPath = getStateFile("provider-configs.json");
  const providerConfigRepo = input.providerConfigRepoFactory
    ? input.providerConfigRepoFactory(providerConfigPath)
    : new ProviderConfigRepo({
        filePath: providerConfigPath,
      });
  if ("ensureInitialized" in providerConfigRepo) {
    (providerConfigRepo as ProviderConfigRepo).ensureInitialized();
  }

  const terminalMgr = new TerminalManager({
    ptyHost: createPtyHost(),
    eventBus,
    db: terminalRepo,
  });
  const taskMgr = new TaskManager({
    eventBus,
    terminalMgr,
  });
  const sessionMgr = new SessionManager({
    terminalMgr,
    eventBus,
    db: sessionRepo,
    broadcaster,
    providerRegistry: input.providerRegistry,
    providerConfigRepo,
    hostBridge: input.hostBridge,
  });

  const skillLibraryRepo = new SkillLibraryRepo({
    filePath: getStateFile("skills", "library-index.json"),
    builtinRoot: getStateFile("skills", "builtin"),
    managedLibraryRoot: getStateFile("skills", "library"),
    customSkillRoot: getStateFile("skills", "custom"),
    externalSkillRoots: resolveDefaultLocalSkillRoots(),
  });
  const skillTargetRepo = new SkillTargetRepo({
    filePath: getStateFile("skills", "targets.json"),
  });
  const skillMountRepo = new SkillMountRepo({
    filePath: getStateFile("skills", "mounts.json"),
  });
  const skillsHubClient = new SkillsHubClient({ runCommand: runCommandAsString });
  const skillMountMgr = new SkillMountManager({
    getProviderRegistry: () => input.providerRegistry,
    skillLibraryRepo,
    skillMountRepo,
  });
  const skillInstallMgr = new SkillInstallManager({
    skillsHubClient,
    skillLibraryRepo,
    libraryRoot: getStateFile("skills", "library"),
    skillMountMgr,
    getInstalledSkillTargetProviderIds: async () => {
      const runtimeStatus = await buildProviderRuntimeStatus(
        input.providerRegistry,
        input.providerRuntimeDeps
      );
      return Object.values(runtimeStatus.providers)
        .filter((provider) => provider.available && provider.supportsSkillsMount)
        .map((provider) => provider.providerId);
    },
  });
  const skillHealthMgr = new SkillHealthManager({
    getProviderRegistry: () => input.providerRegistry,
    skillLibraryRepo,
  });
  const runtimeSettingsRepo =
    input.settingsRepo ??
    new SettingsRepo({
      filePath: join(input.stateRoot, "state", "settings.json"),
    });
  const builtinSkillSyncMgr = new BuiltinSkillSyncManager({
    builtinRoot: getStateFile("skills", "builtin"),
    getProviderRegistry: () => input.providerRegistry,
    skillLibraryRepo,
    skillMountRepo,
    skillMountMgr,
    settingsRepo: runtimeSettingsRepo,
  });
  await builtinSkillSyncMgr.sync();

  const sessionMetadataRepo = new SessionMetadataRepo({
    workspaceLookup: runtimeWorkspaceMgr,
  });
  const sessionAnalysisRepo = new SessionAnalysisRepo({
    filePath: getStateFile("session-analysis.json"),
  });
  const workAnalysisRepo = new WorkAnalysisRepo({
    filePath: getStateFile("work-analysis.sqlite"),
    legacyJsonFilePath: getStateFile("work-analysis.json"),
  });

  const lspManifestStore = new FileManifestStore(resolveLspToolRoot(runtimeStateRoot));
  const lspToolMgr = new LspToolManager({
    manifestStore: lspManifestStore,
  });
  const lspToolInstallMgr = new LspToolInstallManager({
    manifestStore: lspManifestStore,
  });
  const lspMgr = new LspManager({
    workspaceMgr: { get: (workspaceId) => runtimeWorkspaceMgr.get(workspaceId) as never },
    eventBus,
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    requestTimeoutMs: 8_000,
    initializeTimeoutMs: 60_000,
    idleTtlMs: 60_000,
    restartLimit: 2,
    lspToolMgr,
    managedProcessRegistry,
  });

  const persistedLspMode = runtimeSettingsRepo.get<"auto" | "off">("lsp.mode");
  if (persistedLspMode === "off") {
    await lspMgr.setRuntimeMode("off");
  }

  const supervisorRepo = new SupervisorRepo();
  const supervisorMgr = new SupervisorManager({
    eventBus,
    broadcaster,
    terminalMgr,
    workspaceMgr: runtimeWorkspaceMgr as never,
    sessionMgr,
    providerRegistry: input.providerRegistry,
    providerConfigRepo,
    settingsRepo: runtimeSettingsRepo,
    supervisorRepo,
    targetStore,
  });
  await sessionMgr.hydrate();
  await supervisorMgr.hydrate();

  const providerInstallMgr = new ProviderInstallManager(input.providerRegistry, {
    ...input.providerRuntimeDeps,
    runCommand: runCommandAsString,
  });
  const systemDependencyInstallMgr = new SystemDependencyInstallManager({
    ...input.providerRuntimeDeps,
    runCommand: runCommandAsString,
    ptyHost: createPtyHost(),
    hostBridge: input.hostBridge,
  });

  const sessionAnalysisRunner = new SessionAnalysisRunner({
    providerRegistry: input.providerRegistry,
    providerConfigRepo,
  });
  const sessionAnalysisService = new SessionAnalysisService({
    repo: sessionAnalysisRepo,
    sessionMgr,
    workspaceMgr: {
      get: (workspaceId: string) => runtimeWorkspaceMgr.get(workspaceId) as never,
    } as never,
    runner: sessionAnalysisRunner,
  });
  const workAnalysisService = new WorkAnalysisService({
    repo: workAnalysisRepo,
    workspaceMgr: {
      get: (workspaceId: string) => runtimeWorkspaceMgr.get(workspaceId) as never,
    } as never,
    workLogCollector: createWorkLogCollector({
      sources: [
        createClaudeWorkLogSource(),
        createCodexWorkLogSource(),
        createGeminiWorkLogSource(),
        createCursorWorkLogSource(),
        createOpenCodeWorkLogSource(),
      ],
    }),
    skillLibraryRepo,
    skillMountRepo,
    deepRunner: new WorkDeepAnalysisRunner({
      providerRegistry: input.providerRegistry,
      providerConfigRepo,
    }),
  });
  workAnalysisService.startAutoScan();

  const context = {
    runtimeId: input.runtimeId,
    workspaceLookup: input.workspaceLookup,
    hostBridge: input.hostBridge,
    eventBus,
    providerConfigRepo,
    providerRegistry: input.providerRegistry,
    sessionMgr,
    terminalMgr,
    taskMgr,
    lspMgr,
    lspToolMgr,
    lspToolInstallMgr,
    supervisorMgr,
    providerRuntimeDeps: input.providerRuntimeDeps,
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
    agentInstructionPublisher: input.agentInstructionPublisher,
    ...input.contextOverrides,
  } satisfies RuntimeCommandContext;

  return {
    context,
    resources: {
      eventBus,
      terminalRepo,
      sessionRepo,
      providerConfigRepo,
      skillLibraryRepo,
      skillTargetRepo,
      skillMountRepo,
      sessionMetadataRepo,
      sessionAnalysisRepo,
      workAnalysisRepo,
      terminalMgr,
      taskMgr,
      sessionMgr,
      lspMgr,
      lspToolMgr,
      lspToolInstallMgr,
      supervisorMgr,
      providerInstallMgr,
      systemDependencyInstallMgr,
      skillsHubClient,
      skillMountMgr,
      skillInstallMgr,
      skillHealthMgr,
      builtinSkillSyncMgr,
      sessionAnalysisRunner,
      sessionAnalysisService,
      workAnalysisService,
      managedProcessRegistry,
    },
    async stop() {
      await lspMgr.disposeAll();
      supervisorMgr.stop();
      workAnalysisService.stopAutoScan();
      workAnalysisRepo.close();
      terminalMgr.shutdown();
      eventBus.clear();
    },
  };
}
