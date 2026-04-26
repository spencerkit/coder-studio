/**
 * Command Dispatch
 *
 * Routes commands to handlers and validates input
 */

import type { Command, Result, ProviderDefinition } from '@coder-studio/core';
import type { Database } from 'better-sqlite3';
import { z } from 'zod';
import type { WorkspaceManager } from '../workspace/manager.js';
import type { SessionManager } from '../session/manager.js';
import type { TerminalManager } from '../terminal/manager.js';
import type { HooksManager } from '../hooks/manager.js';
import type { EventBus } from '../bus/event-bus.js';
import type { Broadcaster } from './hub.js';
import type { FencingManager } from './fencing.js';
import type { SupervisorManager } from '../supervisor/manager.js';

/**
 * Command context - injected dependencies for handlers
 */
export interface CommandContext {
  workspaceMgr: WorkspaceManager;
  sessionMgr: SessionManager;
  terminalMgr: TerminalManager;
  hooksMgr: HooksManager;
  eventBus: EventBus;
  broadcaster: Broadcaster;
  db: Database;
  providerRegistry: ProviderDefinition[];
  fencingMgr: FencingManager;
  supervisorMgr: SupervisorManager;
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
      kind: 'result',
      id: msg.id,
      ok: false,
      error: {
        code: 'unknown_op',
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

    // Execute handler
    const data = await handler(args, ctx, clientId);

    return {
      kind: 'result',
      id: msg.id,
      ok: true,
      data,
    };
  } catch (error: any) {
    // Normalize error
    const normalizedError = normalizeError(error);

    return {
      kind: 'result',
      id: msg.id,
      ok: false,
      error: normalizedError,
    };
  }
}

/**
 * Normalize error to protocol format
 */
function normalizeError(error: any): Result['error'] {
  // Zod validation error
  if (error.name === 'ZodError') {
    return {
      code: 'validation_error',
      message: 'Invalid arguments',
      details: error.errors,
    };
  }

  // Custom error with code
  if (error.code) {
    return {
      code: error.code,
      message: error.message,
      details: error.details,
    };
  }

  // Generic error
  return {
    code: 'internal_error',
    message: error.message || 'An internal error occurred',
  };
}

/**
 * Get all registered commands
 */
export function getRegisteredCommands(): string[] {
  return Array.from(handlers.keys());
}
