// DomainEvent type union for EventBus (spec §4.0)

import type { Workspace, SessionState } from './types';

export type DomainEvent =
  | { type: 'session.state.changed'; sessionId: string; workspaceId?: string; from: SessionState; to: SessionState; session?: import('./types').Session }
  | { type: 'session.lifecycle'; sessionId: string; workspaceId?: string; event: 'started' | 'turn_completed' | 'stopped' | 'removed' }
  | { type: 'workspace.meta.changed'; workspaceId: string; patch: Partial<Workspace> }
  | { type: 'git.state.changed'; workspaceId: string }
  | { type: 'fs.dirty'; workspaceId: string; reason: string }
  | { type: 'terminal.created'; workspaceId: string; terminalId: string; kind: 'agent' | 'shell'; title: string; cwd: string }
  | { type: 'terminal.output'; workspaceId: string; terminalId: string; chunk: Buffer; seq: number }
  | { type: 'terminal.exited'; workspaceId: string; terminalId: string; exitCode: number };