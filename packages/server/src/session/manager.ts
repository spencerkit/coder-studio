/**
 * Session Manager (spec §4.6)
 *
 * Session is a business wrapper around an agent-kind Terminal.
 * It manages Agent domain semantics, state machine, and hook events.
 */

import type { Session, SessionState, Terminal, ProviderDefinition } from '@coder-studio/core';
import type { EventBus, DomainEvent } from '../bus/event-bus.js';
import type { TerminalManager } from '../terminal/manager.js';
import type { TerminalSpec } from '../terminal/types.js';
import type { SessionDatabase } from './types.js';
import type { Broadcaster } from '../ws/hub.js';

export interface CreateSessionRequest {
  workspaceId: string;
  workspacePath: string;
  providerId: string;
  provider: ProviderDefinition;
  draft?: string;
}

export interface SessionManagerDeps {
  terminalMgr: TerminalManager;
  eventBus: EventBus;
  db: SessionDatabase;
  broadcaster: Broadcaster;
  providerRegistry: ProviderDefinition[];
}

/**
 * Generate unique session ID
 */
function generateSessionId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Session Manager handles:
 * - Creating sessions via provider configuration
 * - Managing session state machine
 * - Processing hook events
 * - Broadcasting session events
 */
export class SessionManager {
  private sessions = new Map<string, ActiveSession>();
  // Pending events for sessions not yet initialized
  private pendingEvents = new Map<string, { events: ProviderHookEvent[]; expiresAt: number }>();

  constructor(private readonly deps: SessionManagerDeps) {}

  /**
   * Create a new session with provider
   */
  async create(req: CreateSessionRequest): Promise<Session> {
    const sessionId = generateSessionId();

    // Build command from provider
    const cmd = req.provider.buildCommand({
      workspacePath: req.workspacePath,
      sessionId,
    });

    // Create terminal spec
    const terminalSpec: TerminalSpec = {
      workspaceId: req.workspaceId,
      kind: 'agent',
      argv: cmd.argv,
      cwd: cmd.cwd,
      env: {
        ...cmd.env,
        CODER_STUDIO_SESSION_ID: sessionId,
      },
      title: req.provider.displayName,
    };

    // Pre-register session placeholder for pending events
    const active = new ActiveSession({
      id: sessionId,
      workspaceId: req.workspaceId,
      providerId: req.providerId,
      terminalId: '', // Will be set after terminal creation
      capability: req.provider.capability,
      state: 'starting',
      draft: req.draft,
    });

    this.sessions.set(sessionId, active);

    // Process any pending events that arrived before session was registered
    const pending = this.pendingEvents.get(sessionId);
    if (pending) {
      for (const ev of pending.events) {
        this.applyHookEvent(sessionId, ev);
      }
      this.pendingEvents.delete(sessionId);
    }

    // Create terminal (delegates to TerminalManager)
    const terminal = this.deps.terminalMgr.create(terminalSpec);
    active.terminalId = terminal.id;

    // Persist to database
    this.deps.db.insert(active.toRow());

    // Emit state changed event
    this.emitStateChanged(active, null, 'starting');

    return active.toDTO();
  }

  /**
   * Stop a running session
   */
  async stop(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Kill terminal (TerminalManager handles cleanup)
    this.deps.terminalMgr.kill(session.terminalId);

    // Update state
    const prev = session.state;
    session.state = 'ended';
    session.endedAt = Date.now();

    this.deps.db.update(sessionId, {
      state: 'ended',
      endedAt: session.endedAt,
    });

    this.emitStateChanged(session, prev, 'ended');
  }

  /**
   * Resume a session (create new terminal with --resume)
   */
  async resume(sessionId: string, workspacePath: string, provider: ProviderDefinition): Promise<Session> {
    const existing = this.sessions.get(sessionId);
    if (!existing) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (!existing.resumeId) {
      throw new Error('Session has no resume_id');
    }

    // Build resume command
    const cmd = provider.buildCommand({
      workspacePath,
      sessionId,
      resumeId: existing.resumeId,
    });

    // Create new terminal
    const terminalSpec: TerminalSpec = {
      workspaceId: existing.workspaceId,
      kind: 'agent',
      argv: cmd.argv,
      cwd: cmd.cwd,
      env: {
        ...cmd.env,
        CODER_STUDIO_SESSION_ID: sessionId,
      },
      title: provider.displayName,
    };

    const terminal = this.deps.terminalMgr.create(terminalSpec);

    // Update session
    const prev = existing.state;
    existing.terminalId = terminal.id;
    existing.state = 'running';

    this.deps.db.update(sessionId, {
      terminalId: terminal.id,
      state: 'running',
    });

    this.emitStateChanged(existing, prev, 'running');

    return existing.toDTO();
  }

  /**
   * Handle hook event from provider
   */
  onHookEvent(sessionId: string, event: ProviderHookEvent): void {
    const session = this.sessions.get(sessionId);

    if (!session) {
      // Session not yet registered - store in pending pool
      const pending = this.pendingEvents.get(sessionId) ?? {
        events: [],
        expiresAt: Date.now() + 5000, // 5s TTL
      };
      pending.events.push(event);
      this.pendingEvents.set(sessionId, pending);
      this.scheduleCleanup();
      return;
    }

    this.applyHookEvent(sessionId, event);
  }

  /**
   * Apply hook event to session
   */
  private applyHookEvent(sessionId: string, event: ProviderHookEvent): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const prev = session.state;

    switch (event.kind) {
      case 'SessionStart':
        session.resumeId = event.resumeId;
        session.state = 'running';
        session.startedAt = Date.now();

        this.deps.db.update(sessionId, {
          resumeId: event.resumeId,
          state: 'running',
          startedAt: session.startedAt,
        });
        break;

      case 'Stop':
        // Session completed a turn
        this.deps.eventBus.emit({
          type: 'session.lifecycle',
          sessionId,
          event: 'turn_completed',
        } as DomainEvent);
        break;

      case 'Progress':
        session.completionPercent = event.percent;
        this.deps.db.update(sessionId, {
          completionPercent: event.percent,
        });
        break;
    }

    if (session.state !== prev) {
      this.emitStateChanged(session, prev, session.state);
    }
  }

  /**
   * Get session by ID
   */
  get(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId)?.toDTO();
  }

  /**
   * Get all sessions for a workspace
   */
  getForWorkspace(workspaceId: string): Session[] {
    return Array.from(this.sessions.values())
      .filter((s) => s.workspaceId === workspaceId)
      .map((s) => s.toDTO());
  }

  /**
   * Handle terminal exit event
   */
  onTerminalExit(terminalId: string, exitCode: number): void {
    for (const session of this.sessions.values()) {
      if (session.terminalId === terminalId) {
        const prev = session.state;
        session.state = 'ended';
        session.endedAt = Date.now();
        session.exitCode = exitCode;

        this.deps.db.update(session.id, {
          state: 'ended',
          endedAt: session.endedAt,
          exitCode,
        });

        this.emitStateChanged(session, prev, 'ended');
        break;
      }
    }
  }

  /**
   * Emit state changed event
   */
  private emitStateChanged(session: ActiveSession, from: SessionState | null, to: SessionState): void {
    this.deps.eventBus.emit({
      type: 'session.state.changed',
      sessionId: session.id,
      from: from ?? 'draft',
      to,
    } as DomainEvent);
  }

  /**
   * Schedule cleanup of expired pending events
   */
  private scheduleCleanup(): void {
    const now = Date.now();
    for (const [sessionId, pending] of this.pendingEvents.entries()) {
      if (pending.expiresAt < now) {
        this.pendingEvents.delete(sessionId);
      }
    }
  }
}

/**
 * Active session with mutable state
 */
class ActiveSession {
  id: string;
  workspaceId: string;
  terminalId: string;
  providerId: string;
  state: SessionState;
  resumeId?: string;
  capability: 'full' | 'limited' | 'unsupported';
  startedAt?: number;
  lastActiveAt: number;
  endedAt?: number;
  completionPercent?: number;
  exitCode?: number;
  draft?: string;

  constructor(data: {
    id: string;
    workspaceId: string;
    providerId: string;
    terminalId: string;
    capability: 'full' | 'limited' | 'unsupported';
    state: SessionState;
    draft?: string;
  }) {
    this.id = data.id;
    this.workspaceId = data.workspaceId;
    this.providerId = data.providerId;
    this.terminalId = data.terminalId;
    this.capability = data.capability;
    this.state = data.state;
    this.draft = data.draft;
    this.lastActiveAt = Date.now();
  }

  toDTO(): Session {
    return {
      id: this.id,
      workspaceId: this.workspaceId,
      terminalId: this.terminalId,
      providerId: this.providerId,
      state: this.state,
      resumeId: this.resumeId,
      capability: this.capability,
      startedAt: this.startedAt ?? Date.now(),
      lastActiveAt: this.lastActiveAt,
      endedAt: this.endedAt,
      completionPercent: this.completionPercent,
    };
  }

  toRow(): SessionRow {
    return {
      id: this.id,
      workspace_id: this.workspaceId,
      terminal_id: this.terminalId,
      provider_id: this.providerId,
      state: this.state,
      resume_id: this.resumeId ?? null,
      capability: this.capability,
      started_at: this.startedAt ?? null,
      last_active_at: this.lastActiveAt,
      ended_at: this.endedAt ?? null,
      completion_percent: this.completionPercent ?? null,
      draft: this.draft ?? null,
    };
  }
}

/**
 * Provider hook event types
 */
export type ProviderHookEvent =
  | { kind: 'SessionStart'; resumeId: string }
  | { kind: 'Stop' }
  | { kind: 'Progress'; percent: number };

/**
 * Session database row
 */
export interface SessionRow {
  id: string;
  workspace_id: string;
  terminal_id: string;
  provider_id: string;
  state: string;
  resume_id: string | null;
  capability: string;
  started_at: number | null;
  last_active_at: number;
  ended_at: number | null;
  completion_percent: number | null;
  draft: string | null;
}
