/**
 * Connection State Management
 *
 * WebSocket connection status and client singleton.
 */

import { atom } from 'jotai';
import type { WsClient } from '../ws/client';

/**
 * Connection status enum
 */
export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'rejected';

/**
 * WebSocket client singleton
 * Created once at app init, injected into atom for global access
 */
export const wsClientAtom = atom<WsClient | null>(null);

/**
 * Connection status (updated by WsClient event handlers)
 * Written by: WsClient internal state machine
 */
export const connectionStatusAtom = atom<ConnectionStatus>('connecting');

/**
 * Connection error message (if any)
 */
export const connectionErrorAtom = atom<string | null>(null);

/**
 * Is writer tab (Phase 1: always true for connected tab)
 */
export const isWriterAtom = atom<boolean>(false);

/**
 * Last reconnect attempt timestamp
 */
export const lastReconnectAttemptAtom = atom<number | null>(null);

/**
 * Reconnect attempt count
 */
export const reconnectAttemptCountAtom = atom<number>(0);

/**
 * Server metadata (received on connect)
 */
export interface ServerInfo {
  version: string;
  serverInstanceId: string;
}

export const serverInfoAtom = atom<ServerInfo | null>(null);

/**
 * Command dispatch function type
 */
export type DispatchCommand = <T = unknown>(
  op: string,
  args: unknown
) => Promise<CommandResult<T>>;

/**
 * Command result type
 */
export interface CommandResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Command dispatch atom
 * Provides a unified interface for dispatching commands to the server
 * Use with useAtomValue to get the dispatch function
 */
export const dispatchCommandAtom = atom<DispatchCommand>((get) => {
  const client = get(wsClientAtom);

  return async <T = unknown>(
    op: string,
    args: unknown
  ): Promise<CommandResult<T>> => {
    if (!client) {
      return {
        ok: false,
        error: {
          code: 'no_client',
          message: 'WebSocket client not initialized',
        },
      };
    }

    try {
      const data = await client.sendCommand<T>(op, args);
      return { ok: true, data };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        ok: false,
        error: {
          code: 'command_error',
          message,
        },
      };
    }
  };
});