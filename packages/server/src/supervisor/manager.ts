import type { FastifyBaseLogger } from 'fastify';
import {
  DEFAULT_SUPERVISOR_CONFIG,
  Topics,
  type CycleStatus,
  type DomainEvent,
  type ProviderDefinition,
  type Supervisor,
  type SupervisorConfig,
  type SupervisorCycle,
  type SupervisorState,
} from '@coder-studio/core';
import type { EventBus } from '../bus/event-bus.js';
import type { SessionManager } from '../session/manager.js';
import type { ProviderConfigRepo } from '../storage/repositories/provider-config-repo.js';
import type { SupervisorCycleRepo } from '../storage/repositories/supervisor-cycle-repo.js';
import type { SupervisorRepo } from '../storage/repositories/supervisor-repo.js';
import type { TerminalManager } from '../terminal/manager.js';
import type { Broadcaster } from '../ws/hub.js';
import type { WorkspaceManager } from '../workspace/manager.js';
import type { SupervisorEvaluationContext } from './context-builder.js';
import { SupervisorContextBuilder } from './context-builder.js';
import { SupervisorEvaluator } from './evaluator.js';
import {
  INJECTABLE_SESSION_STATES,
  SupervisorInjector,
  describeNonInjectableState,
} from './injector.js';
import { SupervisorScheduler } from './scheduler.js';

const NOOP_LOGGER: FastifyBaseLogger = {
  child: () => NOOP_LOGGER,
  debug: () => {},
  error: () => {},
  fatal: () => {},
  info: () => {},
  level: 'silent',
  silent: () => {},
  trace: () => {},
  warn: () => {},
};

type SessionLifecycleEvent = Extract<DomainEvent, { type: 'session.lifecycle' }>;

/**
 * Internal handoff between the synchronous `beginCycle` and the async
 * `finishCycle` phases of a supervisor evaluation.
 */
interface StartedCycle {
  cycle: SupervisorCycle;
  context: SupervisorEvaluationContext;
}

interface DeferredCompletion {
  promise: Promise<void>;
  resolve: () => void;
}

export interface SupervisorManagerDeps {
  eventBus: EventBus;
  broadcaster: Broadcaster;
  terminalMgr: TerminalManager;
  workspaceMgr: WorkspaceManager;
  sessionMgr: SessionManager;
  providerRegistry: ProviderDefinition[];
  providerConfigRepo: ProviderConfigRepo;
  supervisorRepo: SupervisorRepo;
  cycleRepo: SupervisorCycleRepo;
  logger?: FastifyBaseLogger;
  config?: SupervisorConfig;
}

export interface CreateSupervisorRequest {
  sessionId: string;
  workspaceId: string;
  objective: string;
  evaluatorProviderId: string;
}

export interface UpdateSupervisorRequest {
  objective?: string;
  evaluatorProviderId?: string;
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

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const value = (error as { message: unknown }).message;
    if (typeof value === 'string') {
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

export class SupervisorManager {
  private readonly supervisors = new Map<string, Supervisor>();
  private readonly supervisorsBySession = new Map<string, string>();
  private readonly inFlight = new Set<string>();
  private readonly pendingDeletes = new Set<string>();
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
          void this.runEvaluation(supervisorId).catch((error) => {
            this.logger.warn(
              { err: error, supervisorId },
              'Supervisor auto-evaluation failed'
            );
          });
        }
      },
    });
  }

  async hydrate(): Promise<void> {
    this.supervisors.clear();
    this.supervisorsBySession.clear();

    for (const supervisor of this.deps.supervisorRepo.listAll()) {
      const normalizedState =
        supervisor.state === 'evaluating' || supervisor.state === 'injecting'
          ? 'idle'
          : supervisor.state;

      const recovered =
        normalizedState === supervisor.state
          ? supervisor
          : this.deps.supervisorRepo.update(supervisor.id, {
              state: normalizedState,
              errorReason: null,
              updatedAt: Date.now(),
            });

      // Any cycle still in a transient state belongs to a previous server
      // process (or a long-fixed buggy code path). Mark it as failed so it
      // doesn't sit forever in the UI as "queued"/"evaluating".
      const stale = this.deps.cycleRepo
        .listRecentForSupervisor(supervisor.id, this.config.maxCyclesPerSession)
        .filter(
          (cycle) => cycle.status === 'queued' || cycle.status === 'evaluating'
        );
      for (const cycle of stale) {
        try {
          this.deps.cycleRepo.update(cycle.id, {
            status: 'failed',
            errorReason: 'Orphaned before server restart',
            completedAt: Date.now(),
          });
        } catch (error) {
          this.logger.warn(
            { err: error, cycleId: cycle.id, supervisorId: supervisor.id },
            'Failed to clean up stale cycle on hydrate'
          );
        }
      }

      this.storeSnapshot(this.attachCycles(recovered));
    }

    this.lifecycleUnsubscribe?.();
    this.lifecycleUnsubscribe = this.deps.eventBus.on(
      'session.lifecycle',
      (event: SessionLifecycleEvent) => {
        if (event.event !== 'removed') {
          return;
        }
        const supervisorId = this.supervisorsBySession.get(event.sessionId);
        if (supervisorId) {
          void this.delete(supervisorId).catch((error) => {
            this.logger.warn(
              { err: error, supervisorId },
              'Auto-delete on session removal failed'
            );
          });
        }
      }
    );

    this.scheduler.start();
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
        code: 'supervisor_not_found',
        message: `Session ${req.sessionId} not found`,
      };
    }
    if (session.state === 'draft') {
      throw {
        code: 'supervisor_unsupported_provider',
        message: 'Draft sessions cannot enable supervisor',
      };
    }
    const sessionProvider = this.requireSessionProvider(session.providerId);
    if (!this.supportsSupervisor(sessionProvider)) {
      throw {
        code: 'supervisor_unsupported_provider',
        message: `Provider ${session.providerId} does not support supervisor-driven sessions`,
      };
    }
    if (this.supervisorsBySession.has(req.sessionId)) {
      throw {
        code: 'supervisor_already_exists',
        message: `Supervisor already exists for ${req.sessionId}`,
      };
    }

    this.assertEvaluatorProvider(req.evaluatorProviderId);

    const now = Date.now();
    const supervisor = this.attachCycles(
      this.deps.supervisorRepo.create({
        id: generateSupervisorId(),
        sessionId: req.sessionId,
        workspaceId: req.workspaceId,
        state: 'idle',
        objective: req.objective.trim(),
        evaluatorProviderId: req.evaluatorProviderId,
        createdAt: now,
        updatedAt: now,
      })
    );

    this.storeSnapshot(supervisor);
    this.broadcastState(supervisor, 'created');
    return supervisor;
  }

  async update(id: string, patch: UpdateSupervisorRequest): Promise<Supervisor> {
    const current = this.requireSupervisor(id);

    if (patch.evaluatorProviderId) {
      this.assertEvaluatorProvider(patch.evaluatorProviderId);
    }

    const updated = this.attachCycles(
      this.deps.supervisorRepo.update(id, {
        objective:
          patch.objective !== undefined ? patch.objective.trim() : current.objective,
        evaluatorProviderId:
          patch.evaluatorProviderId ?? current.evaluatorProviderId,
        state: current.state === 'error' ? 'idle' : current.state,
        errorReason: null,
        updatedAt: Date.now(),
      })
    );

    this.storeSnapshot(updated);
    this.broadcastState(updated, 'updated');
    return updated;
  }

  async pause(id: string): Promise<Supervisor> {
    const updated = this.attachCycles(
      this.deps.supervisorRepo.update(id, {
        state: 'paused',
        updatedAt: Date.now(),
      })
    );

    this.storeSnapshot(updated);
    this.broadcastState(updated, 'state_changed');
    return updated;
  }

  async resume(id: string): Promise<Supervisor> {
    const updated = this.attachCycles(
      this.deps.supervisorRepo.update(id, {
        state: 'idle',
        errorReason: null,
        updatedAt: Date.now(),
      })
    );

    this.storeSnapshot(updated);
    this.broadcastState(updated, 'state_changed');
    return updated;
  }

  async delete(id: string): Promise<void> {
    const supervisor = this.requireSupervisor(id);

    if (this.inFlight.has(id)) {
      this.pendingDeletes.add(id);
      this.evaluationAbortControllers.get(id)?.abort();
      await this.inFlightCompletions.get(id)?.promise;
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
    const started = await this.beginCycle(id, 'manual');
    if (!started) {
      throw {
        code: 'supervisor_internal_error',
        message: `Supervisor ${id} could not start an evaluation cycle`,
      };
    }

    // Fire-and-forget the rest of the evaluation. Errors are surfaced via
    // broadcasts (cycle → failed, state → error).
    void this.finishCycle(started).catch((error) => {
      this.logger.warn(
        { err: error, supervisorId: id, cycleId: started.cycle.id },
        'Supervisor manual evaluation failed'
      );
    });

    return started.cycle;
  }

  /**
   * Run a supervisor evaluation synchronously end-to-end. Used for the
   * auto trigger path (scheduler) and for tests that want to observe the
   * final cycle outcome.
   */
  async runEvaluation(supervisorId: string): Promise<SupervisorCycle | null> {
    const started = await this.beginCycle(supervisorId, 'turn_completed');
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
    trigger: 'turn_completed' | 'manual'
  ): Promise<StartedCycle | null> {
    const supervisor = this.requireSupervisor(id);
    const session = this.deps.sessionMgr.get(supervisor.sessionId);

    if (!session) {
      throw {
        code: 'supervisor_not_found',
        message: `Session ${supervisor.sessionId} not found`,
      };
    }

    if (this.inFlight.has(id)) {
      if (trigger === 'manual') {
        throw {
          code: 'supervisor_busy',
          message: `Supervisor ${id} is already evaluating`,
        };
      }
      return null;
    }

    if (supervisor.state === 'paused') {
      if (trigger === 'manual') {
        throw {
          code: 'supervisor_paused',
          message: `Supervisor ${id} is paused`,
        };
      }
      return null;
    }

    if (
      trigger === 'turn_completed' &&
      (supervisor.state !== 'idle' ||
        (session.state !== 'running' && session.state !== 'idle'))
    ) {
      return null;
    }

    // Manual trigger: fail fast if the session can't receive injection yet.
    // Without this guard we would burn an evaluator turn only to have the
    // injector reject the session right after (e.g. Codex sessions stuck in
    // 'starting' because the provider hasn't reported TurnCompleted).
    if (trigger === 'manual' && !INJECTABLE_SESSION_STATES.has(session.state)) {
      throw {
        code: 'supervisor_session_not_ready',
        message: `Supervisor ${id} cannot evaluate now: ${describeNonInjectableState(session.state)}`,
      };
    }

    this.inFlight.add(id);
    this.evaluationAbortControllers.set(id, new AbortController());
    this.inFlightCompletions.set(id, createDeferredCompletion());

    try {
      const context = await this.contextBuilder.build(supervisor);
      if (
        trigger === 'turn_completed' &&
        context.lastTurnId &&
        context.lastTurnId === supervisor.lastEvaluatedTurnId
      ) {
        this.releaseInFlight(id);
        return null;
      }

      const evaluatingSupervisor = this.attachCycles(
        this.deps.supervisorRepo.update(supervisor.id, {
          state: 'evaluating',
          errorReason: null,
          updatedAt: Date.now(),
        })
      );
      this.storeSnapshot(evaluatingSupervisor);
      this.broadcastState(evaluatingSupervisor, 'state_changed');

      const activeCycle = this.deps.cycleRepo.create({
        id: generateCycleId(),
        supervisorId: supervisor.id,
        sessionId: supervisor.sessionId,
        status: 'evaluating',
        trigger,
        evidenceSource: context.evidenceSource,
        objective: supervisor.objective,
        evaluatorProviderId: supervisor.evaluatorProviderId,
        turnId: context.lastTurnId,
        createdAt: Date.now(),
      });
      this.broadcastCycle(evaluatingSupervisor, activeCycle, 'created');

      return { cycle: activeCycle, context };
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
    const { cycle: activeCycle, context } = started;
    const supervisorId = activeCycle.supervisorId;

    try {
      const supervisorForEval =
        this.supervisors.get(supervisorId) ?? this.requireSupervisor(supervisorId);

      const evaluation = await this.evaluator.evaluate(supervisorForEval, context, {
        signal: this.evaluationAbortControllers.get(supervisorId)?.signal,
      });

      let injected = false;
      let injectedText: string | undefined;
      let cycleResult: string | undefined;
      let injectionError: string | undefined;

      if (evaluation.message.trim()) {
        const injectingSupervisor = this.attachCycles(
          this.deps.supervisorRepo.update(supervisorId, {
            state: 'injecting',
            updatedAt: Date.now(),
          })
        );
        this.storeSnapshot(injectingSupervisor);
        this.broadcastState(injectingSupervisor, 'state_changed');

        // Fetch dedupeWindow + 1 so we can safely drop the in-flight cycle
        // (already persisted via cycleRepo.create above) before passing the
        // previous N cycles into the injector's dedupe check.
        const recentCycles = this.deps
          .cycleRepo
          .listRecentForSupervisor(
            supervisorId,
            this.config.guidanceDedupeWindow + 1
          )
          .filter((cycle) => cycle.id !== activeCycle.id);

        try {
          const injection = await this.injector.inject(
            injectingSupervisor,
            {
              message: evaluation.message,
            },
            recentCycles
          );
          injected = injection.injected;
          injectedText = injection.injected ? injection.text : undefined;
          cycleResult = injection.injected
            ? injection.text
            : `Skipped duplicate: ${injection.text}`;
        } catch (error) {
          // Injection failed (e.g. session gone away). Keep the evaluation
          // result but mark the cycle as failed instead of 'injected'.
          injectionError = messageOf(error, 'Injection failed');
          this.logger.warn(
            { err: error, supervisorId, cycleId: activeCycle.id },
            'Supervisor injection failed'
          );
        }
      }

      const finalStatus: CycleStatus = injectionError
        ? 'failed'
        : injected
          ? 'injected'
          : 'completed';

      const finishedCycle = this.deps.cycleRepo.update(activeCycle.id, {
        status: finalStatus,
        result: cycleResult ?? null,
        injectedGuidance: injectedText,
        errorReason: injectionError ?? null,
        completedAt: Date.now(),
      });

      const latestState = this.supervisors.get(supervisorId)?.state;
      const nextState: SupervisorState =
        latestState === 'paused'
          ? 'paused'
          : injectionError
            ? 'error'
            : 'idle';
      const finishedSupervisor = this.attachCycles(
        this.deps.supervisorRepo.update(supervisorId, {
          state: nextState,
          lastCycleAt: finishedCycle.completedAt,
          lastEvaluatedTurnId: context.lastTurnId ?? undefined,
          errorReason: injectionError ?? null,
          updatedAt: Date.now(),
        })
      );

      this.storeSnapshot(finishedSupervisor);
      this.broadcastCycle(finishedSupervisor, finishedCycle, 'updated');
      this.broadcastState(finishedSupervisor, 'state_changed');
      this.deps.cycleRepo.pruneOldest(
        supervisorId,
        this.config.maxCyclesPerSession
      );

      if (this.pendingDeletes.has(supervisorId)) {
        this.pendingDeletes.delete(supervisorId);
        this.deleteNow(finishedSupervisor);
      }

      return finishedCycle;
    } catch (error: unknown) {
      if (isSupervisorEvalAborted(error)) {
        const abortedCycle = this.deps.cycleRepo.update(activeCycle.id, {
          status: 'failed',
          errorReason: messageOf(error, 'Supervisor evaluator aborted'),
          completedAt: Date.now(),
        });

        const currentSupervisor =
          this.supervisors.get(supervisorId) ?? this.requireSupervisor(supervisorId);

        if (this.pendingDeletes.has(supervisorId)) {
          this.broadcastCycle(currentSupervisor, abortedCycle, 'updated');
          this.pendingDeletes.delete(supervisorId);
          this.deleteNow(currentSupervisor);
          return abortedCycle;
        }

        const latestState = this.supervisors.get(supervisorId)?.state;
        const nextState: SupervisorState =
          latestState === 'paused' ? 'paused' : 'idle';
        const recoveredSupervisor = this.attachCycles(
          this.deps.supervisorRepo.update(supervisorId, {
            state: nextState,
            errorReason: null,
            updatedAt: Date.now(),
          })
        );

        this.storeSnapshot(recoveredSupervisor);
        this.broadcastCycle(recoveredSupervisor, abortedCycle, 'updated');
        this.broadcastState(recoveredSupervisor, 'state_changed');
        this.deps.cycleRepo.pruneOldest(
          supervisorId,
          this.config.maxCyclesPerSession
        );

        return abortedCycle;
      }

      logFailure(
        this.logger,
        error,
        { supervisorId, cycleId: activeCycle.id },
        'Supervisor evaluation failed'
      );
      const reason = messageOf(error, 'Supervisor evaluation failed');
      const failedCycle = this.deps.cycleRepo.update(activeCycle.id, {
        status: 'failed',
        errorReason: reason,
        completedAt: Date.now(),
      });
      const failedSupervisor = this.attachCycles(
        this.deps.supervisorRepo.update(supervisorId, {
          state: 'error',
          errorReason: reason,
          updatedAt: Date.now(),
        })
      );

      this.storeSnapshot(failedSupervisor);
      this.broadcastCycle(failedSupervisor, failedCycle, 'updated');
      this.broadcastState(failedSupervisor, 'state_changed');

      if (this.pendingDeletes.has(supervisorId)) {
        this.pendingDeletes.delete(supervisorId);
        this.deleteNow(failedSupervisor);
      }

      throw error;
    } finally {
      this.releaseInFlight(supervisorId);
    }
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
      'Supervisor evaluation failed before cycle creation'
    );
    const reason = messageOf(error, 'Supervisor evaluation failed');
    try {
      const failed = this.attachCycles(
        this.deps.supervisorRepo.update(id, {
          state: 'error',
          errorReason: reason,
          updatedAt: Date.now(),
        })
      );
      this.storeSnapshot(failed);
      this.broadcastState(failed, 'state_changed');
    } catch (writeError) {
      this.logger.warn(
        { err: writeError, supervisorId: id },
        'Failed to persist supervisor error state'
      );
    }
  }

  private requireSessionProvider(providerId: string): ProviderDefinition {
    const provider = this.deps.providerRegistry.find((item) => item.id === providerId);
    if (!provider) {
      throw {
        code: 'supervisor_unsupported_provider',
        message: `Provider ${providerId} is not registered`,
      };
    }
    return provider;
  }

  private supportsSupervisor(provider: ProviderDefinition): boolean {
    return provider.capability === 'full';
  }

  private assertEvaluatorProvider(providerId: string): void {
    const provider = this.deps.providerRegistry.find((item) => item.id === providerId);
    if (!provider?.buildSupervisorEvalCommand) {
      throw {
        code: 'supervisor_invalid_evaluator_provider',
        message: `Provider ${providerId} cannot evaluate supervisors`,
      };
    }
    const hasConfig =
      this.deps.providerConfigRepo.get(providerId) ?? provider.defaultConfig;
    if (!hasConfig) {
      throw {
        code: 'missing_evaluator_config',
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

  private storeSnapshot(supervisor: Supervisor): void {
    this.supervisors.set(supervisor.id, supervisor);
    this.supervisorsBySession.set(supervisor.sessionId, supervisor.id);
  }

  private deleteNow(supervisor: Supervisor): void {
    this.deps.supervisorRepo.delete(supervisor.id);
    this.supervisors.delete(supervisor.id);
    this.supervisorsBySession.delete(supervisor.sessionId);
    this.pendingDeletes.delete(supervisor.id);
    this.releaseInFlight(supervisor.id);

    this.deps.broadcaster.broadcast(
      Topics.supervisorState(supervisor.workspaceId, supervisor.sessionId),
      { supervisorId: supervisor.id, event: 'deleted' }
    );
  }

  private releaseInFlight(supervisorId: string): void {
    this.inFlight.delete(supervisorId);
    this.evaluationAbortControllers.delete(supervisorId);
    this.inFlightCompletions.get(supervisorId)?.resolve();
    this.inFlightCompletions.delete(supervisorId);
  }

  private requireSupervisor(id: string): Supervisor {
    const supervisor = this.supervisors.get(id);
    if (!supervisor) {
      throw {
        code: 'supervisor_not_found',
        message: `Supervisor ${id} not found`,
      };
    }
    return supervisor;
  }

  private broadcastState(
    supervisor: Supervisor,
    event: 'created' | 'updated' | 'state_changed'
  ): void {
    this.deps.broadcaster.broadcast(
      Topics.supervisorState(supervisor.workspaceId, supervisor.sessionId),
      { supervisor, event }
    );
  }

  private broadcastCycle(
    supervisor: Supervisor,
    cycle: SupervisorCycle,
    event: 'created' | 'updated'
  ): void {
    this.deps.broadcaster.broadcast(
      Topics.supervisorCycle(supervisor.workspaceId, supervisor.sessionId),
      { cycle, event }
    );
  }
}

function isSupervisorEvalAborted(error: unknown): error is {
  code: 'supervisor_eval_aborted';
  message: string;
} {
  return !!error && typeof error === 'object' && (error as { code?: unknown }).code === 'supervisor_eval_aborted';
}
