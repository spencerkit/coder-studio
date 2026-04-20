/**
 * Session types
 */

import type { Session } from '@coder-studio/core';

/**
 * Whitelisted fields that can be passed to SessionDatabase.update()
 */
export interface SessionUpdatePatch {
  resumeId?: string;
  transcriptPath?: string;
  state?: string;
  startedAt?: number;
  endedAt?: number;
  completionPercent?: number;
  errorReason?: string;
  lastActiveAt?: number;
}

/**
 * Database interface for session persistence
 */
export interface SessionDatabase {
  insert(session: Omit<Session, 'id'> & { id: string }): void;
  update(id: string, patch: SessionUpdatePatch): void;
  findById(id: string): Session | undefined;
  findByWorkspaceId(workspaceId: string): Session[];
  delete(id: string): void;
}
