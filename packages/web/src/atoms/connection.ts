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