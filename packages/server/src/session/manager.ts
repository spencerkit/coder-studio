/**
 * Session Manager (spec §4.6)
 *
 * Session is a business wrapper around an agent-kind Terminal.
 * It manages Agent domain semantics and the PTY-driven state machine.
 */

import type { Session, SessionState, ProviderDefinition, DomainEvent } from '@coder-studio/core';
import { deriveSessionTitle } from '@coder-studio/core';
import type { EventBus, Unsubscribe } from '../bus/event-bus.js';
import type { TerminalManager } from '../terminal/manager.js';
import type { TerminalSpec } from '../terminal/types.js';
import type { SessionDatabase } from './types.js';
import type { Broadcaster } from '../ws/hub.js';
import type { ProviderConfigRepo } from '../storage/repositories/provider-config-repo.js';
import { sessionToRow, type SessionRow } from '../storage/repositories/session-repo.js';
import { mergeProviderLaunchConfig } from '../provider-config.js';
import type { RenderOptions } from '../terminal/snapshot-render.js';
import { PtyStateDetector } from './pty-state-detector.js';
import { createShadowComparator, type ShadowComparator } from './state-shadow-comparator.js';

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
 * - Broadcasting session events
 */
const NOOP_SESSION_LOGGER: SessionLogger = {
  warn: () => {},
};

type TerminalExitedEvent = Extract<DomainEvent, { type: 'terminal.exited' }>;
type TerminalOutputEvent = Extract<DomainEvent, { type: 'terminal.output' }>;

export class SessionManager {
  private sessions = new Map<string, ActiveSession>();
  private terminalToSession = new Map<string, string>();
  private detectors = new Map<string, PtyStateDetector>();
  private comparators = new Map<string, ShadowComparator>();
  private detectorUnsubscribes = new Map<string, Unsubscribe>();
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

    // Create terminal (delegates to TerminalManager)
    const terminal = this.deps.terminalMgr.create(terminalSpec);
    active.terminalId = terminal.id;
    this.terminalToSession.set(terminal.id, sessionId);
    this.attachShadowDetector(active, req.provider);

    // Persist initial (`starting`) row so subsequent update() calls have a
    // target to UPDATE and so a crash between here and the optimistic idle
    // promotion below still leaves a sane DB state.
    this.deps.db.insert(active.toRow());

    // Emit the initial `starting` snapshot so clients can latch session
    // creation before any optimistic transition fires.
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
        startedAt: session.startedAt,
        lastActiveAt: session.lastActiveAt,
        endedAt: session.endedAt,
        completionPercent: session.completionPercent,
        errorReason: session.errorReason,
      });

      this.sessions.set(session.id, hydrated);
      this.terminalToSession.set(session.terminalId, session.id);

      if (nextState !== session.state) {
        this.deps.db.update(session.id, { state: nextState });
      }
    }
  }

  private resolveHydratedState(session: Session): SessionState {
    if (session.state === 'draft') {
      return 'draft';
    }

    const activeTerminal = this.deps.terminalMgr.get(session.terminalId);
    if (activeTerminal?.alive) {
      return session.state;
    }

    if (session.state === 'ended') {
      return session.state;
    }

    return 'ended';
  }

  private getLaunchConfig(providerId: string, provider: ProviderDefinition) {
    return mergeProviderLaunchConfig(provider, this.deps.providerConfigRepo.get(providerId));
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

    if (activity === 'system') {
      session.awaitingTurnCompletion = true;
      const prev = session.state;
      if (session.state !== 'running') {
        session.state = 'running';
        session.lastActiveAt = Date.now();
        this.deps.db.update(session.id, {
          state: 'running',
          lastActiveAt: session.lastActiveAt,
        });
        this.emitStateChanged(session, prev, 'running');
      }
      return;
    }

    if (activity !== 'submit') return;

    const submittedText = text;
    if (submittedText?.trim()) {
      session.latestSubmittedUserInput = submittedText.trim();
    }
    session.awaitingTurnCompletion = true;

    // Title capture runs independently of state transitions: a session that
    // is still 'starting' or 'running' when the user types won't flip state
    // here, but we still want to record the first instruction as the title.
    const titleChanged = this.maybeAssignTitle(session, submittedText);

    const prev = session.state;
    const shouldResume =
      session.state === 'idle' ||
      session.state === 'starting';

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
    activity: 'typing' | 'submit' | 'system' = 'typing',
    submittedText?: string
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    this.deps.terminalMgr.write(session.terminalId, bytes);
    const text = activity === 'submit' ? (submittedText ?? bytes.toString('utf-8')) : undefined;
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
   * Render the current session snapshot to plain text for supervisor use.
   */
  async getRenderedSnapshot(sessionId: string, options: RenderOptions): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return '';
    }

    return this.deps.terminalMgr.getRenderedSnapshot(session.terminalId, options);
  }

  /**
   * Return the most recent submitted user input observed for the session.
   */
  getLatestSubmittedUserInput(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.latestSubmittedUserInput;
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
    this.cleanupDetector(sessionId);

    this.deps.db.update(session.id, {
      state: 'ended',
      endedAt: session.endedAt,
    });

    this.emitStateChanged(session, prev, 'ended');
  }

  /**
   * Delete a session
   * Only allowed for sessions in 'ended' state
   */
  delete(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (session.state !== 'ended') {
      throw new Error(`Cannot delete session in state: ${session.state}`);
    }

    // Remove from memory
    this.sessions.delete(sessionId);
    this.terminalToSession.delete(session.terminalId);
    this.cleanupDetector(sessionId);

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
    this.comparators.get(session.id)?.observeHookState(session.state);
    this.deps.eventBus.emit({
      type: 'session.state.changed',
      sessionId: session.id,
      workspaceId: session.workspaceId,
      from: from ?? 'draft',
      to,
      session: session.toDTO(),
    } as any);
  }
  private attachShadowDetector(session: ActiveSession, provider: ProviderDefinition): void {
    if (!provider.idleHeuristics) {
      return;
    }

    const comparator = createShadowComparator((info) => {
      this.logger.warn(
        {
          ...info,
          sessionId: session.id,
          terminalId: session.terminalId,
          providerId: session.providerId,
        },
        '[SessionManager] PTY shadow state divergence'
      );
    });

    const detector = new PtyStateDetector({
      heuristics: provider.idleHeuristics,
      onStateChange: (state) => {
        const activeSession = this.sessions.get(session.id);
        if (!activeSession) {
          return;
        }

        const prev = activeSession.state;
        if (state === 'running' && prev !== 'running') {
          activeSession.state = 'running';
          activeSession.lastActiveAt = Date.now();
          if (!activeSession.startedAt) {
            activeSession.startedAt = activeSession.lastActiveAt;
          }
          this.deps.db.update(session.id, {
            state: 'running',
            startedAt: activeSession.startedAt,
            lastActiveAt: activeSession.lastActiveAt,
          });
          this.emitStateChanged(activeSession, prev, 'running');
        } else if (state === 'idle' && (prev === 'running' || prev === 'starting')) {
          const shouldEmitTurnCompleted = activeSession.awaitingTurnCompletion;
          activeSession.state = 'idle';
          activeSession.awaitingTurnCompletion = false;
          if (!activeSession.startedAt) {
            activeSession.startedAt = Date.now();
          }
          this.deps.db.update(session.id, {
            state: 'idle',
            startedAt: activeSession.startedAt,
          });
          this.emitStateChanged(activeSession, prev, 'idle');
          if (shouldEmitTurnCompleted) {
            this.deps.eventBus.emit({
              type: 'session.lifecycle',
              workspaceId: activeSession.workspaceId,
              sessionId: activeSession.id,
              event: 'turn_completed',
            } as DomainEvent);
          }
        }

        comparator.observePtyState(state);
      },
    });

    const unsubscribe = this.deps.eventBus.on('terminal.output', (event: TerminalOutputEvent) => {
      if (event.terminalId !== session.terminalId) {
        return;
      }

      detector.feed(event.chunk);
    });

    this.comparators.set(session.id, comparator);
    this.detectors.set(session.id, detector);
    this.detectorUnsubscribes.set(session.id, unsubscribe);
  }

  private cleanupDetector(sessionId: string): void {
    this.detectorUnsubscribes.get(sessionId)?.();
    this.detectorUnsubscribes.delete(sessionId);
    this.detectors.get(sessionId)?.dispose();
    this.detectors.delete(sessionId);
    this.comparators.delete(sessionId);
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
  capability: 'full' | 'limited' | 'unsupported';
  startedAt?: number;
  lastActiveAt: number;
  endedAt?: number;
  completionPercent?: number;
  errorReason?: string;
  exitCode?: number;
  draft?: string;
  title?: string;
  latestSubmittedUserInput?: string;
  awaitingTurnCompletion = false;

  constructor(data: {
    id: string;
    workspaceId: string;
    providerId: string;
    terminalId: string;
    capability: 'full' | 'limited' | 'unsupported';
    state: SessionState;
    draft?: string;
    title?: string;
    startedAt?: number;
    lastActiveAt?: number;
    endedAt?: number;
    completionPercent?: number;
    errorReason?: string;
  }) {
    this.id = data.id;
    this.workspaceId = data.workspaceId;
    this.providerId = data.providerId;
    this.terminalId = data.terminalId;
    this.capability = data.capability;
    this.state = data.state;
    this.draft = data.draft;
    this.title = data.title;
    this.startedAt = data.startedAt ?? Date.now();
    this.lastActiveAt = data.lastActiveAt ?? this.startedAt;
    this.endedAt = data.endedAt;
    this.completionPercent = data.completionPercent;
    this.errorReason = data.errorReason;
  }

  toDTO(): Session {
    return {
      id: this.id,
      workspaceId: this.workspaceId,
      terminalId: this.terminalId,
      providerId: this.providerId,
      state: this.state,
      capability: this.capability,
      startedAt: this.startedAt ?? Date.now(),
      lastActiveAt: this.lastActiveAt,
      endedAt: this.endedAt,
      completionPercent: this.completionPercent,
      errorReason: this.errorReason,
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
