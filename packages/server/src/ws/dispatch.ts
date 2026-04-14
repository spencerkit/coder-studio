/**
 * Command Dispatch
 *
 * Routes commands to handlers and validates input
 */

import type { Command, Result } from '@coder-studio/core';
import type { Database } from 'better-sqlite3';
import type { WorkspaceManager } from '../workspace/manager.js';
import type { SessionManager } from '../session/manager.js';
import type { TerminalManager } from '../terminal/manager.js';
import type { HooksManager } from '../hooks/manager.js';
import type { EventBus } from '../bus/event-bus.js';
import type { Broadcaster } from './hub.js';

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
}

/**
 * Command handler type
 */
export type CommandHandler<A = unknown, R = unknown> = (
  args: A,
  ctx: CommandContext
) => Promise<R>;

/**
 * Registry of all command handlers
 */
const handlers = new Map<string, CommandHandler<any, any>>();

/**
 * Registry of all command schemas
 */
const schemas = new Map<string, any>();

/**
 * Register a command handler
 */
export function registerCommand<A, R>(
  op: string,
  schema: any,
  handler: CommandHandler<A, R>
): void {
  handlers.set(op, handler);
  schemas.set(op, schema);
}

/**
 * Dispatch a command to its handler
 */
export async function dispatch(
  msg: Command,
  ctx: CommandContext
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
    const data = await handler(args, ctx);

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
