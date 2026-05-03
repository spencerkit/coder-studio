/**
 * Session types
 */

import type { Session } from '@coder-studio/core';
import type { SessionRow } from '../storage/repositories/session-repo.js';

/**
 * Whitelisted fields that can be passed to SessionDatabase.update()
 */
export interface SessionUpdatePatch {
  terminalId?: string;
  state?: string;
  startedAt?: number;
  endedAt?: number;
  completionPercent?: number;
  errorReason?: string;
  lastActiveAt?: number;
  title?: string;
}

/**
 * Database interface for session persistence
 */
export interface SessionDatabase {
  insert(session: SessionRow): void;
  update(id: string, patch: SessionUpdatePatch): void;
  findById(id: string): Session | undefined;
  findByWorkspaceId(workspaceId: string): Session[];
  listHydratable(): Session[];
  delete(id: string): void;
}
