/**
 * Command Dispatch
 *
 * Routes commands to handlers and validates input
 */

import type { Command, ProviderDefinition, Result } from "@coder-studio/core";
import { z } from "zod";
import type { AgentInstructionsPublisher } from "../agent-instructions/publisher.js";
import type { AutomationAuditLog } from "../automation/audit-log.js";
import type { EventBus } from "../bus/event-bus.js";
import type { ServerConfig } from "../config.js";
import type { WorkspaceExtensionStateService } from "../extension-state/workspace-extension-state-service.js";
import type { AutoFetchRuntime } from "../git/auto-fetch.js";
import type { LspManager } from "../lsp/manager.js";
import type { LspToolInstallManager } from "../lsp-tools/install-manager.js";
import type { LspToolManager } from "../lsp-tools/manager.js";
import type { MonitoringService } from "../monitoring/service.js";
import type { ProviderInstallManager } from "../provider-runtime/install-manager.js";
import type { RuntimeStatusDeps } from "../provider-runtime/runtime-status.js";
import type { SessionManager } from "../session/manager.js";
import type { SessionAnalysisService } from "../session-analysis/service.js";
import type { BuiltinSkillSyncManager } from "../skills/builtin/sync-manager.js";
import type { SkillHealthManager } from "../skills/health-manager.js";
import type { SkillInstallManager } from "../skills/install-manager.js";
import type { SkillMountManager } from "../skills/mount-manager.js";
import type { SkillsHubClient } from "../skills/skills-hub-client.js";
import type { CustomProviderRepo } from "../storage/repositories/custom-provider-repo.js";
import type { ProviderConfigRepo } from "../storage/repositories/provider-config-repo.js";
import type { SessionMetadataRepo } from "../storage/repositories/session-metadata-repo.js";
import type { SettingsRepo } from "../storage/repositories/settings-repo.js";
import type { SkillLibraryRepo } from "../storage/repositories/skill-library-repo.js";
import type { SkillMountRepo } from "../storage/repositories/skill-mount-repo.js";
import type { SkillTargetRepo } from "../storage/repositories/skill-target-repo.js";
import type { SupervisorManager } from "../supervisor/manager.js";
import type { SystemDependencyInstallManager } from "../system-deps/install-manager.js";
import type { TaskManager } from "../tasks/manager.js";
import type { TerminalManager } from "../terminal/manager.js";
import type { UpdateService } from "../update/update-service.js";
import type { WorkAnalysisService } from "../work-analysis/service.js";
import type { WorkspaceManager } from "../workspace/manager.js";
import type { ActivationManager } from "./activation.js";
import type { FencingManager } from "./fencing.js";
import type { Broadcaster } from "./hub.js";

/**
 * Command context - injected dependencies for handlers
 */
export interface CommandContext {
  workspaceMgr: WorkspaceManager;
  sessionMgr: SessionManager;
  terminalMgr: TerminalManager;
  taskMgr: TaskManager;
  eventBus: EventBus;
  broadcaster: Broadcaster;
  settingsRepo: SettingsRepo;
  providerConfigRepo: ProviderConfigRepo;
  providerRegistry: ProviderDefinition[];
  fencingMgr: FencingManager;
  supervisorMgr: SupervisorManager;
  autoFetch: AutoFetchRuntime;
  providerRuntimeDeps?: RuntimeStatusDeps;
  providerInstallMgr?: ProviderInstallManager;
  systemDependencyInstallMgr?: SystemDependencyInstallManager;
  agentInstructionPublisher?: AgentInstructionsPublisher;
  activationMgr: ActivationManager;
  config?: Pick<ServerConfig, "auth" | "host">;
  lspMgr: LspManager;
  lspToolMgr?: LspToolManager;
  lspToolInstallMgr?: LspToolInstallManager;
  updateService?: UpdateService;
  customProviderRepo?: CustomProviderRepo;
  sessionMetadataRepo?: SessionMetadataRepo;
  sessionAnalysisService?: SessionAnalysisService;
  workAnalysisService?: WorkAnalysisService;
  setProviderRegistry?: (providers: ProviderDefinition[]) => void;
  monitoringService?: MonitoringService;
  skillsHubClient?: SkillsHubClient;
  skillInstallMgr?: SkillInstallManager;
  skillMountMgr?: SkillMountManager;
  skillHealthMgr?: SkillHealthManager;
  skillLibraryRepo?: SkillLibraryRepo;
  skillTargetRepo?: SkillTargetRepo;
  skillMountRepo?: SkillMountRepo;
  builtinSkillSyncMgr?: BuiltinSkillSyncManager;
  automationAuditLog?: AutomationAuditLog;
  workspaceExtensionStateService?: WorkspaceExtensionStateService;
  stateRoot?: string;
}

/**
 * Command handler type
 */
export type CommandHandler<A = unknown, R = unknown> = (
  args: A,
  ctx: CommandContext,
  clientId?: string
) => Promise<R>;

type CommandSchema = z.ZodTypeAny;

/**
 * Registry of all command handlers
 */
const handlers = new Map<string, CommandHandler>();

/**
 * Registry of all command schemas
 */
const schemas = new Map<string, CommandSchema>();
const ACTIVATION_ALLOWLIST = new Set([
  "activation.claim",
  "activation.release",
  "automation.capabilities",
  "automation.identify",
  "connection.probe",
  "git.diff",
  "git.status",
  "session.list",
  "terminal.read",
  "workspace.list",
  "workspace.extensionState.list",
  "workspace.extensionState.statusPills.set",
  "workspace.extensionState.statusPills.list",
  "workspace.extensionState.statusPills.clear",
  "workspace.extensionState.progress.set",
  "workspace.extensionState.progress.list",
  "workspace.extensionState.progress.clear",
  "workspace.extensionState.logs.append",
  "workspace.extensionState.logs.list",
  "workspace.extensionState.logs.clear",
  "workspace.extensionState.quickActions.set",
  "workspace.extensionState.quickActions.list",
  "workspace.extensionState.quickActions.clear",
]);

/**
 * Register a command handler
 */
export function registerCommand<S extends CommandSchema, R>(
  op: string,
  schema: S,
  handler: CommandHandler<z.output<S>, R>
): void {
  handlers.set(op, handler as CommandHandler);
  schemas.set(op, schema);
}

/**
 * Dispatch a command to its handler
 */
export async function dispatch(
  msg: Command,
  ctx: CommandContext,
  clientId?: string
): Promise<Result> {
  const isWsDispatch =
    clientId !== undefined && typeof ctx.broadcaster.getRequestMetadata === "function";

  if (isWsDispatch && !ACTIVATION_ALLOWLIST.has(msg.op)) {
    const active = ctx.activationMgr.getLease();
    if (!active || active.wsClientId !== clientId) {
      return {
        kind: "result",
        id: msg.id,
        ok: false,
        error: {
          code: "activation_required",
          message: "This tab is no longer the active session",
        },
      };
    }
  }

  const handler = handlers.get(msg.op);

  if (!handler) {
    return {
      kind: "result",
      id: msg.id,
      ok: false,
      error: {
        code: "unknown_op",
        message: `Unknown operation: ${msg.op}`,
      },
    };
  }

  try {
    const schema = schemas.get(msg.op);
    let args = msg.args;

    if (schema) {
      args = schema.parse(msg.args);
    }

    const data = await handler(args, ctx, clientId);

    return {
      kind: "result",
      id: msg.id,
      ok: true,
      data,
    };
  } catch (error: unknown) {
    const normalizedError = normalizeError(error);

    return {
      kind: "result",
      id: msg.id,
      ok: false,
      error: normalizedError,
    };
  }
}

/**
 * Normalize error to protocol format
 */
function normalizeError(error: unknown): Result["error"] {
  const candidate = error as {
    name?: string;
    code?: string;
    message?: string;
    details?: unknown;
    errors?: unknown;
  };

  if (candidate.name === "ZodError") {
    return {
      code: "validation_error",
      message: "Invalid arguments",
      details: candidate.errors,
    };
  }

  if (candidate.code) {
    return {
      code: candidate.code,
      message: candidate.message ?? String(candidate.code),
      details: candidate.details,
    };
  }

  return {
    code: "internal_error",
    message: candidate.message || "An internal error occurred",
  };
}

/**
 * Get all registered commands
 */
export function getRegisteredCommands(): string[] {
  return Array.from(handlers.keys());
}
