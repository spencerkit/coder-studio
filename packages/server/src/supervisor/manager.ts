import {
  type CycleStatus,
  DEFAULT_SUPERVISOR_CONFIG,
  type DomainEvent,
  type ProviderDefinition,
  type Supervisor,
  type SupervisorConfig,
  type SupervisorCycle,
  type SupervisorCycleTargetRecord,
  type SupervisorRuntimePhase,
  type SupervisorState,
  type SupervisorTargetMemory,
  Topics,
} from "@coder-studio/core";
import type { FastifyBaseLogger } from "fastify";
import type { EventBus } from "../bus/event-bus.js";
import type { SessionManager } from "../session/manager.js";
import type { ProviderConfigRepo } from "../storage/repositories/provider-config-repo.js";
import type { SettingsRepo } from "../storage/repositories/settings-repo.js";
import type { SupervisorCycleAttemptRepo } from "../storage/repositories/supervisor-cycle-attempt-repo.js";
import type { SupervisorCycleRepo } from "../storage/repositories/supervisor-cycle-repo.js";
import type { SupervisorRepo } from "../storage/repositories/supervisor-repo.js";
import type { TerminalManager } from "../terminal/manager.js";
import type { WorkspaceManager } from "../workspace/manager.js";
import type { Broadcaster } from "../ws/hub.js";
import type { SupervisorEvaluationContext } from "./context-builder.js";
import { SupervisorContextBuilder } from "./context-builder.js";
import { type SupervisorEvaluationResult, SupervisorEvaluator } from "./evaluator.js";
import {
  describeNonInjectableState,
  INJECTABLE_SESSION_STATES,
  SupervisorInjector,
} from "./injector.js";
import { SupervisorScheduler } from "./scheduler.js";
import { getSupervisorRetrySettings } from "./settings.js";
import type { SupervisorTargetMeta } from "./target-store.js";

const NOOP_LOGGER: FastifyBaseLogger = {
  child: () => NOOP_LOGGER,
  debug: () => {},
  error: () => {},
  fatal: () => {},
  info: () => {},
  level: "silent",
  silent: () => {},
  trace: () => {},
  warn: () => {},
};

type SessionLifecycleEvent = Extract<DomainEvent, { type: "session.lifecycle" }>;
type SupervisorEvaluateResult = Extract<SupervisorEvaluationResult, { mode: "evaluate" }>;

/**
 * Internal handoff between the synchronous `beginCycle` and the async
 * `finishCycle` phases of a supervisor evaluation.
 */
interface StartedCycle {
  cycle: SupervisorCycle;
  supervisor: Supervisor;
  context: SupervisorEvaluationContext;
  targetId: string;
  retry: SupervisorRetrySnapshot;
  trigger: "turn_completed" | "manual" | "scheduled";
}

interface DeferredCompletion {
  promise: Promise<void>;
  resolve: () => void;
}

interface SupervisorRetrySnapshot {
  retryEnabled: boolean;
  retryMaxCount: number;
  retryDelayMs: number;
  retryOnTimeout: boolean;
  retryOnEvaluatorError: boolean;
}

interface SupervisorCycleRuntimeSnapshot {
  phase: SupervisorRuntimePhase;
  currentAttemptIndex?: number;
  attemptCount?: number;
  maxAttempts?: number;
  lastAttemptError?: string;
  nextRetryAt?: number;
}

interface CompletedCycleEvaluation {
  evaluation: SupervisorEvaluateResult;
  injected: boolean;
  injectedText?: string;
  targetMemory: SupervisorTargetMemory;
}

export interface SupervisorManagerDeps {
  eventBus: EventBus;
  broadcaster: Broadcaster;
  terminalMgr: TerminalManager;
  workspaceMgr: WorkspaceManager;
  sessionMgr: SessionManager;
  providerRegistry: ProviderDefinition[];
  providerConfigRepo: ProviderConfigRepo;
  settingsRepo: Pick<SettingsRepo, "get">;
  supervisorRepo: SupervisorRepo;
  cycleRepo: SupervisorCycleRepo;
  cycleAttemptRepo: Pick<
    SupervisorCycleAttemptRepo,
    "create" | "update" | "listForCycle" | "deleteForCycle"
  >;
  targetStore: {
    createTargetFiles: typeof import("./target-store.js").createTargetFiles;
    resetTargetFiles: typeof import("./target-store.js").resetTargetFiles;
    readTargetMeta: typeof import("./target-store.js").readTargetMeta;
    loadTargetMemory: typeof import("./target-store.js").loadTargetMemory;
    saveTargetMeta: typeof import("./target-store.js").saveTargetMeta;
    saveTargetMemory: typeof import("./target-store.js").saveTargetMemory;
    appendTargetCycleRecord: typeof import("./target-store.js").appendTargetCycleRecord;
    markTargetSuperseded: typeof import("./target-store.js").markTargetSuperseded;
    readTargetCycleRecords: typeof import("./target-store.js").readTargetCycleRecords;
  };
  logger?: FastifyBaseLogger;
  config?: SupervisorConfig;
}

export interface CreateSupervisorRequest {
  sessionId: string;
  workspaceId: string;
  objective: string;
  evaluatorProviderId: string;
  evaluatorModel?: string;
  maxSupervisionCount?: number;
  scheduledAt?: number;
}

export interface UpdateSupervisorRequest {
  objective?: string;
  evaluatorProviderId?: string;
  evaluatorModel?: string | null;
  maxSupervisionCount?: number;
  scheduledAt?: number | null;
}

function createDeferredCompletion(): DeferredCompletion {
  let resolve = () => {};
  const promise = new Promise<void>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function generateSupervisorId(): string {
  return `sup_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function generateCycleId(): string {
  return `cycle_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function generateAttemptId(): string {
  return `attempt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === "object" && "message" in error) {
    const value = (error as { message: unknown }).message;
    if (typeof value === "string") {
      return value;
    }
  }
  return fallback;
}

function logFailure(
  logger: FastifyBaseLogger,
  error: unknown,
  context: Record<string, unknown>,
  message: string
): void {
  logger.error({ ...context, err: error }, message);
}

function isDecomposeResult(
  result: SupervisorEvaluationResult | { mode?: string }
): result is Extract<SupervisorEvaluationResult, { mode: "decompose" }> {
  return result.mode === "decompose";
}

function isEvaluateStopResult(
  result: SupervisorEvaluateResult | { status?: string }
): result is Extract<SupervisorEvaluateResult, { status: "stop" }> {
  return "status" in result && result.status === "stop";
}

export class SupervisorManager {
  private readonly supervisors = new Map<string, Supervisor>();
  private readonly supervisorsBySession = new Map<string, string>();
  private readonly inFlight = new Set<string>();
  private readonly pendingDeletes = new Set<string>();
  private readonly pendingPauses = new Set<string>();
  private readonly pendingObjectiveUpdates = new Set<string>();
  private readonly evaluationAbortControllers = new Map<string, AbortController>();
  private readonly inFlightCompletions = new Map<string, DeferredCompletion>();
  private readonly scheduler: SupervisorScheduler;
  private readonly contextBuilder: SupervisorContextBuilder;
  private readonly evaluator: SupervisorEvaluator;
  private readonly injector: SupervisorInjector;
  private readonly logger: FastifyBaseLogger;
  private readonly config: SupervisorConfig;
  private lifecycleUnsubscribe: (() => void) | null = null;

  constructor(private readonly deps: SupervisorManagerDeps) {
    this.logger = deps.logger ?? NOOP_LOGGER;
    this.config = deps.config ?? DEFAULT_SUPERVISOR_CONFIG;
    this.contextBuilder = new SupervisorContextBuilder({
      workspaceMgr: deps.workspaceMgr,
      sessionMgr: deps.sessionMgr,
      terminalMgr: deps.terminalMgr,
      providerRegistry: deps.providerRegistry,
      logger: this.logger,
    });
    this.evaluator = new SupervisorEvaluator({
      providerRegistry: deps.providerRegistry,
      providerConfigRepo: deps.providerConfigRepo,
      settingsRepo: deps.settingsRepo,
      config: this.config,
      logger: this.logger,
    });
    this.injector = new SupervisorInjector({
      sessionMgr: deps.sessionMgr,
      terminalMgr: deps.terminalMgr,
      config: this.config,
    });
    this.scheduler = new SupervisorScheduler({
      eventBus: deps.eventBus,
      onTurnCompleted: (sessionId) => {
        const supervisorId = this.supervisorsBySession.get(sessionId);
        if (supervisorId) {
          void this.runEvaluation(supervisorId, "turn_completed").catch((error) => {
            this.logger.warn({ err: error, supervisorId }, "Supervisor auto-evaluation failed");
          });
        }
      },
      listScheduledSupervisors: () => this.listScheduledSupervisors(),
      onScheduledDue: (supervisorId) => {
        void this.runEvaluation(supervisorId, "scheduled").catch((error) => {
          this.logger.warn(
            { err: error, supervisorId },
            "Supervisor scheduled auto-evaluation failed"
          );
        });
      },
    });
  }

  async hydrate(): Promise<void> {
    this.supervisors.clear();
    this.supervisorsBySession.clear();

    for (const supervisor of this.deps.supervisorRepo.listAll()) {
      const hydratedWithTarget = await this.hydrateTargetState(supervisor);
      const normalizedState =
        hydratedWithTarget.state === "evaluating" || hydratedWithTarget.state === "injecting"
          ? "idle"
          : hydratedWithTarget.state;

      const recovered =
        normalizedState === hydratedWithTarget.state
          ? hydratedWithTarget
          : this.withCurrentTargetState(
              this.deps.supervisorRepo.update(hydratedWithTarget.id, {
                state: normalizedState,
                errorReason: null,
                updatedAt: Date.now(),
              })
            );

      // Any cycle still in a transient state belongs to a previous server
      // process (or a long-fixed buggy code path). Mark it as failed so it
      // doesn't sit forever in the UI as "queued"/"evaluating".
      const stale = this.deps.cycleRepo
        .listRecentForSupervisor(hydratedWithTarget.id, this.config.maxCyclesPerSession)
        .filter((cycle) => cycle.status === "queued" || cycle.status === "evaluating");
      for (const cycle of stale) {
        try {
          this.deps.cycleRepo.update(cycle.id, {
            status: "failed",
            errorReason: "Orphaned before server restart",
            completedAt: Date.now(),
          });
        } catch (error) {
          this.logger.warn(
            { err: error, cycleId: cycle.id, supervisorId: hydratedWithTarget.id },
            "Failed to clean up stale cycle on hydrate"
          );
        }
      }

      this.storeSnapshot(this.attachCycles(recovered));
    }

    this.lifecycleUnsubscribe?.();
    this.lifecycleUnsubscribe = this.deps.eventBus.on(
      "session.lifecycle",
      (event: SessionLifecycleEvent) => {
        if (event.event !== "removed") {
          return;
        }
        const supervisorId = this.supervisorsBySession.get(event.sessionId);
        if (supervisorId) {
          void this.delete(supervisorId).catch((error) => {
            this.logger.warn({ err: error, supervisorId }, "Auto-delete on session removal failed");
          });
        }
      }
    );

    this.scheduler.start();
    this.scheduler.refresh();
  }

  stop(): void {
    this.scheduler.stop();
    this.lifecycleUnsubscribe?.();
    this.lifecycleUnsubscribe = null;
  }

  get(id: string): Supervisor | undefined {
    return this.supervisors.get(id);
  }

  getBySession(sessionId: string): Supervisor | undefined {
    const supervisorId = this.supervisorsBySession.get(sessionId);
    return supervisorId ? this.supervisors.get(supervisorId) : undefined;
  }

  async deleteForWorkspace(workspaceId: string): Promise<void> {
    const supervisorIds = Array.from(this.supervisors.values())
      .filter((supervisor) => supervisor.workspaceId === workspaceId)
      .map((supervisor) => supervisor.id);
    const pending: Promise<void>[] = [];

    for (const supervisorId of supervisorIds) {
      const supervisor = this.supervisors.get(supervisorId);
      if (!supervisor) {
        continue;
      }

      this.pendingDeletes.add(supervisorId);
      if (!this.inFlight.has(supervisorId)) {
        this.deleteNow(supervisor);
        continue;
      }

      this.evaluationAbortControllers.get(supervisorId)?.abort();
      const completion = this.inFlightCompletions.get(supervisorId);
      if (completion) {
        pending.push(completion.promise);
      }
    }

    await Promise.all(pending);
  }

  async create(req: CreateSupervisorRequest): Promise<Supervisor> {
    const session = this.deps.sessionMgr.get(req.sessionId);
    if (!session) {
      throw {
        code: "supervisor_not_found",
        message: `Session ${req.sessionId} not found`,
      };
    }
    if (session.state === "draft") {
      throw {
        code: "supervisor_unsupported_provider",
        message: "Draft sessions cannot enable supervisor",
      };
    }
    const sessionProvider = this.requireSessionProvider(session.providerId);
    if (!this.supportsSupervisor(sessionProvider)) {
      throw {
        code: "supervisor_unsupported_provider",
        message: `Provider ${session.providerId} does not support supervisor-driven sessions`,
      };
    }
    if (this.supervisorsBySession.has(req.sessionId)) {
      throw {
        code: "supervisor_already_exists",
        message: `Supervisor already exists for ${req.sessionId}`,
      };
    }

    this.assertEvaluatorProvider(req.evaluatorProviderId);

    const now = Date.now();
    const objective = req.objective.trim();
    const workspace = this.requireWorkspace(req.workspaceId);
    const supervisorId = generateSupervisorId();
    const supervisor = this.attachCycles(
      this.deps.supervisorRepo.create({
        id: supervisorId,
        sessionId: req.sessionId,
        workspaceId: req.workspaceId,
        state: "idle",
        objective,
        evaluatorProviderId: req.evaluatorProviderId,
        evaluatorModel: req.evaluatorModel?.trim() || undefined,
        maxSupervisionCount: req.maxSupervisionCount ?? 0,
        completedSupervisionCount: 0,
        scheduledAt: req.scheduledAt,
        createdAt: now,
        updatedAt: now,
      })
    );
    let enriched: Supervisor;
    try {
      await this.deps.targetStore.createTargetFiles(workspace.path, {
        targetId: supervisorId,
        sessionId: req.sessionId,
        workspaceId: req.workspaceId,
        objective,
        createdAt: now,
      });

      enriched = await this.attachTargetState(supervisor, workspace.path);
    } catch (error) {
      this.deps.supervisorRepo.delete(supervisor.id);
      throw error;
    }

    this.storeSnapshot(enriched);
    this.broadcastState(enriched, "created");
    this.scheduler.refresh();
    return enriched;
  }

  async update(id: string, patch: UpdateSupervisorRequest): Promise<Supervisor> {
    let current = this.requireSupervisor(id);

    if (patch.evaluatorProviderId) {
      this.assertEvaluatorProvider(patch.evaluatorProviderId);
    }

    const nextObjective =
      patch.objective !== undefined ? patch.objective.trim() : current.objective;
    const objectiveChanged = patch.objective !== undefined && nextObjective !== current.objective;

    if (objectiveChanged && this.inFlight.has(id)) {
      this.pendingObjectiveUpdates.add(id);
      this.evaluationAbortControllers.get(id)?.abort();
      await this.inFlightCompletions.get(id)?.promise;
      current = this.requireSupervisor(id);
    }

    const workspace = this.requireWorkspace(current.workspaceId);
    const nextPatch: Parameters<SupervisorRepo["update"]>[1] = {
      objective: nextObjective,
      evaluatorProviderId: patch.evaluatorProviderId ?? current.evaluatorProviderId,
      evaluatorModel:
        patch.evaluatorModel === undefined
          ? current.evaluatorModel
          : patch.evaluatorModel?.trim() || null,
      maxSupervisionCount: patch.maxSupervisionCount ?? current.maxSupervisionCount,
      scheduledAt: patch.scheduledAt === undefined ? current.scheduledAt : patch.scheduledAt,
      state: objectiveChanged
        ? current.state === "paused"
          ? "paused"
          : "idle"
        : current.state === "error"
          ? "idle"
          : current.state,
      stopReason: objectiveChanged ? null : current.stopReason,
      completedSupervisionCount: objectiveChanged ? 0 : current.completedSupervisionCount,
      lastEvaluatedTurnId: objectiveChanged ? null : current.lastEvaluatedTurnId,
      errorReason: null,
      updatedAt: Date.now(),
    };

    const rollbackPatch = this.toSupervisorUpdatePatch(current, Date.now());
    this.deps.supervisorRepo.update(id, nextPatch);

    if (objectiveChanged) {
      try {
        await this.deps.targetStore.resetTargetFiles(workspace.path, {
          targetId: current.targetId,
          sessionId: current.sessionId,
          workspaceId: current.workspaceId,
          objective: nextObjective,
          createdAt: nextPatch.updatedAt ?? Date.now(),
        });
      } catch (error) {
        try {
          this.deps.supervisorRepo.update(id, rollbackPatch);
        } catch (rollbackError) {
          this.logger.error(
            { err: rollbackError, supervisorId: id },
            "Failed to roll back supervisor after target reset failure"
          );
        }
        throw error;
      }
    }

    const enriched = await this.hydratePersistedSupervisor(id, workspace.path);
    if (!enriched) {
      await this.markTargetCancelledIfActive(workspace.path, current).catch(() => {});
      throw this.supervisorNotFoundError(id);
    }

    this.storeSnapshot(enriched);
    this.broadcastState(enriched, "updated");
    this.scheduler.refresh();
    return enriched;
  }

  async pause(id: string): Promise<Supervisor> {
    if (this.inFlight.has(id)) {
      this.pendingPauses.add(id);
      this.evaluationAbortControllers.get(id)?.abort();
    }

    const updated = this.attachCycles(
      this.withCurrentTargetState(
        this.deps.supervisorRepo.update(id, {
          state: "paused",
          updatedAt: Date.now(),
        })
      )
    );

    this.storeSnapshot(updated);
    this.broadcastState(updated, "state_changed");
    this.scheduler.refresh();
    return updated;
  }

  async resume(id: string): Promise<Supervisor> {
    const updated = this.attachCycles(
      this.withCurrentTargetState(
        this.deps.supervisorRepo.update(id, {
          state: "idle",
          errorReason: null,
          updatedAt: Date.now(),
        })
      )
    );

    this.storeSnapshot(updated);
    this.broadcastState(updated, "state_changed");
    this.scheduler.refresh();
    return updated;
  }

  async delete(id: string): Promise<void> {
    const supervisor = this.requireSupervisor(id);

    if (this.inFlight.has(id)) {
      this.pendingDeletes.add(id);
      this.evaluationAbortControllers.get(id)?.abort();
      await this.inFlightCompletions.get(id)?.promise;
      this.scheduler.refresh();
      return;
    }

    this.deleteNow(supervisor);
  }

  /**
   * Start a manual evaluation cycle and return as soon as the cycle is
   * created. The heavy evaluator+injector work continues in the background
   * and broadcasts cycle/state updates as it progresses.
   *
   * This is what the WS `supervisor.trigger` command calls, so the web
   * client never has to wait for the (potentially slow) evaluator to finish.
   */
  async triggerEvaluation(id: string): Promise<SupervisorCycle> {
    const started = await this.beginCycle(id, "manual");
    if (!started) {
      throw {
        code: "supervisor_internal_error",
        message: `Supervisor ${id} could not start an evaluation cycle`,
      };
    }

    // Fire-and-forget the rest of the evaluation. Errors are surfaced via
    // broadcasts (cycle → failed, state → error).
    void this.finishCycle(started).catch((error) => {
      this.logger.warn(
        { err: error, supervisorId: id, cycleId: started.cycle.id },
        "Supervisor manual evaluation failed"
      );
    });

    return started.cycle;
  }

  /**
   * Run a supervisor evaluation synchronously end-to-end. Used for the
   * auto trigger path (scheduler) and for tests that want to observe the
   * final cycle outcome.
   */
  async runEvaluation(
    supervisorId: string,
    trigger: "turn_completed" | "scheduled" = "turn_completed"
  ): Promise<SupervisorCycle | null> {
    const started = await this.beginCycle(supervisorId, trigger);
    if (!started) {
      return null;
    }
    return await this.finishCycle(started);
  }

  /**
   * Synchronous portion of an evaluation cycle: validates preconditions,
   * builds evaluator context, flips state → 'evaluating', creates an
   * in-flight cycle row, and broadcasts both.
   *
   * Returns `null` when auto triggers should be skipped silently
   * (duplicate turnId, wrong state, ...). Throws for manual trigger
   * preconditions the user needs to know about (paused, busy, missing
   * session). Always releases `inFlight` if we bail out before handing
   * off to {@link finishCycle}.
   */
  private async beginCycle(
    id: string,
    trigger: "turn_completed" | "manual" | "scheduled"
  ): Promise<StartedCycle | null> {
    const supervisor = this.requireSupervisor(id);
    const session = this.deps.sessionMgr.get(supervisor.sessionId);

    if (!session) {
      throw {
        code: "supervisor_not_found",
        message: `Session ${supervisor.sessionId} not found`,
      };
    }

    if (this.inFlight.has(id)) {
      if (trigger === "manual") {
        throw {
          code: "supervisor_busy",
          message: `Supervisor ${id} is already evaluating`,
        };
      }
      return null;
    }

    if (supervisor.state === "paused") {
      if (trigger === "manual") {
        throw {
          code: "supervisor_paused",
          message: `Supervisor ${id} is paused`,
        };
      }
      return null;
    }

    if (supervisor.state === "stopped") {
      if (trigger === "manual") {
        throw {
          code: "supervisor_stopped",
          message: `Supervisor ${id} is stopped`,
        };
      }
      return null;
    }

    if (
      (trigger === "turn_completed" || trigger === "scheduled") &&
      (supervisor.state !== "idle" || (session.state !== "running" && session.state !== "idle"))
    ) {
      return null;
    }

    if (
      supervisor.maxSupervisionCount > 0 &&
      supervisor.completedSupervisionCount >= supervisor.maxSupervisionCount
    ) {
      const stopped = this.attachCycles(
        this.deps.supervisorRepo.update(id, {
          state: "stopped",
          stopReason: "max_supervision_count_reached",
          updatedAt: Date.now(),
        })
      );
      this.storeSnapshot(stopped);
      this.broadcastState(stopped, "state_changed");
      this.scheduler.refresh();
      return null;
    }

    // If scheduled execution is set but the scheduled time has not arrived yet,
    // skip turn_completed triggers. Only after the scheduled time passes will
    // turn_completed triggers proceed with evaluation.
    if (trigger === "turn_completed") {
      if (
        supervisor.scheduledAt !== undefined &&
        supervisor.scheduledAt !== null &&
        supervisor.scheduledAt > Date.now()
      ) {
        return null;
      }
    }

    if (trigger === "scheduled") {
      if (supervisor.scheduledAt === undefined || supervisor.scheduledAt > Date.now()) {
        return null;
      }
    }

    // Manual trigger: fail fast if the session can't receive injection yet.
    // Without this guard we would burn an evaluator turn only to have the
    // injector reject the session right after (e.g. Codex sessions stuck in
    // 'starting' because the provider hasn't reported TurnCompleted).
    if (trigger === "manual" && !INJECTABLE_SESSION_STATES.has(session.state)) {
      throw {
        code: "supervisor_session_not_ready",
        message: `Supervisor ${id} cannot evaluate now: ${describeNonInjectableState(session.state)}`,
      };
    }

    this.inFlight.add(id);
    this.evaluationAbortControllers.set(id, new AbortController());
    this.inFlightCompletions.set(id, createDeferredCompletion());

    try {
      const retrySettings = getSupervisorRetrySettings(this.deps.settingsRepo);
      const workspace = this.requireWorkspace(supervisor.workspaceId);
      const hydratedSupervisor = await this.attachTargetState(supervisor, workspace.path);
      const targetMemory = hydratedSupervisor.currentTargetMemory;
      if (!targetMemory) {
        throw new Error(`Missing target memory for supervisor ${supervisor.id}`);
      }
      const context = await this.contextBuilder.build(hydratedSupervisor, targetMemory);
      if (
        trigger === "turn_completed" &&
        context.lastTurnId &&
        context.lastTurnId === supervisor.lastEvaluatedTurnId
      ) {
        this.releaseInFlight(id);
        return null;
      }

      const shouldConsumeScheduledAt =
        trigger === "scheduled" ||
        (trigger === "turn_completed" &&
          supervisor.scheduledAt !== undefined &&
          supervisor.scheduledAt !== null &&
          supervisor.scheduledAt <= Date.now());

      const evaluatingSupervisor = this.attachCycles(
        this.withCurrentTargetState(
          this.deps.supervisorRepo.update(supervisor.id, {
            state: "evaluating",
            scheduledAt: shouldConsumeScheduledAt ? null : (supervisor.scheduledAt ?? undefined),
            stopReason: null,
            errorReason: null,
            updatedAt: Date.now(),
          })
        )
      );
      this.storeSnapshot(evaluatingSupervisor);
      this.broadcastState(evaluatingSupervisor, "state_changed");
      this.scheduler.refresh();

      const activeCycle = this.deps.cycleRepo.create({
        id: generateCycleId(),
        supervisorId: supervisor.id,
        sessionId: supervisor.sessionId,
        status: "evaluating",
        trigger,
        evidenceSource: context.evidenceSource,
        objective: supervisor.objective,
        evaluatorProviderId: supervisor.evaluatorProviderId,
        turnId: context.lastTurnId,
        createdAt: Date.now(),
      });
      this.broadcastCycle(evaluatingSupervisor, activeCycle, "created", {
        phase: "waiting_evaluator",
        currentAttemptIndex: 0,
        attemptCount: 1,
        maxAttempts: 1 + retrySettings.retryMaxCount,
      });

      return {
        cycle: activeCycle,
        supervisor: hydratedSupervisor,
        context,
        targetId: hydratedSupervisor.targetId,
        trigger,
        retry: {
          retryEnabled: retrySettings.retryEnabled,
          retryMaxCount: retrySettings.retryMaxCount,
          retryDelayMs: retrySettings.retryDelaySec * 1000,
          retryOnTimeout: retrySettings.retryOnTimeout,
          retryOnEvaluatorError: retrySettings.retryOnEvaluatorError,
        },
      };
    } catch (error: unknown) {
      // Error happened BEFORE we created a cycle (usually contextBuilder or
      // the state→evaluating write). Make sure we don't leave the
      // supervisor stuck and release inFlight ourselves.
      this.releaseInFlight(id);
      this.markSupervisorError(id, error);
      throw error;
    }
  }

  /**
   * Asynchronous portion of an evaluation cycle: runs the evaluator, optionally
   * injects guidance, persists the final cycle outcome, and flips state back
   * to 'idle' (or 'error'/'paused'). Always releases `inFlight`.
   */
  private async finishCycle(started: StartedCycle): Promise<SupervisorCycle> {
    const { cycle: activeCycle, context, targetId } = started;
    const supervisorId = activeCycle.supervisorId;

    try {
      const signal = this.evaluationAbortControllers.get(supervisorId)?.signal;
      const evaluation = await this.executeCycleWithRetry(started, signal);
      const finalized = await this.finalizeSuccessfulCycle(
        activeCycle,
        context,
        evaluation,
        targetId
      );

      if (this.pendingDeletes.has(supervisorId)) {
        this.pendingDeletes.delete(supervisorId);
        this.deleteNow(finalized.supervisor);
      }

      return finalized.cycle;
    } catch (error: unknown) {
      if (isSupervisorEvalAborted(error)) {
        const cancelled = this.isCancellationRequested(supervisorId);
        const abortedCycle = this.deps.cycleRepo.update(activeCycle.id, {
          status: cancelled ? "cancelled" : "failed",
          errorReason: cancelled ? null : messageOf(error, "Supervisor evaluator aborted"),
          completedAt: Date.now(),
        });

        const currentSupervisor =
          this.supervisors.get(supervisorId) ?? this.requireSupervisor(supervisorId);

        if (this.pendingDeletes.has(supervisorId)) {
          const workspace = this.deps.workspaceMgr.get(currentSupervisor.workspaceId);
          if (workspace) {
            await this.writeErrorTargetCycleRecord(
              workspace.path,
              targetId,
              activeCycle,
              abortedCycle.errorReason ?? "Supervisor evaluator aborted"
            );
            await this.markTargetCancelledIfActive(workspace.path, currentSupervisor);
          }
          this.broadcastCycle(currentSupervisor, abortedCycle, "updated");
          this.pendingDeletes.delete(supervisorId);
          this.deleteNow(currentSupervisor);
          return abortedCycle;
        }

        if (this.pendingObjectiveUpdates.has(supervisorId)) {
          const nextState: SupervisorState = this.pendingPauses.has(supervisorId)
            ? "paused"
            : "idle";
          const recoveredSupervisor = this.attachCycles(
            this.deps.supervisorRepo.update(supervisorId, {
              state: nextState,
              stopReason: null,
              errorReason: null,
              updatedAt: Date.now(),
            })
          );

          this.storeSnapshot(recoveredSupervisor);
          this.broadcastCycle(recoveredSupervisor, abortedCycle, "updated");
          this.broadcastState(recoveredSupervisor, "state_changed");
          this.deps.cycleRepo.pruneOldest(supervisorId, this.config.maxCyclesPerSession);
          this.scheduler.refresh();

          return abortedCycle;
        }

        if (currentSupervisor.targetId !== targetId) {
          const workspace = this.deps.workspaceMgr.get(currentSupervisor.workspaceId);
          const enriched = this.attachCycles(
            workspace
              ? await this.attachTargetState(currentSupervisor, workspace.path)
              : currentSupervisor
          );
          if (workspace && abortedCycle.status === "failed") {
            await this.writeErrorTargetCycleRecord(
              workspace.path,
              targetId,
              activeCycle,
              abortedCycle.errorReason ?? "Supervisor evaluator aborted"
            );
          }
          this.storeSnapshot(enriched);
          this.broadcastCycle(enriched, abortedCycle, "updated");
          this.deps.cycleRepo.pruneOldest(supervisorId, this.config.maxCyclesPerSession);
          this.scheduler.refresh();
          this.pendingPauses.delete(supervisorId);
          return abortedCycle;
        }

        const latestState = this.supervisors.get(supervisorId)?.state;
        const nextState: SupervisorState =
          cancelled || latestState === "paused" ? "paused" : "idle";
        const recoveredSupervisor = this.attachCycles(
          this.deps.supervisorRepo.update(supervisorId, {
            state: nextState,
            stopReason: null,
            errorReason: null,
            updatedAt: Date.now(),
          })
        );

        this.storeSnapshot(recoveredSupervisor);
        const workspace = this.deps.workspaceMgr.get(recoveredSupervisor.workspaceId);
        if (workspace && abortedCycle.status === "failed") {
          await this.writeErrorTargetCycleRecord(
            workspace.path,
            targetId,
            activeCycle,
            abortedCycle.errorReason ?? "Supervisor evaluator aborted"
          );
        }
        this.broadcastCycle(recoveredSupervisor, abortedCycle, "updated");
        this.broadcastState(recoveredSupervisor, "state_changed");
        this.deps.cycleRepo.pruneOldest(supervisorId, this.config.maxCyclesPerSession);
        this.scheduler.refresh();
        this.pendingPauses.delete(supervisorId);

        return abortedCycle;
      }

      logFailure(
        this.logger,
        error,
        { supervisorId, cycleId: activeCycle.id },
        "Supervisor evaluation failed"
      );
      const reason = messageOf(error, "Supervisor evaluation failed");
      const failedCycle = this.deps.cycleRepo.update(activeCycle.id, {
        status: "failed",
        errorReason: reason,
        completedAt: Date.now(),
      });
      const currentSupervisor =
        this.supervisors.get(supervisorId) ?? this.requireSupervisor(supervisorId);
      const workspace = this.deps.workspaceMgr.get(currentSupervisor.workspaceId);
      if (currentSupervisor.targetId !== targetId) {
        const enriched = this.attachCycles(
          workspace
            ? await this.attachTargetState(currentSupervisor, workspace.path)
            : currentSupervisor
        );
        if (workspace) {
          await this.writeErrorTargetCycleRecord(
            workspace.path,
            targetId,
            activeCycle,
            failedCycle.errorReason ?? reason
          );
        }
        this.storeSnapshot(enriched);
        this.broadcastCycle(enriched, failedCycle, "updated");

        if (this.pendingDeletes.has(supervisorId)) {
          this.pendingDeletes.delete(supervisorId);
          this.deleteNow(enriched);
        }

        throw error;
      }

      const failedSupervisor = this.attachCycles(
        this.deps.supervisorRepo.update(supervisorId, {
          state: "error",
          stopReason: null,
          errorReason: reason,
          updatedAt: Date.now(),
        })
      );

      this.storeSnapshot(failedSupervisor);
      if (workspace) {
        await this.writeErrorTargetCycleRecord(
          workspace.path,
          targetId,
          activeCycle,
          failedCycle.errorReason ?? reason
        );
      }
      this.broadcastCycle(failedSupervisor, failedCycle, "updated");
      this.broadcastState(failedSupervisor, "state_changed");

      if (this.pendingDeletes.has(supervisorId)) {
        this.pendingDeletes.delete(supervisorId);
        this.deleteNow(failedSupervisor);
      }

      throw error;
    } finally {
      this.pendingObjectiveUpdates.delete(supervisorId);
      this.pendingPauses.delete(supervisorId);
      this.releaseInFlight(supervisorId);
    }
  }

  private async executeCycleWithRetry(
    started: StartedCycle,
    signal?: AbortSignal
  ): Promise<CompletedCycleEvaluation> {
    const supervisor = started.supervisor;
    let context = started.context;
    let currentMemory = context.targetMemory;

    for (let attemptIndex = 0; ; attemptIndex += 1) {
      const attempt = this.deps.cycleAttemptRepo.create({
        id: generateAttemptId(),
        cycleId: started.cycle.id,
        attemptIndex,
        status: "evaluating",
        startedAt: Date.now(),
      });
      this.broadcastCycle(started.supervisor, started.cycle, "updated", {
        phase: "waiting_evaluator",
        currentAttemptIndex: attemptIndex,
        attemptCount: attemptIndex + 1,
        maxAttempts: 1 + started.retry.retryMaxCount,
      });

      try {
        if (!currentMemory.decompositionGenerated || currentMemory.items.length === 0) {
          const decomposition = await this.evaluator.evaluate(supervisor, context, {
            signal,
            mode: "decompose",
          });
          if (!isDecomposeResult(decomposition)) {
            throw new Error("Supervisor decompose pass did not return a decomposition result");
          }

          currentMemory = {
            ...currentMemory,
            decompositionGenerated: true,
            decompositionMode: decomposition.decompositionMode,
            items: decomposition.items,
            activeItemId: decomposition.activeItemId,
            progressSummary: decomposition.progressSummary ?? currentMemory.progressSummary,
            updatedAt: Date.now(),
          };

          const workspace = this.requireWorkspace(context.workspaceId);
          await this.deps.targetStore.saveTargetMemory(
            workspace.path,
            started.targetId,
            currentMemory
          );

          const currentSupervisor =
            this.supervisors.get(supervisor.id) ?? this.requireSupervisor(supervisor.id);
          if (currentSupervisor.targetId === started.targetId) {
            const refreshed = this.attachCycles({
              ...currentSupervisor,
              currentTargetMemory: currentMemory,
            });
            this.storeSnapshot(refreshed);
          }

          context = {
            ...context,
            targetMemory: currentMemory,
          };
        }

        const evaluation = await this.evaluator.evaluate(supervisor, context, {
          signal,
          mode: "evaluate",
        });
        this.deps.cycleAttemptRepo.update(attempt.id, {
          status: "completed",
          completedAt: Date.now(),
          providerModel: supervisor.evaluatorModel ?? null,
        });

        if (isDecomposeResult(evaluation)) {
          throw new Error("Supervisor evaluate pass returned a decompose result");
        }

        const nextTargetMemory = this.applyEvaluationToTargetMemory(
          currentMemory,
          evaluation,
          undefined,
          Date.now()
        );

        if (isEvaluateStopResult(evaluation)) {
          return {
            evaluation,
            injected: false,
            targetMemory: nextTargetMemory,
          };
        }

        if (!evaluation.guidance?.trim()) {
          return {
            evaluation,
            injected: false,
            targetMemory: nextTargetMemory,
          };
        }

        if (signal?.aborted || this.pendingPauses.has(supervisor.id)) {
          throw { code: "supervisor_eval_aborted", message: "Supervisor evaluator aborted" };
        }

        const currentSupervisor =
          this.supervisors.get(supervisor.id) ?? this.requireSupervisor(supervisor.id);
        if (currentSupervisor.targetId !== started.targetId) {
          return {
            evaluation,
            injected: false,
            targetMemory: nextTargetMemory,
          };
        }

        const injectingSupervisor = this.attachCycles(
          this.withCurrentTargetState(
            this.deps.supervisorRepo.update(supervisor.id, {
              state: "injecting",
              updatedAt: Date.now(),
            })
          )
        );
        this.storeSnapshot(injectingSupervisor);
        this.broadcastState(injectingSupervisor, "state_changed");
        this.broadcastCycle(injectingSupervisor, started.cycle, "updated", {
          phase: "injecting",
          currentAttemptIndex: attemptIndex,
          attemptCount: attemptIndex + 1,
          maxAttempts: 1 + started.retry.retryMaxCount,
        });

        const recentCycles = this.deps.cycleRepo
          .listRecentForSupervisor(supervisor.id, this.config.guidanceDedupeWindow + 1)
          .filter((cycle) => cycle.id !== started.cycle.id);

        const injection = await this.injector.inject(
          injectingSupervisor,
          {
            message: evaluation.guidance,
          },
          recentCycles,
          { signal }
        );

        return {
          evaluation,
          injected: injection.injected,
          injectedText: injection.injected ? injection.text : undefined,
          targetMemory: this.applyEvaluationToTargetMemory(
            currentMemory,
            evaluation,
            injection.injected ? injection.text : undefined,
            Date.now()
          ),
        };
      } catch (error) {
        if (isSupervisorEvalAborted(error)) {
          const cancelled = this.isCancellationRequested(supervisor.id);
          this.deps.cycleAttemptRepo.update(attempt.id, {
            status: cancelled ? "cancelled" : "failed",
            completedAt: Date.now(),
            errorReason: cancelled ? null : messageOf(error, "Supervisor evaluator aborted"),
          });
          throw error;
        }

        const reason = messageOf(error, "Supervisor evaluation failed");
        this.deps.cycleAttemptRepo.update(attempt.id, {
          status: "failed",
          completedAt: Date.now(),
          errorReason: reason,
        });

        if (!this.shouldRetryAttempt(error, attemptIndex, started.retry)) {
          throw error;
        }

        const nextRetryAt = Date.now() + started.retry.retryDelayMs;
        this.broadcastCycle(supervisor, started.cycle, "updated", {
          phase: "retry_wait",
          currentAttemptIndex: attemptIndex,
          attemptCount: attemptIndex + 1,
          maxAttempts: 1 + started.retry.retryMaxCount,
          lastAttemptError: reason,
          nextRetryAt,
        });

        await this.sleep(started.retry.retryDelayMs, signal);

        const evaluatingSupervisor = this.attachCycles(
          this.withCurrentTargetState(
            this.deps.supervisorRepo.update(supervisor.id, {
              state: "evaluating",
              updatedAt: Date.now(),
            })
          )
        );
        this.storeSnapshot(evaluatingSupervisor);
        this.broadcastState(evaluatingSupervisor, "state_changed");
      }
    }
  }

  private async finalizeSuccessfulCycle(
    activeCycle: SupervisorCycle,
    context: SupervisorEvaluationContext,
    result: CompletedCycleEvaluation,
    targetId: string
  ): Promise<{ cycle: SupervisorCycle; supervisor: Supervisor }> {
    const workspace = this.requireWorkspace(context.workspaceId);
    const currentSupervisor =
      this.supervisors.get(activeCycle.supervisorId) ??
      this.requireSupervisor(activeCycle.supervisorId);
    const evaluation = result.evaluation;
    const finalStatus: CycleStatus = result.injected ? "injected" : "completed";
    const cycleReason = isEvaluateStopResult(evaluation)
      ? evaluation.reason
      : result.injected
        ? result.injectedText
        : evaluation.guidance
          ? `Skipped duplicate: ${evaluation.guidance}`
          : undefined;

    const finishedCycle = this.deps.cycleRepo.update(activeCycle.id, {
      status: finalStatus,
      result: cycleReason ?? null,
      injectedGuidance: result.injectedText ?? null,
      errorReason: null,
      completedAt: Date.now(),
    });

    const nextTargetMemory = {
      ...result.targetMemory,
      updatedAt: finishedCycle.completedAt ?? Date.now(),
    };
    await this.deps.targetStore.saveTargetMemory(workspace.path, targetId, nextTargetMemory);

    const cycleRecord: SupervisorCycleTargetRecord = isEvaluateStopResult(evaluation)
      ? {
          cycleId: activeCycle.id,
          targetId,
          startedAt: activeCycle.createdAt,
          completedAt: finishedCycle.completedAt ?? Date.now(),
          result: "stop",
          stopReason: evaluation.stopReason,
          reason: evaluation.reason,
          progressSummary: nextTargetMemory.progressSummary,
          decompositionMode: nextTargetMemory.decompositionMode,
          activeItemId: nextTargetMemory.activeItemId,
          injected: false,
          attemptCount: this.deps.cycleAttemptRepo.listForCycle(activeCycle.id).length,
        }
      : {
          cycleId: activeCycle.id,
          targetId,
          startedAt: activeCycle.createdAt,
          completedAt: finishedCycle.completedAt ?? Date.now(),
          result: "continue",
          reason: evaluation.reason,
          guidance: result.injected ? result.injectedText : evaluation.guidance,
          progressSummary: nextTargetMemory.progressSummary,
          decompositionMode: nextTargetMemory.decompositionMode,
          activeItemId: nextTargetMemory.activeItemId,
          itemUpdates: evaluation.itemUpdates,
          injected: result.injected,
          attemptCount: this.deps.cycleAttemptRepo.listForCycle(activeCycle.id).length,
        };
    await this.deps.targetStore.appendTargetCycleRecord(workspace.path, targetId, cycleRecord);

    if (isEvaluateStopResult(evaluation)) {
      await this.updateTargetMetaStatus(workspace.path, targetId, {
        status: evaluation.stopReason === "objective_complete" ? "completed" : "cancelled",
        completedAt: finishedCycle.completedAt ?? Date.now(),
      });
    }

    if (currentSupervisor.targetId !== targetId) {
      const enriched = this.attachCycles(
        await this.attachTargetState(currentSupervisor, workspace.path)
      );
      this.storeSnapshot(enriched);
      this.broadcastCycle(enriched, finishedCycle, "updated");
      this.deps.cycleRepo.pruneOldest(activeCycle.supervisorId, this.config.maxCyclesPerSession);
      this.scheduler.refresh();
      return { cycle: finishedCycle, supervisor: enriched };
    }

    const finishedSupervisor = this.attachCycles(
      this.withCurrentTargetState(
        this.deps.supervisorRepo.update(activeCycle.supervisorId, {
          state: isEvaluateStopResult(result.evaluation) ? "stopped" : "idle",
          completedSupervisionCount:
            (this.supervisors.get(activeCycle.supervisorId)?.completedSupervisionCount ?? 0) + 1,
          stopReason: isEvaluateStopResult(evaluation) ? evaluation.stopReason : null,
          lastCycleAt: finishedCycle.completedAt,
          lastEvaluatedTurnId: context.lastTurnId ?? undefined,
          errorReason: null,
          updatedAt: Date.now(),
        })
      )
    );
    const enriched = await this.attachTargetState(finishedSupervisor, workspace.path);

    this.storeSnapshot(enriched);
    this.broadcastCycle(enriched, finishedCycle, "updated");
    this.broadcastState(enriched, "state_changed");
    this.deps.cycleRepo.pruneOldest(activeCycle.supervisorId, this.config.maxCyclesPerSession);
    this.scheduler.refresh();

    return { cycle: finishedCycle, supervisor: enriched };
  }

  /**
   * Flip a supervisor to 'error' state when something blows up before we
   * had a chance to create a cycle. Without this the supervisor can get
   * stuck in whatever state it happened to be in (usually 'evaluating').
   */
  private markSupervisorError(id: string, error: unknown): void {
    logFailure(
      this.logger,
      error,
      { supervisorId: id },
      "Supervisor evaluation failed before cycle creation"
    );
    const reason = messageOf(error, "Supervisor evaluation failed");
    try {
      const failed = this.attachCycles(
        this.deps.supervisorRepo.update(id, {
          state: "error",
          errorReason: reason,
          updatedAt: Date.now(),
        })
      );
      this.storeSnapshot(failed);
      this.broadcastState(failed, "state_changed");
    } catch (writeError) {
      this.logger.warn(
        { err: writeError, supervisorId: id },
        "Failed to persist supervisor error state"
      );
    }
  }

  private requireSessionProvider(providerId: string): ProviderDefinition {
    const provider = this.deps.providerRegistry.find((item) => item.id === providerId);
    if (!provider) {
      throw {
        code: "supervisor_unsupported_provider",
        message: `Provider ${providerId} is not registered`,
      };
    }
    return provider;
  }

  private supportsSupervisor(provider: ProviderDefinition): boolean {
    return provider.capability === "full";
  }

  private requireWorkspace(workspaceId: string): { id: string; path: string } {
    const workspace = this.deps.workspaceMgr.get(workspaceId);
    if (!workspace) {
      throw {
        code: "supervisor_not_found",
        message: `Workspace ${workspaceId} not found`,
      };
    }
    return workspace;
  }

  private async createLegacyTargetFilesIfMissing(
    workspacePath: string,
    supervisor: Supervisor
  ): Promise<void> {
    try {
      await this.deps.targetStore.readTargetMeta(workspacePath, supervisor.targetId);
    } catch (error) {
      if (
        !error ||
        typeof error !== "object" ||
        !("code" in error) ||
        (error as { code?: string }).code !== "ENOENT"
      ) {
        throw error;
      }
      await this.deps.targetStore.createTargetFiles(workspacePath, {
        targetId: supervisor.targetId,
        sessionId: supervisor.sessionId,
        workspaceId: supervisor.workspaceId,
        objective: supervisor.objective,
        createdAt: supervisor.createdAt,
      });
    }
  }

  private async attachTargetState(
    supervisor: Supervisor,
    workspacePath: string
  ): Promise<Supervisor> {
    await this.createLegacyTargetFilesIfMissing(workspacePath, supervisor);
    const [currentTargetMemory, recentTargetCycles] = await Promise.all([
      this.deps.targetStore.loadTargetMemory(workspacePath, supervisor.targetId),
      this.deps.targetStore.readTargetCycleRecords(workspacePath, supervisor.targetId, 20),
    ]);

    return {
      ...supervisor,
      currentTargetMemory,
      recentTargetCycles,
    };
  }

  private async hydrateTargetState(supervisor: Supervisor): Promise<Supervisor> {
    const workspace = this.deps.workspaceMgr.get(supervisor.workspaceId);
    if (!workspace) {
      return supervisor;
    }
    return await this.attachTargetState(supervisor, workspace.path);
  }

  private async hydratePersistedSupervisor(
    supervisorId: string,
    workspacePath: string
  ): Promise<Supervisor | null> {
    const persisted = this.deps.supervisorRepo.findById(supervisorId);
    if (!persisted) {
      return null;
    }

    const hydrated = await this.attachTargetState(this.attachCycles(persisted), workspacePath);
    const latest = this.deps.supervisorRepo.findById(supervisorId);
    if (!latest) {
      return null;
    }

    if (latest.targetId !== hydrated.targetId) {
      return await this.attachTargetState(this.attachCycles(latest), workspacePath);
    }

    return {
      ...this.attachCycles(latest),
      currentTargetMemory: hydrated.currentTargetMemory,
      recentTargetCycles: hydrated.recentTargetCycles,
    };
  }

  private withCurrentTargetState(supervisor: Supervisor): Supervisor {
    const current = this.supervisors.get(supervisor.id);
    if (!current || current.targetId !== supervisor.targetId) {
      return supervisor;
    }
    return {
      ...supervisor,
      currentTargetMemory: current.currentTargetMemory,
      recentTargetCycles: current.recentTargetCycles,
    };
  }

  private isCancellationRequested(supervisorId: string): boolean {
    return this.pendingPauses.has(supervisorId) || this.pendingObjectiveUpdates.has(supervisorId);
  }

  private toSupervisorUpdatePatch(
    supervisor: Supervisor,
    updatedAt: number
  ): Parameters<SupervisorRepo["update"]>[1] {
    return {
      state: supervisor.state,
      objective: supervisor.objective,
      evaluatorProviderId: supervisor.evaluatorProviderId,
      evaluatorModel: supervisor.evaluatorModel ?? null,
      maxSupervisionCount: supervisor.maxSupervisionCount,
      completedSupervisionCount: supervisor.completedSupervisionCount,
      scheduledAt: supervisor.scheduledAt ?? null,
      stopReason: supervisor.stopReason ?? null,
      lastCycleAt: supervisor.lastCycleAt ?? null,
      lastEvaluatedTurnId: supervisor.lastEvaluatedTurnId ?? null,
      errorReason: supervisor.errorReason ?? null,
      updatedAt,
    };
  }

  private applyEvaluationToTargetMemory(
    memory: SupervisorTargetMemory,
    evaluation: Awaited<ReturnType<SupervisorEvaluator["evaluate"]>>,
    injectedText: string | undefined,
    updatedAt: number
  ): SupervisorTargetMemory {
    if (isDecomposeResult(evaluation)) {
      return {
        ...memory,
        decompositionGenerated: true,
        decompositionMode: evaluation.decompositionMode,
        items: evaluation.items,
        activeItemId: evaluation.activeItemId,
        progressSummary: evaluation.progressSummary ?? memory.progressSummary,
        updatedAt,
      };
    }

    if (isEvaluateStopResult(evaluation)) {
      return {
        ...memory,
        decompositionGenerated: memory.decompositionGenerated,
        decompositionMode: memory.decompositionMode,
        items: memory.items,
        activeItemId: memory.activeItemId,
        progressSummary: memory.progressSummary,
        lastGuidance: memory.lastGuidance,
        stalledCount: 0,
        updatedAt,
      };
    }

    let items = memory.items;
    if (evaluation.itemUpdates?.length) {
      const updates = new Map(evaluation.itemUpdates.map((item) => [item.id, item.status]));
      items = memory.items.map((item) =>
        updates.has(item.id) ? { ...item, status: updates.get(item.id)! } : item
      );
    }

    const progressSummary = evaluation.progressSummary ?? memory.progressSummary;
    const lastGuidance = injectedText ?? evaluation.guidance ?? memory.lastGuidance;
    const stalledCount =
      !evaluation.progressSummary && !evaluation.itemUpdates?.length ? memory.stalledCount + 1 : 0;

    return {
      ...memory,
      decompositionGenerated: memory.decompositionGenerated,
      decompositionMode: memory.decompositionMode,
      items,
      activeItemId: evaluation.activeItemId ?? memory.activeItemId,
      progressSummary,
      lastGuidance,
      stalledCount,
      updatedAt,
    };
  }

  private async updateTargetMetaStatus(
    workspacePath: string,
    targetId: string,
    patch: Partial<Pick<SupervisorTargetMeta, "status" | "supersededBy" | "completedAt">>
  ): Promise<void> {
    const current = await this.deps.targetStore.readTargetMeta(workspacePath, targetId);
    const nextPatch =
      current.status === "superseded" && patch.status && patch.status !== "superseded"
        ? {
            ...patch,
            status: current.status,
            supersededBy: current.supersededBy,
          }
        : patch;
    await this.deps.targetStore.saveTargetMeta(workspacePath, targetId, {
      ...current,
      ...nextPatch,
      updatedAt: Date.now(),
    });
  }

  private async writeErrorTargetCycleRecord(
    workspacePath: string,
    targetId: string,
    cycle: SupervisorCycle,
    errorReason: string
  ): Promise<void> {
    await this.deps.targetStore.appendTargetCycleRecord(workspacePath, targetId, {
      cycleId: cycle.id,
      targetId,
      startedAt: cycle.createdAt,
      completedAt: Date.now(),
      result: "error",
      errorReason,
      attemptCount: this.deps.cycleAttemptRepo.listForCycle(cycle.id).length,
    });
  }

  private async markTargetCancelledIfActive(
    workspacePath: string,
    supervisor: Supervisor
  ): Promise<void> {
    const meta = await this.deps.targetStore
      .readTargetMeta(workspacePath, supervisor.targetId)
      .catch(() => null);
    if (!meta || meta.status === "completed" || meta.status === "superseded") {
      return;
    }
    await this.updateTargetMetaStatus(workspacePath, supervisor.targetId, {
      status: "cancelled",
      completedAt: meta.completedAt ?? Date.now(),
    });
  }

  private assertEvaluatorProvider(providerId: string): void {
    const provider = this.deps.providerRegistry.find((item) => item.id === providerId);
    if (!provider?.buildSupervisorEvalCommand) {
      throw {
        code: "supervisor_invalid_evaluator_provider",
        message: `Provider ${providerId} cannot evaluate supervisors`,
      };
    }
    const hasConfig = this.deps.providerConfigRepo.get(providerId) ?? provider.defaultConfig;
    if (!hasConfig) {
      throw {
        code: "missing_evaluator_config",
        message: `Missing config for evaluator provider ${providerId}`,
      };
    }
  }

  private attachCycles(supervisor: Supervisor): Supervisor {
    return {
      ...supervisor,
      cycles: this.deps.cycleRepo.listRecentForSupervisor(supervisor.id, 20),
    };
  }

  private listScheduledSupervisors(): Array<{ supervisorId: string; scheduledAt: number }> {
    return Array.from(this.supervisors.values())
      .filter(
        (supervisor) =>
          supervisor.state === "idle" &&
          typeof supervisor.scheduledAt === "number" &&
          Number.isFinite(supervisor.scheduledAt)
      )
      .map((supervisor) => ({
        supervisorId: supervisor.id,
        scheduledAt: supervisor.scheduledAt!,
      }));
  }

  private storeSnapshot(supervisor: Supervisor): void {
    this.supervisors.set(supervisor.id, supervisor);
    this.supervisorsBySession.set(supervisor.sessionId, supervisor.id);
  }

  private deleteNow(supervisor: Supervisor): void {
    const workspace = this.deps.workspaceMgr.get(supervisor.workspaceId);
    if (workspace) {
      void this.markTargetCancelledIfActive(workspace.path, supervisor).catch((error) => {
        this.logger.warn(
          { err: error, supervisorId: supervisor.id, targetId: supervisor.targetId },
          "Failed to mark target cancelled during supervisor delete"
        );
      });
    }
    this.deps.supervisorRepo.delete(supervisor.id);
    this.supervisors.delete(supervisor.id);
    this.supervisorsBySession.delete(supervisor.sessionId);
    this.pendingDeletes.delete(supervisor.id);
    this.pendingPauses.delete(supervisor.id);
    this.pendingObjectiveUpdates.delete(supervisor.id);
    this.releaseInFlight(supervisor.id);
    this.scheduler.refresh();

    this.deps.broadcaster.broadcast(
      Topics.supervisorState(supervisor.workspaceId, supervisor.sessionId),
      { supervisorId: supervisor.id, event: "deleted" }
    );
  }

  private releaseInFlight(supervisorId: string): void {
    this.inFlight.delete(supervisorId);
    this.evaluationAbortControllers.delete(supervisorId);
    this.inFlightCompletions.get(supervisorId)?.resolve();
    this.inFlightCompletions.delete(supervisorId);
  }

  private supervisorNotFoundError(id: string): { code: "supervisor_not_found"; message: string } {
    return {
      code: "supervisor_not_found",
      message: `Supervisor ${id} not found`,
    };
  }

  private requireSupervisor(id: string): Supervisor {
    const supervisor = this.supervisors.get(id);
    if (!supervisor) {
      throw this.supervisorNotFoundError(id);
    }
    return supervisor;
  }

  private broadcastState(
    supervisor: Supervisor,
    event: "created" | "updated" | "state_changed"
  ): void {
    this.deps.broadcaster.broadcast(
      Topics.supervisorState(supervisor.workspaceId, supervisor.sessionId),
      { supervisor, event }
    );
  }

  private broadcastCycle(
    supervisor: Supervisor,
    cycle: SupervisorCycle,
    event: "created" | "updated",
    runtime?: SupervisorCycleRuntimeSnapshot
  ): void {
    this.deps.broadcaster.broadcast(
      Topics.supervisorCycle(supervisor.workspaceId, supervisor.sessionId),
      { cycle: runtime ? { ...cycle, runtime } : cycle, event }
    );
  }

  private shouldRetryAttempt(
    error: unknown,
    attemptIndex: number,
    retry: SupervisorRetrySnapshot
  ): boolean {
    if (!retry.retryEnabled) {
      return false;
    }
    if (attemptIndex >= retry.retryMaxCount) {
      return false;
    }

    const code =
      error && typeof error === "object" && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;

    if (code === "supervisor_eval_timeout") {
      return retry.retryOnTimeout;
    }

    if (code === "supervisor_eval_failed") {
      return retry.retryOnEvaluatorError;
    }

    return false;
  }

  private async sleep(delayMs: number, signal?: AbortSignal): Promise<void> {
    if (delayMs <= 0) {
      return;
    }

    if (signal?.aborted) {
      throw { code: "supervisor_eval_aborted", message: "Supervisor evaluator aborted" };
    }

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, delayMs);
      timer.unref?.();

      const onAbort = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject({ code: "supervisor_eval_aborted", message: "Supervisor evaluator aborted" });
      };

      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}

function isSupervisorEvalAborted(error: unknown): error is {
  code: "supervisor_eval_aborted";
  message: string;
} {
  return (
    !!error &&
    typeof error === "object" &&
    (error as { code?: unknown }).code === "supervisor_eval_aborted"
  );
}
