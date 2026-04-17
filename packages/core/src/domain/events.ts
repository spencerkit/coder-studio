// DomainEvent type union for EventBus (spec §4.0)

import type { Workspace, SessionState } from './types';

export type DomainEvent =
  | { type: 'session.state.changed'; sessionId: string; workspaceId?: string; from: SessionState; to: SessionState; session?: import('./types').Session }
  | { type: 'session.lifecycle'; sessionId: string; event: 'started' | 'turn_completed' | 'stopped' | 'removed' }
  | { type: 'workspace.meta.changed'; workspaceId: string; patch: Partial<Workspace> }
  | { type: 'git.state.changed'; workspaceId: string }
  | { type: 'fs.dirty'; workspaceId: string; reason: string };