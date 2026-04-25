/**
 * Session Manager (spec §4.6)
 *
 * Session is a business wrapper around an agent-kind Terminal.
 * It manages Agent domain semantics, state machine, and hook events.
 */

import type { Session, SessionState, ProviderDefinition, DomainEvent } from '@coder-studio/core';
import { deriveSessionTitle } from '@coder-studio/core';
import type { EventBus } from '../bus/event-bus.js';
import type { TerminalManager } from '../terminal/manager.js';
import type { TerminalSpec } from '../terminal/types.js';
import type { SessionDatabase } from './types.js';
import type { Broadcaster } from '../ws/hub.js';
import type { ProviderConfigRepo } from '../storage/repositories/provider-config-repo.js';
import { sessionToRow, type SessionRow } from '../storage/repositories/session-repo.js';
import { mergeProviderLaunchConfig } from '../provider-config.js';

export interface CreateSessionRequest {
  workspaceId: string;
  workspacePath: string;
  providerId: string;
  provider: ProviderDefinition;
  draft?: string;
}

export interface SessionLogger {
  warn(context: Record<string, unknown>, message: string): void;
}

export interface SessionManagerDeps {
  terminalMgr: TerminalManager;
  eventBus: EventBus;
  db: SessionDatabase;
  broadcaster: Broadcaster;
  providerRegistry: ProviderDefinition[];
  providerConfigRepo: ProviderConfigRepo;
  resolveBridgeScriptPath?: (providerId: string) => string | undefined;
  logger?: SessionLogger;
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
const NOOP_SESSION_LOGGER: SessionLogger = {
  warn: () => {},
};

type TerminalExitedEvent = Extract<DomainEvent, { type: 'terminal.exited' }>;

export class SessionManager {
  private sessions = new Map<string, ActiveSession>();
  private terminalToSession = new Map<string, string>();
  // Pending events for sessions not yet initialized
  private pendingEvents = new Map<string, { events: ProviderHookEvent[]; expiresAt: number }>();
  private readonly logger: SessionLogger;

  constructor(private readonly deps: SessionManagerDeps) {
    this.logger = deps.logger ?? NOOP_SESSION_LOGGER;

    this.deps.eventBus.on('terminal.exited', (event: TerminalExitedEvent) => {
      this.onTerminalExit(event.terminalId, event.exitCode);
    });
  }

  /**
   * Create a new session with provider
   */
  async create(req: CreateSessionRequest): Promise<Session> {
    const sessionId = generateSessionId();
    const launchConfig = this.getLaunchConfig(req.providerId, req.provider);

    // Build command from provider (pass config and context)
    const cmd = req.provider.buildCommand(launchConfig, {
      workspacePath: req.workspacePath,
      sessionId,
      bridgeScriptPath: this.deps.resolveBridgeScriptPath?.(req.providerId),
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
    this.terminalToSession.set(terminal.id, sessionId);

    // Persist initial (`starting`) row so subsequent update() calls have a
    // target to UPDATE and so a crash between here and the optimistic idle
    // promotion below still leaves a sane DB state.
    this.deps.db.insert(active.toRow());

    // Emit the initial `starting` snapshot so clients can latch session
    // creation before any optimistic transition fires.
    this.emitStateChanged(active, null, 'starting');

    // If the provider cannot signal "CLI has finished booting" (Codex and any
    // future provider without a SessionStart hook), there is nothing left to
    // wait for: a successful `terminalMgr.create()` means the process
    // spawned, and from the user's perspective the CLI is now at the prompt.
    // Advance the session to `idle` immediately so the UI doesn't lie with
    // "starting…" forever. If the process crashes on boot, `onTerminalExit`
    // will move it straight to `ended`, overriding this optimistic
    // transition. Providers that DO emit SessionStart (e.g. Claude) keep the
    // initial `starting` and flip to `idle` in applyHookEvent('SessionStart').
    // Tolerate test/stub providers that omit the full HooksDescriptor: if
    // the structure isn't there, assume no start signal (same class as
    // Codex) and take the optimistic-idle path. Real providers always
    // declare `events.sessionStart` because the core type requires it.
    const hasStartSignal =
      req.provider.hooks?.events?.sessionStart === true;
    if (!hasStartSignal) {
      const prev = active.state;
      active.state = 'idle';
      active.startedAt = Date.now();
      this.deps.db.update(sessionId, {
        state: 'idle',
        startedAt: active.startedAt,
      });
      this.emitStateChanged(active, prev, 'idle');
    }

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
    const launchConfig = this.getLaunchConfig(existing.providerId, provider);
    const cmd = provider.buildResumeCommand!(
      existing.resumeId,
      launchConfig,
      {
        workspacePath,
        sessionId,
        bridgeScriptPath: this.deps.resolveBridgeScriptPath?.(existing.providerId),
      }
    );

    if (!cmd) {
      throw new Error('Provider buildResumeCommand returned null');
    }

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
    if (existing.terminalId) {
      this.terminalToSession.delete(existing.terminalId);
    }
    existing.terminalId = terminal.id;
    this.terminalToSession.set(terminal.id, sessionId);
    existing.state = 'running';

    this.deps.db.update(sessionId, {
      terminalId: terminal.id,
      state: 'running',
    });

    this.emitStateChanged(existing, prev, 'running');

    return existing.toDTO();
  }

  async hydrate(): Promise<void> {
    const persistedSessions = this.deps.db.listHydratable();

    for (const session of persistedSessions) {
      if (this.sessions.has(session.id)) {
        continue;
      }

      const nextState = this.resolveHydratedState(session);
      const hydrated = new ActiveSession({
        id: session.id,
        workspaceId: session.workspaceId,
        providerId: session.providerId,
        terminalId: session.terminalId,
        capability: session.capability,
        state: nextState,
        title: session.title,
        resumeId: session.resumeId,
        startedAt: session.startedAt,
        lastActiveAt: session.lastActiveAt,
        endedAt: session.endedAt,
        completionPercent: session.completionPercent,
        errorReason: session.errorReason,
        transcriptPath: session.transcriptPath,
      });

      this.sessions.set(session.id, hydrated);
      this.terminalToSession.set(session.terminalId, session.id);

      if (nextState !== session.state) {
        this.deps.db.update(session.id, { state: nextState });
      }
    }
  }

  private resolveHydratedState(session: Session): SessionState {
    const activeTerminal = this.deps.terminalMgr.get(session.terminalId);
    if (activeTerminal?.alive) {
      return session.state;
    }

    if (session.state === 'ended' || session.state === 'unavailable' || session.state === 'interrupted') {
      return session.state;
    }

    return session.resumeId ? 'interrupted' : 'unavailable';
  }

  private getLaunchConfig(providerId: string, provider: ProviderDefinition) {
    return mergeProviderLaunchConfig(provider, this.deps.providerConfigRepo.get(providerId));
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
      this.logger.warn({
        sessionId,
        eventKind: event.kind,
      }, '[SessionManager] Hook event queued');
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
        // SessionStart fires once the provider CLI has finished booting and is
        // sitting at the input prompt — no turn is in flight yet, so the
        // natural next state is `idle`. `running` is reserved for "there is a
        // turn actively executing" (entered via onTerminalInput(submit) or a
        // resume). Without this, Claude-style providers that only emit Stop
        // per-turn would never transition out of `running` until the user had
        // submitted and completed their first turn.
        session.resumeId = event.resumeId;
        if (event.transcriptPath) session.transcriptPath = event.transcriptPath;
        session.state = 'idle';
        session.startedAt = Date.now();

        this.deps.db.update(sessionId, {
          resumeId: event.resumeId,
          transcriptPath: event.transcriptPath,
          state: 'idle',
          startedAt: session.startedAt,
        });
        break;

      case 'TurnCompleted': {
        if (!session.resumeId) session.resumeId = event.resumeId;
        if (session.state === 'starting' || session.state === 'running') {
          session.state = 'idle';
        }

        this.deps.db.update(sessionId, {
          resumeId: session.resumeId,
          state: session.state,
        });

        this.deps.eventBus.emit({
          type: 'session.lifecycle',
          workspaceId: session.workspaceId,
          sessionId,
          event: 'turn_completed',
        } as DomainEvent);

        // Resolve transcript path asynchronously on first turn
        if (!session.transcriptPath) {
          this.resolveTranscriptPathAsync(session);
        }
        break;
      }

      case 'Stop':
        if (session.state === 'starting' || session.state === 'running') {
          session.state = 'idle';
        }
        this.deps.db.update(sessionId, {
          state: session.state,
        });

        // Session completed a turn
        this.deps.eventBus.emit({
          type: 'session.lifecycle', workspaceId: session.workspaceId,
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
   * Asynchronously resolve transcript path via provider
   */
  private async resolveTranscriptPathAsync(session: ActiveSession): Promise<void> {
    const provider = this.deps.providerRegistry.find((p) => p.id === session.providerId);
    if (!provider?.resolveTranscriptPath || !session.resumeId) return;

    try {
      const path = await provider.resolveTranscriptPath(session.toDTO());
      if (path) {
        session.transcriptPath = path;
        this.deps.db.update(session.id, { transcriptPath: path });
      }
    } catch {
      // Never throw from transcript resolution
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
   * Mark a session as actively running again after a submitted message reaches
   * its terminal. Also captures the session title on the *first* submit so the
   * UI can show something more meaningful than "SESSION-XX".
   *
   * The title is assigned at most once per session (idempotent): once
   * `session.title` is set, later submits never overwrite it, even across
   * resumes, restarts, or rehydrations.
   */
  onTerminalInput(
    terminalId: string,
    activity: 'typing' | 'submit' | 'system' = 'typing',
    text?: string
  ): void {
    const sessionId = this.terminalToSession.get(terminalId);
    if (!sessionId) return;

    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (activity !== 'submit') return;

    // Title capture runs independently of state transitions: a session that
    // is still 'starting' or 'running' when the user types won't flip state
    // here, but we still want to record the first instruction as the title.
    const titleChanged = this.maybeAssignTitle(session, text);

    const prev = session.state;
    const shouldResume = session.state === 'idle' || session.state === 'interrupted';

    if (shouldResume) {
      session.state = 'running';
      session.lastActiveAt = Date.now();

      this.deps.db.update(session.id, {
        state: 'running',
        lastActiveAt: session.lastActiveAt,
      });

      this.emitStateChanged(session, prev, 'running');
    } else if (titleChanged) {
      // State stayed the same, but the DTO changed (title added) and the UI
      // subscribes via state.changed broadcasts — fire a no-op transition so
      // the fresh DTO is pushed to clients.
      this.emitStateChanged(session, prev, session.state);
    }
  }

  /**
   * Session-level input writes to the underlying PTY and updates session activity.
   */
  sendInput(
    sessionId: string,
    bytes: Buffer,
    activity: 'typing' | 'submit' | 'system' = 'typing'
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    this.deps.terminalMgr.write(session.terminalId, bytes);
    const text = activity === 'submit' ? bytes.toString('utf-8') : undefined;
    this.onTerminalInput(session.terminalId, activity, text);
  }

  /**
   * Session-level resize forwards to the underlying PTY.
   */
  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    this.deps.terminalMgr.resize(session.terminalId, cols, rows);
  }

  /**
   * Read the last N bytes of terminal output for a session.
   */
  getOutputTail(sessionId: string, bytes: number = 4096): Buffer {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return Buffer.alloc(0);
    }

    return this.deps.terminalMgr.getRingBufferTail(session.terminalId, bytes);
  }

  /**
   * Resolve the session that owns a terminal, if any.
   */
  findSessionIdByTerminal(terminalId: string): string | undefined {
    return this.terminalToSession.get(terminalId);
  }

  /**
   * Assigns a title to the session from the first submitted instruction, if
   * one hasn't been assigned yet. Returns true when a new title was persisted.
   */
  private maybeAssignTitle(session: ActiveSession, text: string | undefined): boolean {
    if (session.title) return false;
    if (!text) return false;

    const title = deriveSessionTitle(text);
    if (!title) return false;

    session.title = title;
    this.deps.db.update(session.id, { title });
    return true;
  }

  /**
   * Handle terminal exit event
   */
  onTerminalExit(terminalId: string, exitCode: number): void {
    const sessionId = this.terminalToSession.get(terminalId);
    if (!sessionId) return;

    const session = this.sessions.get(sessionId);
    if (!session) return;

    const prev = session.state;
    session.state = 'ended';
    session.endedAt = Date.now();
    session.exitCode = exitCode;
    this.terminalToSession.delete(terminalId);

    this.deps.db.update(session.id, {
      state: 'ended',
      endedAt: session.endedAt,
    });

    this.emitStateChanged(session, prev, 'ended');
  }

  /**
   * Delete a session
   * Only allowed for sessions in 'ended' or 'unavailable' state
   */
  delete(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (session.state !== 'ended' && session.state !== 'unavailable') {
      throw new Error(`Cannot delete session in state: ${session.state}`);
    }

    // Remove from memory
    this.sessions.delete(sessionId);
    this.terminalToSession.delete(session.terminalId);

    // Delete from database
    this.deps.db.delete(sessionId);

    // Emit removed event
    this.deps.eventBus.emit({
      type: 'session.lifecycle', workspaceId: session.workspaceId,
      sessionId,
      event: 'removed',
    } as DomainEvent);
  }

  /**
   * Emit state changed event
   */
  private emitStateChanged(session: ActiveSession, from: SessionState | null, to: SessionState): void {
    this.deps.eventBus.emit({
      type: 'session.state.changed',
      sessionId: session.id,
      workspaceId: session.workspaceId,
      from: from ?? 'draft',
      to,
      session: session.toDTO(),
    } as any);
  }

  /**
   * Schedule cleanup of expired pending events
   */
  private scheduleCleanup(): void {
    const now = Date.now();
    const cleanedSessionIds: string[] = [];
    for (const [sessionId, pending] of this.pendingEvents.entries()) {
      if (pending.expiresAt < now) {
        this.pendingEvents.delete(sessionId);
        cleanedSessionIds.push(sessionId);
      }
    }
    if (cleanedSessionIds.length > 0) {
      this.logger.warn({
        cleanedSessionIds,
      }, '[SessionManager] Expired pending events cleaned');
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
  errorReason?: string;
  exitCode?: number;
  draft?: string;
  transcriptPath?: string;
  title?: string;

  constructor(data: {
    id: string;
    workspaceId: string;
    providerId: string;
    terminalId: string;
    capability: 'full' | 'limited' | 'unsupported';
    state: SessionState;
    draft?: string;
    title?: string;
    resumeId?: string;
    startedAt?: number;
    lastActiveAt?: number;
    endedAt?: number;
    completionPercent?: number;
    errorReason?: string;
    transcriptPath?: string;
  }) {
    this.id = data.id;
    this.workspaceId = data.workspaceId;
    this.providerId = data.providerId;
    this.terminalId = data.terminalId;
    this.capability = data.capability;
    this.state = data.state;
    this.draft = data.draft;
    this.title = data.title;
    this.resumeId = data.resumeId;
    this.startedAt = data.startedAt ?? Date.now();
    this.lastActiveAt = data.lastActiveAt ?? this.startedAt;
    this.endedAt = data.endedAt;
    this.completionPercent = data.completionPercent;
    this.errorReason = data.errorReason;
    this.transcriptPath = data.transcriptPath;
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
      errorReason: this.errorReason,
      transcriptPath: this.transcriptPath,
      title: this.title,
    };
  }

  toRow(): SessionRow {
    return sessionToRow({
      ...this.toDTO(),
      ...(this.draft !== undefined ? { draft: this.draft } : {}),
    });
  }
}

/**
 * Provider hook event types
 */
export type ProviderHookEvent =
  | { kind: 'SessionStart'; resumeId: string; transcriptPath?: string }
  | { kind: 'Stop' }
  | { kind: 'TurnCompleted'; resumeId: string; turnId: string }
  | { kind: 'Progress'; percent: number };
