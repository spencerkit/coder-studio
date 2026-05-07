/**
 * Command Dispatch
 *
 * Routes commands to handlers and validates input
 */

import type { Command, ProviderDefinition, Result } from "@coder-studio/core";
import { z } from "zod";
import type { EventBus } from "../bus/event-bus.js";
import type { ProviderInstallManager } from "../provider-runtime/install-manager.js";
import type { RuntimeStatusDeps } from "../provider-runtime/runtime-status.js";
import type { SessionManager } from "../session/manager.js";
import type { Database } from "../storage/database.js";
import type { SupervisorManager } from "../supervisor/manager.js";
import type { TerminalManager } from "../terminal/manager.js";
import type { WorkspaceManager } from "../workspace/manager.js";
import type { FencingManager } from "./fencing.js";
import type { Broadcaster } from "./hub.js";

/**
 * Command context - injected dependencies for handlers
 */
export interface CommandContext {
  workspaceMgr: WorkspaceManager;
  sessionMgr: SessionManager;
  terminalMgr: TerminalManager;
  eventBus: EventBus;
  broadcaster: Broadcaster;
  db: Database;
  providerRegistry: ProviderDefinition[];
  fencingMgr: FencingManager;
  supervisorMgr: SupervisorManager;
  providerRuntimeDeps?: RuntimeStatusDeps;
  providerInstallMgr?: ProviderInstallManager;
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

/**
 * Debounce state for commands that should be coalesced.
 * Per-workspace, with a deadline that resets on each call.
 */
interface DebounceEntry<T> {
  timer: NodeJS.Timeout;
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  op: () => Promise<T>;
}
const debounceMap = new Map<string, DebounceEntry<unknown>>();

const DEBOUNCE_GIT_STATUS_MS = 500;

/**
 * Run an operation with per-key debounce.
 * If the same key is invoked within the debounce window, the earlier
 * invocation waits and the new one replaces the timer. The result
 * from the final (post-debounce) execution is delivered to all waiters.
 */
async function debounce<R>(key: string, op: () => Promise<R>, windowMs: number): Promise<R> {
  let entry = debounceMap.get(key) as DebounceEntry<R> | undefined;
  if (entry) {
    clearTimeout(entry.timer);
    entry.op = op;
  } else {
    let resolve: (value: R) => void;
    let reject: (reason: unknown) => void;
    const promise = new Promise<R>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    entry = {
      timer: undefined as unknown as NodeJS.Timeout,
      promise,
      resolve: resolve!,
      reject: reject!,
      op,
    };
    debounceMap.set(key, entry as DebounceEntry<unknown>);
  }

  entry.timer = setTimeout(async () => {
    debounceMap.delete(key);
    try {
      const result = await entry.op();
      entry.resolve(result);
    } catch (err) {
      entry.reject(err);
    }
  }, windowMs);

  return entry.promise;
}

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
    // Validate args with schema
    const schema = schemas.get(msg.op);
    let args = msg.args;

    if (schema) {
      args = schema.parse(msg.args);
    }

    // Execute handler (with debounce for git.status)
    const data = await executeWithDebounce(msg.op, args, ctx, clientId);

    return {
      kind: "result",
      id: msg.id,
      ok: true,
      data,
    };
  } catch (error: unknown) {
    // Normalize error
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
 * Execute a command handler, optionally with debounce.
 * For git.status, coalesces rapid-fire calls per workspace into one execution.
 */
async function executeWithDebounce(
  op: string,
  args: unknown,
  ctx: CommandContext,
  clientId?: string
): Promise<unknown> {
  const handler = handlers.get(op)!;

  if (op === "git.status") {
    const workspaceId = getWorkspaceId(args);
    const key = workspaceId ? `git.status:${workspaceId}` : op;
    return debounce(key, () => handler(args, ctx, clientId), DEBOUNCE_GIT_STATUS_MS);
  }

  return handler(args, ctx, clientId);
}

function getWorkspaceId(args: unknown): string | undefined {
  if (typeof args !== "object" || args === null || !("workspaceId" in args)) {
    return undefined;
  }

  const workspaceId = (args as { workspaceId: unknown }).workspaceId;
  return typeof workspaceId === "string" ? workspaceId : undefined;
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

  // Zod validation error
  if (candidate.name === "ZodError") {
    return {
      code: "validation_error",
      message: "Invalid arguments",
      details: candidate.errors,
    };
  }

  // Custom error with code
  if (candidate.code) {
    return {
      code: candidate.code,
      message: candidate.message ?? String(candidate.code),
      details: candidate.details,
    };
  }

  // Generic error
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
