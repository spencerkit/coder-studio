/**
 * Session types
 */

import type { Session } from '@coder-studio/core';

/**
 * Database interface for session persistence
 */
export interface SessionDatabase {
  insert(session: any): void;
  update(id: string, patch: any): void;
  findById(id: string): Session | undefined;
  findByWorkspaceId(workspaceId: string): Session[];
  delete(id: string): void;
}
