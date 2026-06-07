/**
 * Session Manager (spec §4.6)
 *
 * Session is a business wrapper around an agent-kind Terminal.
 * It manages Agent domain semantics and the PTY-driven state machine.
 */

import type {
  DomainEvent,
  ProviderDefinition,
  Session,
  SessionState,
  TerminalInputActivity,
} from "@coder-studio/core";
import { deriveSessionTitle, normalizeSessionTitleInput } from "@coder-studio/core";
import type { EventBus, Unsubscribe } from "../bus/event-bus.js";
import { mergeProviderLaunchConfig } from "../provider-config.js";
import type { ProviderConfigRepo } from "../storage/repositories/provider-config-repo.js";
import { type SessionRow, sessionToRow } from "../storage/repositories/session-repo.js";
import type { TerminalManager } from "../terminal/manager.js";
import type { RenderOptions } from "../terminal/snapshot-render.js";
import type { TerminalSpec } from "../terminal/types.js";
import type { Broadcaster } from "../ws/hub.js";
import { PtyStateDetector } from "./pty-state-detector.js";
import { createShadowComparator, type ShadowComparator } from "./state-shadow-comparator.js";
import type { SessionDatabase } from "./types.js";

export interface CreateSessionRequest {
  workspaceId: string;
  workspacePath: string;
  providerId: string;
  provider: ProviderDefinition;
  draft?: string;
  /**
   * Hex color of the xterm.js theme background that will render this
   * session's terminal. Forwarded to TerminalSpec.themeBackground so the
   * PTY env can advertise COLORFGBG to the agent CLI (see TerminalManager).
   */
  themeBackground?: string;
}

export interface SessionLogger {
  warn(context: Record<string, unknown>, message: string): void;
}

export interface SessionRuntimeContext {
  apiUrl?: string;
}

export interface SessionManagerDeps {
  terminalMgr: TerminalManager;
  eventBus: EventBus;
  db: SessionDatabase;
  broadcaster: Broadcaster;
  providerRegistry: ProviderDefinition[];
  providerConfigRepo: ProviderConfigRepo;
  runtimeContext?: SessionRuntimeContext;
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

type TerminalExitedEvent = Extract<DomainEvent, { type: "terminal.exited" }>;
type TerminalOutputEvent = Extract<DomainEvent, { type: "terminal.output" }>;

const RECENT_INPUT_ECHO_WINDOW_MS = 3_000;
const RECENT_INPUT_ECHO_MAX_EVENTS = 12;
const RECENT_INPUT_ECHO_MAX_BYTES = 8_192;
const RECENT_OPAQUE_INPUT_ECHO_WINDOW_MS = 200;
const RESUME_OUTPUT_AGGREGATION_WINDOW_MS = 75;
const RESUME_OUTPUT_AGGREGATION_MAX_BYTES = 4_096;
const TERMINAL_ESCAPE_SEQUENCE_PATTERN =
  /^\x1b(?:\[[0-9;?<>]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|P[\s\S]*?\x1b\\|[@-_])/;

interface RecentInputEcho {
  at: number;
  activity: TerminalInputActivity;
  byteLength: number;
  opaque: boolean;
  remainingVisibleText: string;
}

interface TerminalOutputAssessment {
  shouldResumeRunning: boolean;
  countsAsTurnOutput: boolean;
  shouldAggregateForResume: boolean;
}

interface PendingResumeAggregation {
  startedAt: number;
  chunks: Buffer[];
  byteLength: number;
  timer: NodeJS.Timeout | null;
}

function readTerminalEscapeSequence(text: string, start: number): string | null {
  const match = text.slice(start).match(TERMINAL_ESCAPE_SEQUENCE_PATTERN);
  return match?.[0] ?? null;
}

function isTerminalSubmitInput(data: string): boolean {
  if (data.includes("\r") || data.includes("\n")) {
    return true;
  }

  // Kitty keyboard Enter: ESC [ 13 ; modifiers u/~
  if (/\x1b\[13(?:;[\d;]*)?(?:u|~)/.test(data)) {
    return true;
  }

  // Application keypad Enter transmits ESC O M (same as CR).
  if (data.includes("\x1bOM")) {
    return true;
  }

  return false;
}

function resolveTerminalInputActivity(
  bytes: Buffer,
  activity: TerminalInputActivity
): TerminalInputActivity {
  if (
    activity === "submit" ||
    activity === "internal_submit" ||
    activity === "system" ||
    activity === "control"
  ) {
    return activity;
  }

  return isTerminalSubmitInput(bytes.toString("utf8")) ? "submit" : activity;
}

function classifyRecentInputEcho(
  bytes: Buffer
): Pick<RecentInputEcho, "opaque" | "remainingVisibleText"> {
  const text = bytes.toString("utf8");
  let opaque = false;
  let remainingVisibleText = "";

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;

    if (char === "\x1b") {
      const escape = readTerminalEscapeSequence(text, index);
      if (escape) {
        opaque = true;
        index += escape.length - 1;
        continue;
      }
    }

    if (char === "\r" || char === "\n" || char === "\t") {
      opaque = true;
      continue;
    }

    if (char === "\u007f" || char === "\b") {
      opaque = true;
      continue;
    }

    if (char < " ") {
      opaque = true;
      continue;
    }

    remainingVisibleText += char;
  }

  return { opaque, remainingVisibleText };
}

function extractVisibleTerminalText(bytes: Buffer): string {
  const text = bytes.toString("utf8");
  let visibleText = "";

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;

    if (char === "\x1b") {
      const escape = readTerminalEscapeSequence(text, index);
      if (escape) {
        index += escape.length - 1;
        continue;
      }
      continue;
    }

    if (char === "\u007f" || char === "\b") {
      visibleText = visibleText.slice(0, -1);
      continue;
    }

    if (char === "\r" || char === "\n") {
      visibleText += "\n";
      continue;
    }

    if (char === "\t") {
      visibleText += "\t";
      continue;
    }

    if (char < " ") {
      continue;
    }

    visibleText += char;
  }

  return visibleText;
}

function commonPrefixLength(left: string, right: string): number {
  const maxLength = Math.min(left.length, right.length);
  let index = 0;

  while (index < maxLength && left[index] === right[index]) {
    index += 1;
  }

  return index;
}

function chunkHasLineRepaintControl(text: string): boolean {
  return (
    text.includes("\r") || /\x1b\[[0-9;?]*K/.test(text) || /\x1b\[[0-9;?]*[ABCDGHF]/.test(text)
  );
}

function visibleOutputHasMultipleLines(visibleOutput: string): boolean {
  return (
    visibleOutput
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0).length > 1
  );
}

export class SessionManager {
  private sessions = new Map<string, ActiveSession>();
  private terminalToSession = new Map<string, string>();
  private detectors = new Map<string, PtyStateDetector>();
  private comparators = new Map<string, ShadowComparator>();
  private detectorUnsubscribes = new Map<string, Unsubscribe>();
  private readonly logger: SessionLogger;

  constructor(private readonly deps: SessionManagerDeps) {
    this.logger = deps.logger ?? NOOP_SESSION_LOGGER;

    this.deps.eventBus.on("terminal.exited", (event: TerminalExitedEvent) => {
      this.onTerminalExit(event.terminalId, event.exitCode);
    });
  }

  setProviderRegistry(providerRegistry: ProviderDefinition[]): void {
    this.deps.providerRegistry = providerRegistry;
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
      kind: "agent",
      argv: cmd.argv,
      cwd: cmd.cwd,
      env: {
        ...cmd.env,
        CODER_STUDIO: "1",
        CODER_STUDIO_WORKSPACE_ID: req.workspaceId,
        CODER_STUDIO_SESSION_ID: sessionId,
        CODER_STUDIO_PROVIDER_ID: req.providerId,
        ...(this.deps.runtimeContext?.apiUrl
          ? { CODER_STUDIO_API_URL: this.deps.runtimeContext.apiUrl }
          : {}),
      },
      title: req.provider.displayName,
      themeBackground: req.themeBackground,
    };

    // Create terminal (delegates to TerminalManager)
    const terminal = this.deps.terminalMgr.create(terminalSpec);

    // Register session only after terminal creation succeeds so failed creates
    // do not leak half-created sessions into memory or hydration state.
    const active = new ActiveSession({
      id: sessionId,
      workspaceId: req.workspaceId,
      providerId: req.providerId,
      terminalId: terminal.id,
      capability: req.provider.capability,
      state: "starting",
      draft: req.draft,
    });

    this.sessions.set(sessionId, active);
    this.terminalToSession.set(terminal.id, sessionId);
    this.attachShadowDetector(active, req.provider);

    // Persist initial (`starting`) row so subsequent update() calls have a
    // target to UPDATE and so a crash between here and the optimistic idle
    // promotion below still leaves a sane DB state.
    this.deps.db.insert(active.toRow());

    // Emit the initial `starting` snapshot so clients can latch session
    // creation before any optimistic transition fires.
    this.emitStateChanged(active, null, "starting");

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

    if (session.state === "ended") {
      this.terminalToSession.delete(session.terminalId);
      this.cleanupDetector(session.id);
      return;
    }

    await this.deps.terminalMgr.close(session.terminalId);

    const latestSession = this.sessions.get(session.id);
    if (!latestSession || latestSession.state === "ended") {
      return;
    }

    this.finishSession(
      latestSession,
      this.terminalToSession.has(latestSession.terminalId) ? undefined : 0
    );
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
        firstSubmittedUserInput: session.firstSubmittedUserInput,
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
    if (session.state === "draft") {
      return "draft";
    }

    const activeTerminal = this.deps.terminalMgr.get(session.terminalId);
    if (activeTerminal?.alive) {
      return session.state;
    }

    if (session.state === "ended") {
      return session.state;
    }

    return "ended";
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

  getAll(): Session[] {
    return Array.from(this.sessions.values()).map((session) => session.toDTO());
  }

  async stopForWorkspace(workspaceId: string): Promise<void> {
    const sessions = Array.from(this.sessions.values()).filter(
      (session) => session.workspaceId === workspaceId
    );

    for (const session of sessions) {
      if (session.state === "ended") {
        this.terminalToSession.delete(session.terminalId);
        this.cleanupDetector(session.id);
        continue;
      }

      await this.stop(session.id);
    }
  }

  deleteEndedForWorkspace(workspaceId: string): void {
    const endedSessions = Array.from(this.sessions.values()).filter(
      (session) => session.workspaceId === workspaceId && session.state === "ended"
    );

    for (const session of endedSessions) {
      this.deps.db.delete(session.id);
      this.sessions.delete(session.id);
      this.terminalToSession.delete(session.terminalId);
      this.cleanupDetector(session.id);
    }
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
    activity: TerminalInputActivity = "typing",
    text?: string
  ): void {
    const sessionId = this.terminalToSession.get(terminalId);
    if (!sessionId) return;

    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.applyTerminalInputActivity(session, activity, text, { armTurnCompletion: true });
  }

  private applyTerminalInputActivity(
    session: ActiveSession,
    activity: TerminalInputActivity,
    text: string | undefined,
    options: {
      armTurnCompletion: boolean;
      skipResumeWhenTurnCompletedSynchronously?: boolean;
    }
  ): void {
    const completedSynchronously =
      !options.armTurnCompletion && session.state === "idle" && !session.awaitingTurnCompletion;

    if (activity === "control" || activity === "typing") {
      return;
    }

    if (activity === "internal_submit") {
      if (options.armTurnCompletion) {
        session.awaitingTurnCompletion = true;
        session.sawOutputSinceTurnStart = false;
      }
      if (completedSynchronously) {
        return;
      }
      this.transitionSessionToRunning(session);
      return;
    }

    if (activity !== "submit") return;

    const submittedText = text;
    if (submittedText?.trim()) {
      session.latestSubmittedUserInput = submittedText.trim();
    }
    if (options.armTurnCompletion) {
      session.awaitingTurnCompletion = true;
      session.sawOutputSinceTurnStart = false;
    }

    // Title capture runs independently of state transitions: a session that
    // is still 'starting' or 'running' when the user types won't flip state
    // here, but we still want to record the first instruction as the title.
    const titleChanged = this.maybeAssignTitle(session, submittedText);

    const shouldResume = session.state === "idle" || session.state === "starting";

    if (shouldResume && !options.skipResumeWhenTurnCompletedSynchronously) {
      this.transitionSessionToRunning(session);
    } else if (titleChanged) {
      // State stayed the same, but the DTO changed (title added) and the UI
      // subscribes via state.changed broadcasts — fire a no-op transition so
      // the fresh DTO is pushed to clients.
      const prev = session.state;
      this.emitStateChanged(session, prev, session.state);
    }
  }

  /**
   * Session-level input writes to the underlying PTY and updates session activity.
   */
  sendInput(
    sessionId: string,
    bytes: Buffer,
    activity: TerminalInputActivity = "typing",
    submittedText?: string
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const resolvedActivity = resolveTerminalInputActivity(bytes, activity);

    const text =
      resolvedActivity === "submit" || resolvedActivity === "internal_submit"
        ? (submittedText ?? bytes.toString("utf8"))
        : undefined;
    const rollbackArm = this.armTurnCompletionBeforeWrite(session, resolvedActivity);
    const armedTurnCompletion = session.awaitingTurnCompletion;
    const rollbackRecentInput = this.recordRecentInputBeforeWrite(session, bytes, resolvedActivity);

    try {
      this.deps.terminalMgr.write(session.terminalId, bytes);
    } catch (error) {
      rollbackRecentInput?.();
      rollbackArm?.();
      throw error;
    }

    const turnCompletedSynchronously =
      armedTurnCompletion && !session.awaitingTurnCompletion && session.state === "idle";

    this.applyTerminalInputActivity(session, resolvedActivity, text, {
      armTurnCompletion: false,
      skipResumeWhenTurnCompletedSynchronously: turnCompletedSynchronously,
    });
    this.flushPendingPtyIdle(session);
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
      return "";
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

    const firstSubmittedUserInput = normalizeSessionTitleInput(text);
    if (!firstSubmittedUserInput) return false;

    const title = deriveSessionTitle(firstSubmittedUserInput);

    if (!title) return false;

    session.title = title;
    session.firstSubmittedUserInput = firstSubmittedUserInput;
    this.deps.db.update(session.id, { title, firstSubmittedUserInput });
    return true;
  }

  private transitionSessionToRunning(session: ActiveSession): void {
    if (session.state === "running") {
      return;
    }

    const prev = session.state;
    session.state = "running";
    session.lastActiveAt = Date.now();

    this.deps.db.update(session.id, {
      state: "running",
      lastActiveAt: session.lastActiveAt,
    });

    this.emitStateChanged(session, prev, "running");
  }

  private maybeResumeRunningFromOutput(
    session: ActiveSession,
    assessment: TerminalOutputAssessment,
    now: number = Date.now()
  ): void {
    if (!assessment.shouldResumeRunning) {
      return;
    }

    if (session.state !== "idle" && session.state !== "starting") {
      return;
    }

    if (!session.awaitingTurnCompletion && !this.hasRecentSubmitInput(session, now)) {
      return;
    }

    this.transitionSessionToRunning(session);
  }

  /**
   * Handle terminal exit event
   */
  onTerminalExit(terminalId: string, exitCode: number): void {
    const sessionId = this.terminalToSession.get(terminalId);
    if (!sessionId) return;

    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.finishSession(session, exitCode);
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

    if (session.state !== "ended") {
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
      type: "session.lifecycle",
      workspaceId: session.workspaceId,
      sessionId,
      event: "removed",
    } as DomainEvent);
  }

  /**
   * Emit state changed event
   */
  private emitStateChanged(
    session: ActiveSession,
    from: SessionState | null,
    to: SessionState
  ): void {
    this.comparators.get(session.id)?.observeHookState(session.state);
    const event: Extract<DomainEvent, { type: "session.state.changed" }> = {
      type: "session.state.changed",
      sessionId: session.id,
      workspaceId: session.workspaceId,
      from: from ?? "draft",
      to,
      session: session.toDTO(),
    };
    this.deps.eventBus.emit(event);
  }

  private armTurnCompletionBeforeWrite(
    session: ActiveSession,
    activity: TerminalInputActivity
  ): (() => void) | null {
    if (activity !== "submit" && activity !== "internal_submit") {
      return null;
    }

    const previousAwaitingTurnCompletion = session.awaitingTurnCompletion;
    const previousSawOutputSinceTurnStart = session.sawOutputSinceTurnStart;
    session.awaitingTurnCompletion = true;
    session.sawOutputSinceTurnStart = false;

    return () => {
      session.awaitingTurnCompletion = previousAwaitingTurnCompletion;
      session.sawOutputSinceTurnStart = previousSawOutputSinceTurnStart;
    };
  }

  private recordRecentInputBeforeWrite(
    session: ActiveSession,
    bytes: Buffer,
    activity: TerminalInputActivity
  ): (() => void) | null {
    if (activity === "system") {
      return null;
    }

    const { opaque, remainingVisibleText } = classifyRecentInputEcho(bytes);
    if (!opaque && remainingVisibleText.length === 0) {
      return null;
    }

    const recentInput: RecentInputEcho = {
      at: Date.now(),
      activity,
      byteLength: bytes.byteLength,
      opaque,
      remainingVisibleText,
    };

    session.recentInputEchoes.push(recentInput);
    this.pruneRecentInputEchoes(session, recentInput.at);

    return () => {
      const index = session.recentInputEchoes.indexOf(recentInput);
      if (index !== -1) {
        session.recentInputEchoes.splice(index, 1);
      }
    };
  }

  private pruneRecentInputEchoes(session: ActiveSession, now: number = Date.now()): void {
    session.recentInputEchoes = session.recentInputEchoes.filter(
      (entry) =>
        now - entry.at <= RECENT_INPUT_ECHO_WINDOW_MS &&
        (entry.opaque || entry.remainingVisibleText.length > 0)
    );

    let totalBytes = session.recentInputEchoes.reduce((sum, entry) => sum + entry.byteLength, 0);
    while (
      session.recentInputEchoes.length > RECENT_INPUT_ECHO_MAX_EVENTS ||
      totalBytes > RECENT_INPUT_ECHO_MAX_BYTES
    ) {
      const removed = session.recentInputEchoes.shift();
      if (!removed) {
        break;
      }
      totalBytes -= removed.byteLength;
    }
  }

  private clearPendingResumeAggregation(session: ActiveSession): void {
    if (session.pendingResumeAggregation?.timer) {
      clearTimeout(session.pendingResumeAggregation.timer);
    }
    session.pendingResumeAggregation = null;
  }

  private consumeRecentLiteralEcho(
    session: ActiveSession,
    visibleOutput: string
  ): { matchedLiteralEcho: boolean; leftoverVisibleOutput: string } {
    let offset = 0;
    let matchedLiteralEcho = false;

    for (const entry of session.recentInputEchoes) {
      if (offset >= visibleOutput.length) {
        break;
      }

      if (entry.remainingVisibleText.length === 0) {
        continue;
      }

      const currentVisibleText = entry.remainingVisibleText;
      const matchLength = commonPrefixLength(visibleOutput.slice(offset), currentVisibleText);
      if (matchLength === 0) {
        break;
      }

      entry.remainingVisibleText = currentVisibleText.slice(matchLength);
      offset += matchLength;
      matchedLiteralEcho = true;

      if (matchLength < currentVisibleText.length) {
        break;
      }
    }

    return {
      matchedLiteralEcho,
      leftoverVisibleOutput: visibleOutput.slice(offset),
    };
  }

  private hasRecentNonSubmitInput(session: ActiveSession, now: number): boolean {
    return session.recentInputEchoes.some(
      (entry) =>
        entry.activity !== "submit" &&
        entry.activity !== "internal_submit" &&
        now - entry.at <= RECENT_OPAQUE_INPUT_ECHO_WINDOW_MS
    );
  }

  private hasRecentSubmitInput(session: ActiveSession, now: number): boolean {
    return session.recentInputEchoes.some(
      (entry) =>
        (entry.activity === "submit" || entry.activity === "internal_submit") &&
        now - entry.at <= RECENT_INPUT_ECHO_WINDOW_MS
    );
  }

  private hasRecentOpaqueNonSubmitInput(session: ActiveSession, now: number): boolean {
    return session.recentInputEchoes.some(
      (entry) =>
        entry.opaque &&
        entry.activity !== "submit" &&
        entry.activity !== "internal_submit" &&
        now - entry.at <= RECENT_OPAQUE_INPUT_ECHO_WINDOW_MS
    );
  }

  private hasRecentControlInput(session: ActiveSession, now: number): boolean {
    return session.recentInputEchoes.some(
      (entry) =>
        entry.activity === "control" && now - entry.at <= RECENT_OPAQUE_INPUT_ECHO_WINDOW_MS
    );
  }

  private getRecentVisibleInputText(session: ActiveSession): string {
    return session.recentInputEchoes
      .filter((entry) => entry.activity !== "submit" && entry.activity !== "internal_submit")
      .map((entry) => entry.remainingVisibleText)
      .join("");
  }

  private isLikelyPureInputRepaint(
    session: ActiveSession,
    chunk: Buffer,
    visibleOutput: string,
    now: number
  ): boolean {
    if (!this.hasRecentNonSubmitInput(session, now)) {
      return false;
    }

    if (!visibleOutput.trim()) {
      return true;
    }

    const chunkText = chunk.toString("utf8");
    if (chunkText.includes("\n")) {
      return false;
    }

    if (visibleOutputHasMultipleLines(visibleOutput)) {
      return false;
    }

    if (!chunkHasLineRepaintControl(chunkText)) {
      return false;
    }

    if (this.hasRecentOpaqueNonSubmitInput(session, now)) {
      return true;
    }

    const recentVisibleInputText = this.getRecentVisibleInputText(session);
    const trimmedVisibleOutput = visibleOutput.trim();
    if (!recentVisibleInputText || !trimmedVisibleOutput) {
      return false;
    }

    return (
      recentVisibleInputText === trimmedVisibleOutput ||
      recentVisibleInputText.startsWith(trimmedVisibleOutput) ||
      trimmedVisibleOutput.endsWith(recentVisibleInputText)
    );
  }

  private assessTerminalOutput(session: ActiveSession, chunk: Buffer): TerminalOutputAssessment {
    const now = Date.now();
    this.pruneRecentInputEchoes(session, now);

    if (session.recentInputEchoes.length === 0) {
      const hasVisibleText = extractVisibleTerminalText(chunk).trim().length > 0;
      return {
        shouldResumeRunning: hasVisibleText,
        countsAsTurnOutput: hasVisibleText,
        shouldAggregateForResume: false,
      };
    }

    const visibleOutput = extractVisibleTerminalText(chunk);
    const { matchedLiteralEcho, leftoverVisibleOutput } = this.consumeRecentLiteralEcho(
      session,
      visibleOutput
    );
    const hasRecentNonSubmitInput = this.hasRecentNonSubmitInput(session, now);
    const hasRecentControlInput = this.hasRecentControlInput(session, now);

    this.pruneRecentInputEchoes(session, now);

    const trimmedLeftoverVisibleOutput = leftoverVisibleOutput.trim();
    const trimmedVisibleOutput = visibleOutput.trim();
    const suppressImmediateResumeAfterControl = hasRecentControlInput && !matchedLiteralEcho;
    const chunkText = chunk.toString("utf8");
    const shouldAggregateForResume =
      session.state === "idle" &&
      hasRecentNonSubmitInput &&
      !matchedLiteralEcho &&
      trimmedVisibleOutput.length > 0 &&
      chunkHasLineRepaintControl(chunkText) &&
      !visibleOutputHasMultipleLines(visibleOutput);

    const shouldResumeRunning = suppressImmediateResumeAfterControl
      ? false
      : trimmedLeftoverVisibleOutput.length > 0
        ? !this.isLikelyPureInputRepaint(session, chunk, leftoverVisibleOutput, now)
        : !matchedLiteralEcho &&
          trimmedVisibleOutput.length > 0 &&
          !this.isLikelyPureInputRepaint(session, chunk, visibleOutput, now);

    const countsAsTurnOutput =
      !suppressImmediateResumeAfterControl &&
      (trimmedLeftoverVisibleOutput.length > 0
        ? !this.isLikelyPureInputRepaint(session, chunk, leftoverVisibleOutput, now)
        : !matchedLiteralEcho &&
          trimmedVisibleOutput.length > 0 &&
          !this.isLikelyPureInputRepaint(session, chunk, visibleOutput, now));

    return {
      shouldResumeRunning,
      countsAsTurnOutput,
      shouldAggregateForResume,
    };
  }

  private flushPendingResumeAggregation(session: ActiveSession): void {
    const pending = session.pendingResumeAggregation;
    if (!pending) {
      return;
    }

    this.clearPendingResumeAggregation(session);
    if (session.state !== "idle") {
      return;
    }

    const combinedChunk = Buffer.concat(pending.chunks, pending.byteLength);
    const outputAssessment = this.assessTerminalOutput(session, combinedChunk);
    if (outputAssessment.countsAsTurnOutput) {
      session.sawOutputSinceTurnStart = true;
    }
    this.maybeResumeRunningFromOutput(session, outputAssessment);
  }

  private schedulePendingResumeAggregation(session: ActiveSession, chunk: Buffer): void {
    const pending = session.pendingResumeAggregation;
    if (!pending) {
      const nextPending: PendingResumeAggregation = {
        startedAt: Date.now(),
        chunks: [chunk],
        byteLength: chunk.byteLength,
        timer: null,
      };
      nextPending.timer = setTimeout(() => {
        const activeSession = this.sessions.get(session.id);
        if (!activeSession) {
          return;
        }
        this.flushPendingResumeAggregation(activeSession);
      }, RESUME_OUTPUT_AGGREGATION_WINDOW_MS);
      session.pendingResumeAggregation = nextPending;
      return;
    }

    pending.chunks.push(chunk);
    pending.byteLength += chunk.byteLength;

    const combinedChunk = Buffer.concat(pending.chunks, pending.byteLength);
    const visibleOutput = extractVisibleTerminalText(combinedChunk);
    const combinedText = combinedChunk.toString("utf8");
    const shouldFlushNow =
      pending.byteLength >= RESUME_OUTPUT_AGGREGATION_MAX_BYTES ||
      combinedText.includes("\n") ||
      visibleOutputHasMultipleLines(visibleOutput);

    if (shouldFlushNow) {
      this.flushPendingResumeAggregation(session);
    }
  }

  private flushPendingPtyIdle(session: ActiveSession): void {
    const ptyState = this.comparators.get(session.id)?.snapshot().ptyState;
    if (ptyState !== "idle") {
      return;
    }

    this.transitionSessionToIdle(session);
  }

  private transitionSessionToIdle(activeSession: ActiveSession): void {
    this.clearPendingResumeAggregation(activeSession);
    const prev = activeSession.state;
    if (prev !== "running" && prev !== "starting") {
      return;
    }

    if (prev === "running" && !activeSession.sawOutputSinceTurnStart) {
      return;
    }

    const shouldEmitTurnCompleted = prev === "running" && activeSession.awaitingTurnCompletion;
    activeSession.state = "idle";
    activeSession.awaitingTurnCompletion = false;
    activeSession.sawOutputSinceTurnStart = false;
    if (!activeSession.startedAt) {
      activeSession.startedAt = Date.now();
    }
    this.deps.db.update(activeSession.id, {
      state: "idle",
      startedAt: activeSession.startedAt,
    });
    this.emitStateChanged(activeSession, prev, "idle");
    if (shouldEmitTurnCompleted) {
      this.deps.eventBus.emit({
        type: "session.lifecycle",
        workspaceId: activeSession.workspaceId,
        sessionId: activeSession.id,
        event: "turn_completed",
      } as DomainEvent);
    }
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
        "[SessionManager] PTY shadow state divergence"
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
        if (state === "idle" && (prev === "running" || prev === "starting")) {
          this.transitionSessionToIdle(activeSession);
        }

        comparator.observePtyState(state);
      },
    });

    const unsubscribe = this.deps.eventBus.on("terminal.output", (event: TerminalOutputEvent) => {
      if (event.terminalId !== session.terminalId) {
        return;
      }

      const activeSession = this.sessions.get(session.id);
      if (!activeSession) {
        return;
      }

      if (activeSession.pendingResumeAggregation && activeSession.state !== "idle") {
        this.clearPendingResumeAggregation(activeSession);
      }

      if (activeSession.pendingResumeAggregation) {
        this.schedulePendingResumeAggregation(activeSession, event.chunk);
        detector.feed(event.chunk);
        return;
      }

      const outputAssessment = this.assessTerminalOutput(activeSession, event.chunk);
      if (outputAssessment.shouldAggregateForResume) {
        this.schedulePendingResumeAggregation(activeSession, event.chunk);
        detector.feed(event.chunk);
        return;
      }
      if (outputAssessment.countsAsTurnOutput) {
        activeSession.sawOutputSinceTurnStart = true;
      }

      this.maybeResumeRunningFromOutput(activeSession, outputAssessment);

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

  private finishSession(session: ActiveSession, exitCode: number | undefined): void {
    this.clearPendingResumeAggregation(session);
    const prev = session.state;
    session.state = "ended";
    session.endedAt = Date.now();
    session.exitCode = exitCode;
    this.terminalToSession.delete(session.terminalId);
    this.cleanupDetector(session.id);

    this.deps.db.update(session.id, {
      state: "ended",
      endedAt: session.endedAt,
    });

    this.emitStateChanged(session, prev, "ended");
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
  capability: "full" | "limited" | "unsupported";
  startedAt?: number;
  lastActiveAt: number;
  endedAt?: number;
  completionPercent?: number;
  errorReason?: string;
  exitCode?: number;
  draft?: string;
  title?: string;
  firstSubmittedUserInput?: string;
  latestSubmittedUserInput?: string;
  awaitingTurnCompletion = false;
  sawOutputSinceTurnStart = false;
  recentInputEchoes: RecentInputEcho[] = [];
  pendingResumeAggregation: PendingResumeAggregation | null = null;

  constructor(data: {
    id: string;
    workspaceId: string;
    providerId: string;
    terminalId: string;
    capability: "full" | "limited" | "unsupported";
    state: SessionState;
    draft?: string;
    title?: string;
    firstSubmittedUserInput?: string;
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
    this.firstSubmittedUserInput = data.firstSubmittedUserInput;
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
      firstSubmittedUserInput: this.firstSubmittedUserInput,
    };
  }

  toRow(): SessionRow {
    return sessionToRow({
      ...this.toDTO(),
      ...(this.draft !== undefined ? { draft: this.draft } : {}),
    });
  }
}
