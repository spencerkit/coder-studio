/**
 * Session types
 */

import type { Session } from '@coder-studio/core';

/**
 * Database interface for session persistence
 */
export interface SessionDatabase {
  insert(session: Session): void;
  update(id: string, patch: Partial<Session>): void;
  findById(id: string): Session | undefined;
  findByWorkspaceId(workspaceId: string): Session[];
  delete(id: string): void;
}
