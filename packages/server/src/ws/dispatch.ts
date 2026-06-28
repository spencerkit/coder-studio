/**
 * Command Dispatch
 *
 * Routes commands to host handlers, runtime handlers, or compatibility
 * handlers while preserving the existing websocket protocol behavior.
 */

import type { AutomationPermission, Command, ProviderDefinition, Result } from "@coder-studio/core";
import { z } from "zod";
import type { AgentInstructionsPublisher } from "../agent-instructions/publisher.js";
import type { RequestAuthContext } from "../auth/index.js";
import type { SessionTokenRepo } from "../auth/session-token-repo.js";
import type { AutomationAuditLog } from "../automation/audit-log.js";
import type { EventBus } from "../bus/event-bus.js";
import type { CanvasService } from "../canvas/service.js";
import {
  isBinaryTerminalInputArgs,
  materializeTerminalInputArgsForRemoteRuntime,
} from "../commands/terminal.js";
import type { ServerConfig } from "../config.js";
import type { AutoFetchRuntime } from "../git/auto-fetch.js";
import { getHostCommandDefinition, getRegisteredHostCommands } from "../host/command-registry.js";
import type { HostCommandContext, HostDispatchMeta } from "../host/context.js";
import type { RuntimeRouter } from "../host/runtime-router.js";
import type { WorkspaceRuntimeBindingStore } from "../host/workspace-runtime-binding.js";
import type { LspManager } from "../lsp/manager.js";
import type { LspToolInstallManager } from "../lsp-tools/install-manager.js";
import type { LspToolManager } from "../lsp-tools/manager.js";
import type { MonitoringService } from "../monitoring/service.js";
import type { ProviderInstallManager } from "../provider-runtime/install-manager.js";
import type { RuntimeStatusDeps } from "../provider-runtime/runtime-status.js";
import {
  getRegisteredRuntimeCommands,
  getRuntimeCommandDefinition,
} from "../runtime/command-registry.js";
import type { RuntimeCommandContext } from "../runtime/context.js";
import type { RuntimeExecuteMeta, RuntimeRouteTarget } from "../runtime/contract.js";
import type { SessionManager } from "../session/manager.js";
import type { SessionAnalysisService } from "../session-analysis/service.js";
import type { BuiltinSkillSyncManager } from "../skills/builtin/sync-manager.js";
import type { SkillHealthManager } from "../skills/health-manager.js";
import type { SkillInstallManager } from "../skills/install-manager.js";
import type { SkillMountManager } from "../skills/mount-manager.js";
import type { SkillsHubClient } from "../skills/skills-hub-client.js";
import type { CustomProviderRepo } from "../storage/repositories/custom-provider-repo.js";
import type { MemoryRepo } from "../storage/repositories/memory-repo.js";
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
 * Command context - injected dependencies for compatibility handlers
 */
export interface CommandContext extends HostCommandContext {
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
  runtimeRouter: RuntimeRouter;
  runtimeBindings: WorkspaceRuntimeBindingStore;
  providerRuntimeDeps?: RuntimeStatusDeps;
  providerInstallMgr?: ProviderInstallManager;
  systemDependencyInstallMgr?: SystemDependencyInstallManager;
  agentInstructionPublisher?: AgentInstructionsPublisher;
  canvasService?: CanvasService;
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
  memoryRepo?: MemoryRepo;
  stateRoot?: string;
  sessionTokenRepo?: SessionTokenRepo;
}

/**
 * Command handler type for compatibility-registered handlers.
 */
export type CommandHandler<A = unknown, R = unknown> = (
  args: A,
  ctx: CommandContext,
  clientId?: string
) => Promise<R>;

type CommandSchema = z.ZodTypeAny;

const compatibilityHandlers = new Map<string, CommandHandler>();
const compatibilitySchemas = new Map<string, CommandSchema>();

const NOOP_EVENT_BUS: Pick<EventBus, "emit" | "on"> = {
  emit: () => {},
  on: () => () => {},
};

const NOOP_PROVIDER_CONFIG_REPO: Pick<
  ProviderConfigRepo,
  "get" | "set" | "delete" | "listProviderIds" | "getAll"
> = {
  get: () => undefined,
  set: () => {},
  delete: () => {},
  listProviderIds: () => [],
  getAll: () => ({}),
};

export function createInlineRuntimeContext(ctx: HostCommandContext): RuntimeCommandContext {
  const candidate = ctx as Partial<CommandContext>;
  const eventBus = candidate.eventBus ?? NOOP_EVENT_BUS;
  const broadcaster = candidate.broadcaster;

  return {
    runtimeId: "native-default",
    workspaceLookup: {
      get: (workspaceId: string) => candidate.workspaceMgr?.get?.(workspaceId) as never,
      list: () => candidate.workspaceMgr?.list?.().slice() ?? [],
    },
    hostBridge: {
      issueSessionToken: () => ({ token: "" }),
      revokeSessionTokensBySessionId: () => {},
      getHostApiUrl: () => undefined,
      emitDomainEvent: (event) => eventBus.emit(event),
      broadcast: (topic, payload) => {
        if (typeof broadcaster?.broadcast === "function") {
          broadcaster.broadcast(topic, payload);
        }
      },
      recordWorkspaceFetch: (workspaceId) => candidate.workspaceMgr?.recordFetch?.(workspaceId),
      resolveClientOwnerId: (clientId) => {
        const activeLease = candidate.activationMgr?.getLease?.();
        if (activeLease?.wsClientId === clientId) {
          return activeLease.clientInstanceId;
        }

        return clientId;
      },
      sendToClient: (clientId, payload) =>
        typeof broadcaster?.sendToClient === "function"
          ? broadcaster.sendToClient(clientId as never, payload as never)
          : false,
      sendBinaryToClient: (clientId, payload) =>
        typeof broadcaster?.sendBinaryToClient === "function"
          ? broadcaster.sendBinaryToClient(clientId as never, payload)
          : false,
    },
    eventBus: eventBus as EventBus,
    providerConfigRepo: (candidate.providerConfigRepo ??
      NOOP_PROVIDER_CONFIG_REPO) as ProviderConfigRepo,
    providerRegistry: candidate.providerRegistry ?? [],
    settingsRepo: candidate.settingsRepo as SettingsRepo,
    sessionMgr: candidate.sessionMgr as SessionManager,
    terminalMgr: candidate.terminalMgr as TerminalManager,
    taskMgr: candidate.taskMgr as TaskManager,
    lspMgr: candidate.lspMgr as LspManager,
    lspToolMgr: candidate.lspToolMgr,
    lspToolInstallMgr: candidate.lspToolInstallMgr,
    supervisorMgr: candidate.supervisorMgr as SupervisorManager,
    providerRuntimeDeps: candidate.providerRuntimeDeps,
    providerInstallMgr: candidate.providerInstallMgr,
    systemDependencyInstallMgr: candidate.systemDependencyInstallMgr,
    skillsHubClient: candidate.skillsHubClient,
    skillInstallMgr: candidate.skillInstallMgr,
    skillMountMgr: candidate.skillMountMgr,
    skillHealthMgr: candidate.skillHealthMgr,
    skillLibraryRepo: candidate.skillLibraryRepo,
    skillTargetRepo: candidate.skillTargetRepo,
    skillMountRepo: candidate.skillMountRepo,
    builtinSkillSyncMgr: candidate.builtinSkillSyncMgr,
    sessionMetadataRepo: candidate.sessionMetadataRepo,
    sessionAnalysisService: candidate.sessionAnalysisService,
    workAnalysisService: candidate.workAnalysisService,
    agentInstructionPublisher: candidate.agentInstructionPublisher,
  };
}

function shouldFallbackRuntimeRouting(error: unknown, target: RuntimeRouteTarget): boolean {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;

  if (target.kind !== "default") {
    return false;
  }

  return (
    code === "runtime_not_bound" || code === "runtime_not_found" || code === "workspace_not_found"
  );
}

function getGitNetworkWorkspaceId(op: string, args: unknown): string | undefined {
  if (op !== "git.fetch" && op !== "git.pull" && op !== "git.push") {
    return undefined;
  }

  if (!args || typeof args !== "object") {
    return undefined;
  }

  return typeof (args as { workspaceId?: unknown }).workspaceId === "string"
    ? (args as { workspaceId: string }).workspaceId
    : undefined;
}

function shouldBypassGitOperationLock(
  op: string,
  args: unknown,
  meta?: RuntimeExecuteMeta
): boolean {
  return (
    op === "git.fetch" &&
    !!args &&
    typeof args === "object" &&
    (args as { background?: unknown }).background === true &&
    !meta?.clientId
  );
}

async function executeWithWorkspaceOperationLock<T>(
  op: string,
  args: unknown,
  ctx: HostCommandContext,
  meta: RuntimeExecuteMeta | undefined,
  execute: () => Promise<T>
): Promise<T> {
  const workspaceId = getGitNetworkWorkspaceId(op, args);
  if (!workspaceId || shouldBypassGitOperationLock(op, args, meta)) {
    return execute();
  }

  const autoFetch = ctx.autoFetch;
  if (!autoFetch?.runExclusive) {
    return execute();
  }

  return autoFetch.runExclusive(workspaceId, execute);
}

export async function executeRuntimeCommandOnTarget(
  op: string,
  args: unknown,
  ctx: HostCommandContext,
  meta?: RuntimeExecuteMeta,
  targetOverride?: RuntimeRouteTarget
): Promise<unknown> {
  const definition = getRuntimeCommandDefinition(op);
  if (!definition) {
    throw {
      code: "unknown_op",
      message: `Unknown operation: ${op}`,
    };
  }

  const parsedArgs = definition.schema.parse(args);
  const target = targetOverride ?? definition.resolveTarget(parsedArgs);
  const inlineRuntimeContext = createInlineRuntimeContext(ctx);

  return executeWithWorkspaceOperationLock(op, parsedArgs, ctx, meta, async () => {
    if (typeof ctx.runtimeRouter?.executeOnTarget === "function") {
      try {
        const forwardedArgs =
          op === "terminal.input" && isBinaryTerminalInputArgs(parsedArgs)
            ? materializeTerminalInputArgsForRemoteRuntime(parsedArgs)
            : parsedArgs;
        return await ctx.runtimeRouter.executeOnTarget(target, op, forwardedArgs, meta);
      } catch (error) {
        if (!shouldFallbackRuntimeRouting(error, target)) {
          throw error;
        }
      }
    }

    if (inlineRuntimeContext) {
      return definition.handler(parsedArgs, inlineRuntimeContext, meta);
    }

    if (compatibilityHandlers.has(op)) {
      return executeCompatibilityCommand(op, parsedArgs, ctx as CommandContext, meta?.clientId);
    }

    throw {
      code: "runtime_router_unavailable",
      message: `Runtime router is unavailable for operation: ${op}`,
    };
  });
}

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
  "uiAction.capabilities",
  "uiAction.dispatch",
  "workspace.list",
]);

const SESSION_TOKEN_ALLOWLIST = new Set([
  "automation.capabilities",
  "automation.identify",
  "canvas.create",
  "canvas.list",
  "canvas.render",
  "canvas.update",
  "connection.probe",
  "git.diff",
  "git.status",
  "memory.create",
  "memory.delete",
  "memory.get",
  "memory.list",
  "memory.search",
  "memory.update",
  "session.list",
  "terminal.read",
  "uiAction.capabilities",
  "uiAction.dispatch",
]);

type SessionTokenAuthContext = Extract<RequestAuthContext, { mode: "session_token" }>;

function createPermissionDeniedError(message: string): Result["error"] {
  return {
    code: "permission_denied",
    message,
  };
}

export function getRequestAuthContext(
  ctx: Pick<HostCommandContext, "broadcaster">,
  clientId?: string
): RequestAuthContext | undefined {
  if (!clientId || typeof ctx.broadcaster.getRequestMetadata !== "function") {
    return undefined;
  }

  return ctx.broadcaster.getRequestMetadata(clientId)?.coderStudioAuthContext;
}

export function getSessionTokenRequestAuthContext(
  ctx: Pick<HostCommandContext, "broadcaster">,
  clientId?: string
): SessionTokenAuthContext | undefined {
  const authContext = getRequestAuthContext(ctx, clientId);
  return authContext?.mode === "session_token" ? authContext : undefined;
}

function getUiActionPermission(args: unknown): AutomationPermission | undefined {
  if (!args || typeof args !== "object" || !("intent" in args)) {
    return undefined;
  }

  const intent = (args as { intent?: { type?: unknown } }).intent;
  if (!intent || typeof intent !== "object") {
    return undefined;
  }

  return intent.type === "command.run" ? "ui:command" : "ui:navigate";
}

function getSessionTokenPermission(msg: Command): AutomationPermission | null | undefined {
  switch (msg.op) {
    case "automation.capabilities":
    case "automation.identify":
    case "connection.probe":
    case "uiAction.capabilities":
      return null;
    case "session.list":
      return "session:read";
    case "terminal.read":
      return "terminal:read";
    case "git.status":
    case "git.diff":
      return "git:read";
    case "memory.list":
    case "memory.search":
    case "memory.get":
      return "memory:read";
    case "memory.create":
    case "memory.update":
    case "memory.delete":
      return "memory:write";
    case "canvas.list":
    case "canvas.render":
      return "memory:read";
    case "canvas.create":
    case "canvas.update":
      return "memory:write";
    case "uiAction.dispatch":
      return getUiActionPermission(msg.args);
    default:
      return undefined;
  }
}

function getWorkspaceIdArg(args: unknown): string | undefined {
  if (!args || typeof args !== "object") {
    return undefined;
  }

  return typeof (args as { workspaceId?: unknown }).workspaceId === "string"
    ? (args as { workspaceId: string }).workspaceId
    : undefined;
}

function getUiIntentWorkspaceId(args: unknown): string | undefined {
  if (!args || typeof args !== "object") {
    return undefined;
  }

  const intent = (args as { intent?: { workspaceId?: unknown } }).intent;
  return typeof intent?.workspaceId === "string" ? intent.workspaceId : undefined;
}

function getReferencedWorkspaceIds(args: unknown): string[] {
  const workspaceIds = [getWorkspaceIdArg(args), getUiIntentWorkspaceId(args)].filter(
    (workspaceId): workspaceId is string => typeof workspaceId === "string"
  );

  return [...new Set(workspaceIds)];
}

function validateSessionTokenScope(
  msg: Command,
  authContext: SessionTokenAuthContext,
  ctx: Pick<HostCommandContext, "runtimeBindings">
): Result["error"] | null {
  switch (msg.op) {
    case "session.list":
    case "git.status":
    case "git.diff":
    case "memory.list":
    case "memory.search":
    case "memory.get":
    case "memory.create":
    case "memory.update":
    case "memory.delete":
    case "canvas.list":
    case "canvas.create":
    case "canvas.update":
    case "canvas.render": {
      const workspaceId = getWorkspaceIdArg(msg.args);
      if (workspaceId && workspaceId !== authContext.workspaceId) {
        return createPermissionDeniedError("Token is not authorized for the requested workspace");
      }
      return null;
    }
    case "terminal.read": {
      if (!msg.args || typeof msg.args !== "object") {
        return null;
      }

      const terminalId = (msg.args as { terminalId?: unknown }).terminalId;
      if (typeof terminalId !== "string") {
        return null;
      }

      const sessionId =
        ctx.runtimeBindings?.findSessionIdByTerminalId(terminalId) ??
        (ctx as Partial<CommandContext>).sessionMgr?.findSessionIdByTerminal?.(terminalId);
      if (sessionId && sessionId !== authContext.sessionId) {
        return createPermissionDeniedError("Token is not authorized for the requested session");
      }
      return null;
    }
    case "uiAction.dispatch": {
      const workspaceIds = getReferencedWorkspaceIds(msg.args);
      if (workspaceIds.some((workspaceId) => workspaceId !== authContext.workspaceId)) {
        return createPermissionDeniedError("Token is not authorized for the requested workspace");
      }
      return null;
    }
    default:
      return null;
  }
}

function authorizeSessionTokenCommand(
  msg: Command,
  authContext: SessionTokenAuthContext,
  ctx: Pick<HostCommandContext, "runtimeBindings">
): Result["error"] | null {
  if (!SESSION_TOKEN_ALLOWLIST.has(msg.op)) {
    return createPermissionDeniedError("Token is not authorized for this command");
  }

  const requiredPermission = getSessionTokenPermission(msg);
  if (requiredPermission === undefined) {
    return createPermissionDeniedError("Token is not authorized for this command");
  }

  if (requiredPermission !== null && !authContext.permissions.includes(requiredPermission)) {
    return createPermissionDeniedError("Token is not authorized for this command");
  }

  return validateSessionTokenScope(msg, authContext, ctx);
}

async function executeCompatibilityCommand(
  op: string,
  args: unknown,
  ctx: CommandContext,
  clientId?: string
): Promise<unknown> {
  const handler = compatibilityHandlers.get(op);
  if (!handler) {
    throw {
      code: "unknown_op",
      message: `Unknown operation: ${op}`,
    };
  }

  const schema = compatibilitySchemas.get(op);
  const parsedArgs = schema ? schema.parse(args) : args;
  return handler(parsedArgs, ctx, clientId);
}

/**
 * Register a compatibility command handler.
 */
export function registerCommand<S extends CommandSchema, R>(
  op: string,
  schema: S,
  handler: CommandHandler<z.output<S>, R>
): void {
  compatibilityHandlers.set(op, handler as CommandHandler);
  compatibilitySchemas.set(op, schema);
}

export async function executeHostCommand(
  op: string,
  args: unknown,
  ctx: HostCommandContext,
  meta?: HostDispatchMeta
): Promise<unknown> {
  const definition = getHostCommandDefinition(op);
  if (definition) {
    const parsedArgs = definition.schema.parse(args);
    return definition.handler(parsedArgs, ctx, meta);
  }

  if (compatibilityHandlers.has(op)) {
    return executeCompatibilityCommand(op, args, ctx as CommandContext, meta?.clientId);
  }

  throw {
    code: "unknown_op",
    message: `Unknown operation: ${op}`,
  };
}

export async function executeRuntimeCommand(
  op: string,
  args: unknown,
  ctx: RuntimeCommandContext,
  meta?: RuntimeExecuteMeta
): Promise<unknown> {
  const definition = getRuntimeCommandDefinition(op);
  if (!definition) {
    throw {
      code: "unknown_op",
      message: `Unknown operation: ${op}`,
    };
  }

  const parsedArgs = definition.schema.parse(args);
  return definition.handler(parsedArgs, ctx, meta);
}

/**
 * Dispatch a command to its host or runtime target.
 */
export async function dispatch(
  msg: Command,
  ctx: HostCommandContext,
  clientId?: string
): Promise<Result> {
  const isWsDispatch =
    clientId !== undefined && typeof ctx.broadcaster.getRequestMetadata === "function";
  const authContext = isWsDispatch ? getSessionTokenRequestAuthContext(ctx, clientId) : undefined;

  if (authContext) {
    const authorizationError = authorizeSessionTokenCommand(msg, authContext, ctx);
    if (authorizationError) {
      return {
        kind: "result",
        id: msg.id,
        ok: false,
        error: authorizationError,
      };
    }
  }

  if (isWsDispatch && !authContext && !ACTIVATION_ALLOWLIST.has(msg.op)) {
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

  try {
    const runtimeDefinition = getRuntimeCommandDefinition(msg.op, { includeInternal: false });
    if (runtimeDefinition) {
      const parsedArgs = runtimeDefinition.schema.parse(msg.args);
      const data = await executeRuntimeCommandOnTarget(
        msg.op,
        parsedArgs,
        ctx,
        {
          clientId,
          authContext,
        },
        runtimeDefinition.resolveTarget(parsedArgs)
      );

      return {
        kind: "result",
        id: msg.id,
        ok: true,
        data,
      };
    }

    const data = await executeHostCommand(msg.op, msg.args, ctx, {
      clientId,
      authContext,
    });

    return {
      kind: "result",
      id: msg.id,
      ok: true,
      data,
    };
  } catch (error: unknown) {
    return {
      kind: "result",
      id: msg.id,
      ok: false,
      error: normalizeError(error),
    };
  }
}

export async function dispatchRelayedSessionCommand(
  msg: Command,
  ctx: CommandContext,
  sessionToken: string
): Promise<Result> {
  const tokenRecord = ctx.sessionTokenRepo?.get(sessionToken);
  if (!tokenRecord) {
    return {
      kind: "result",
      id: msg.id,
      ok: false,
      error: {
        code: "unauthorized",
        message: "Invalid session token",
      },
    };
  }

  if (tokenRecord.expiresAt !== undefined && tokenRecord.expiresAt <= Date.now()) {
    return {
      kind: "result",
      id: msg.id,
      ok: false,
      error: {
        code: "unauthorized",
        message: "Session token expired",
      },
    };
  }

  const { mode: tokenMode, ...tokenFields } = tokenRecord;
  const authContext: SessionTokenAuthContext = {
    mode: "session_token",
    tokenMode,
    ...tokenFields,
  };

  const authorizationError = authorizeSessionTokenCommand(msg, authContext, ctx);
  if (authorizationError) {
    return {
      kind: "result",
      id: msg.id,
      ok: false,
      error: authorizationError,
    };
  }

  try {
    const runtimeDefinition = getRuntimeCommandDefinition(msg.op, { includeInternal: false });
    if (runtimeDefinition) {
      const parsedArgs = runtimeDefinition.schema.parse(msg.args);
      const data = await executeRuntimeCommandOnTarget(
        msg.op,
        parsedArgs,
        ctx,
        {
          clientId: undefined,
          authContext,
        },
        runtimeDefinition.resolveTarget(parsedArgs)
      );

      return {
        kind: "result",
        id: msg.id,
        ok: true,
        data,
      };
    }

    const data = await executeHostCommand(msg.op, msg.args, ctx, {
      clientId: undefined,
      authContext,
    });

    return {
      kind: "result",
      id: msg.id,
      ok: true,
      data,
    };
  } catch (error: unknown) {
    return {
      kind: "result",
      id: msg.id,
      ok: false,
      error: normalizeError(error),
    };
  }
}

/**
 * Normalize error to protocol format.
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
 * Get all registered commands, including compatibility and explicit host/runtime
 * registrations.
 */
export function getRegisteredCommands(): string[] {
  return Array.from(
    new Set([
      ...compatibilityHandlers.keys(),
      ...getRegisteredHostCommands(),
      ...getRegisteredRuntimeCommands(),
    ])
  );
}
