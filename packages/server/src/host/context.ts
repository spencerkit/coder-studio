import type { ProviderDefinition } from "@coder-studio/core";
import type { RequestAuthContext } from "../auth/index.js";
import type { AutomationAuditLog } from "../automation/audit-log.js";
import type { ServerConfig } from "../config.js";
import type { AutoFetchRuntime } from "../git/auto-fetch.js";
import type { MonitoringService } from "../monitoring/service.js";
import type { RuntimeStatusDeps } from "../provider-runtime/runtime-status.js";
import type { SessionManager } from "../session/manager.js";
import type { CustomProviderRepo } from "../storage/repositories/custom-provider-repo.js";
import type { MemoryRepo } from "../storage/repositories/memory-repo.js";
import type { SettingsRepo } from "../storage/repositories/settings-repo.js";
import type { TerminalManager } from "../terminal/manager.js";
import type { UpdateService } from "../update/update-service.js";
import type { WorkspaceManager } from "../workspace/manager.js";
import type { ActivationManager } from "../ws/activation.js";
import type { FencingManager } from "../ws/fencing.js";
import type { Broadcaster } from "../ws/hub.js";
import type { RuntimeOrchestrator } from "./runtime-orchestrator.js";
import type { RuntimeRegistry } from "./runtime-registry.js";
import type { RuntimeRouter } from "./runtime-router.js";
import type { WorkspaceRuntimeBindingStore } from "./workspace-runtime-binding.js";

export interface HostCommandContext {
  workspaceMgr: WorkspaceManager;
  sessionMgr?: SessionManager;
  terminalMgr?: TerminalManager;
  settingsRepo: SettingsRepo;
  memoryRepo?: MemoryRepo;
  activationMgr: ActivationManager;
  automationAuditLog?: AutomationAuditLog;
  broadcaster: Broadcaster;
  autoFetch?: AutoFetchRuntime;
  runtimeRouter: RuntimeRouter;
  runtimeBindings: WorkspaceRuntimeBindingStore;
  runtimeRegistry?: RuntimeRegistry;
  runtimeOrchestrator?: RuntimeOrchestrator;
  fencingMgr?: FencingManager;
  config?: Pick<ServerConfig, "auth" | "host" | "wslRuntime">;
  updateService?: UpdateService;
  monitoringService?: MonitoringService;
  customProviderRepo?: CustomProviderRepo;
  providerRegistry: ProviderDefinition[];
  providerRuntimeDeps?: RuntimeStatusDeps;
  setProviderRegistry?: (providers: ProviderDefinition[]) => void;
}

export interface HostDispatchMeta {
  clientId?: string;
  authContext?: RequestAuthContext;
}
