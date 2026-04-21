/**
 * Supervisor Manager (Phase 3)
 *
 * Manages supervisor lifecycle, evaluation cycles, and guidance injection.
 */

import type {
  Supervisor,
  SupervisorCycle,
  SupervisorState,
  CycleStatus,
} from '@coder-studio/core';
import type { EventBus } from '../bus/event-bus.js';
import type { Broadcaster } from '../ws/hub.js';
import type { TerminalManager } from '../terminal/manager.js';
import { evaluateProgress } from './evaluator.js';
import { injectGuidance } from './injector.js';
import { SupervisorScheduler } from './scheduler.js';

const LEGACY_SUPERVISOR_INTERVAL_MS = 60000;

export interface SupervisorManagerDeps {
  eventBus: EventBus;
  broadcaster: Broadcaster;
  terminalMgr: TerminalManager;
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

/**
 * Generate unique supervisor ID
 */
function generateSupervisorId(): string {
  return `sup_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Generate unique cycle ID
 */
function generateCycleId(): string {
  return `cycle_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Supervisor Manager handles:
 * - Creating and deleting supervisors
 * - Managing supervisor state
 * - Creating and tracking evaluation cycles
 * - Broadcasting supervisor events
 */
export class SupervisorManager {
  private supervisors = new Map<string, Supervisor>();
  private supervisorsBySession = new Map<string, string>();
  private scheduler: SupervisorScheduler;

  constructor(private readonly deps: SupervisorManagerDeps) {
    this.scheduler = new SupervisorScheduler((supervisorId) => {
      this.runEvaluation(supervisorId).catch((err) => {
        console.error(`Scheduler evaluation failed for ${supervisorId}:`, err);
      });
    });
  }

  /**
   * Create a new supervisor for a session
   */
  async create(req: CreateSupervisorRequest): Promise<Supervisor> {
    const id = generateSupervisorId();
    const now = Date.now();

    const supervisor: Supervisor = {
      id,
      sessionId: req.sessionId,
      workspaceId: req.workspaceId,
      state: 'idle',
      objective: req.objective,
      evaluatorProviderId: req.evaluatorProviderId,
      cycles: [],
      createdAt: now,
      updatedAt: now,
    };

    this.supervisors.set(id, supervisor);
    this.supervisorsBySession.set(req.sessionId, id);

    // Preserve current MVP cadence internally without storing it on the domain object.
    this.scheduler.start(id, LEGACY_SUPERVISOR_INTERVAL_MS);

    // Broadcast supervisor creation
    this.deps.broadcaster.broadcast(
      `workspace.${req.workspaceId}.session.${req.sessionId}.supervisor.state`,
      { supervisor, event: 'created' }
    );

    return supervisor;
  }

  /**
   * Update supervisor objective or evaluator provider
   */
  async update(id: string, req: UpdateSupervisorRequest): Promise<Supervisor> {
    const supervisor = this.supervisors.get(id);
    if (!supervisor) {
      throw new Error(`Supervisor not found: ${id}`);
    }

    const updated: Supervisor = {
      ...supervisor,
      objective: req.objective ?? supervisor.objective,
      evaluatorProviderId:
        req.evaluatorProviderId ?? supervisor.evaluatorProviderId,
      updatedAt: Date.now(),
    };

    this.supervisors.set(id, updated);

    // Broadcast update
    this.deps.broadcaster.broadcast(
      `workspace.${updated.workspaceId}.session.${updated.sessionId}.supervisor.state`,
      { supervisor: updated, event: 'updated' }
    );

    return updated;
  }

  /**
   * Delete a supervisor
   */
  async delete(id: string): Promise<void> {
    const supervisor = this.supervisors.get(id);
    if (!supervisor) {
      return;
    }

    this.scheduler.stop(id);
    this.supervisors.delete(id);
    this.supervisorsBySession.delete(supervisor.sessionId);

    // Broadcast deletion
    this.deps.broadcaster.broadcast(
      `workspace.${supervisor.workspaceId}.session.${supervisor.sessionId}.supervisor.state`,
      { supervisorId: id, event: 'deleted' }
    );
  }

  /**
   * Pause supervisor evaluation
   */
  async pause(id: string): Promise<Supervisor> {
    this.scheduler.stop(id);
    return this.setState(id, 'paused');
  }

  /**
   * Resume supervisor evaluation
   */
  async resume(id: string): Promise<Supervisor> {
    const supervisor = this.supervisors.get(id);
    if (supervisor) {
      this.scheduler.start(id, LEGACY_SUPERVISOR_INTERVAL_MS);
    }
    return this.setState(id, 'idle');
  }

  /**
   * Trigger manual evaluation cycle
   */
  async triggerEvaluation(id: string): Promise<SupervisorCycle> {
    const supervisor = this.supervisors.get(id);
    if (!supervisor) {
      throw new Error(`Supervisor not found: ${id}`);
    }

    // Create new cycle
    const cycle: SupervisorCycle = {
      id: generateCycleId(),
      sessionId: supervisor.sessionId,
      supervisorId: id,
      status: 'queued',
      trigger: 'manual',
      evidenceSource: 'terminal_fallback',
      objective: supervisor.objective,
      evaluatorProviderId: supervisor.evaluatorProviderId,
      createdAt: Date.now(),
    };

    // Add cycle to supervisor
    const updated: Supervisor = {
      ...supervisor,
      state: 'evaluating',
      cycles: [...supervisor.cycles, cycle],
      updatedAt: Date.now(),
    };

    this.supervisors.set(id, updated);

    // Broadcast cycle creation
    this.deps.broadcaster.broadcast(
      `workspace.${updated.workspaceId}.session.${updated.sessionId}.supervisor.cycle`,
      { cycle, event: 'created' }
    );

    return cycle;
  }

  /**
   * Update cycle status
   */
  async updateCycle(
    supervisorId: string,
    cycleId: string,
    status: CycleStatus,
    data?: Partial<SupervisorCycle>
  ): Promise<SupervisorCycle | undefined> {
    const supervisor = this.supervisors.get(supervisorId);
    if (!supervisor) {
      return undefined;
    }

    const cycleIndex = supervisor.cycles.findIndex((c) => c.id === cycleId);
    if (cycleIndex === -1) {
      return undefined;
    }

    const cycle = supervisor.cycles[cycleIndex];
    if (!cycle) {
      return undefined;
    }
    const completedAt =
      status === 'completed' || status === 'failed' || status === 'injected'
        ? Date.now()
        : data?.completedAt ?? cycle.completedAt;
    const updatedCycle: SupervisorCycle = {
      id: cycle.id,
      supervisorId: cycle.supervisorId,
      sessionId: cycle.sessionId,
      status,
      trigger: data?.trigger ?? cycle.trigger,
      evidenceSource: data?.evidenceSource ?? cycle.evidenceSource,
      objective: data?.objective ?? cycle.objective,
      evaluatorProviderId:
        data?.evaluatorProviderId ?? cycle.evaluatorProviderId,
      turnId: data?.turnId ?? cycle.turnId,
      progress: data?.progress ?? cycle.progress,
      result: data?.result ?? cycle.result,
      injectedGuidance: data?.injectedGuidance ?? cycle.injectedGuidance,
      createdAt: cycle.createdAt,
      completedAt,
      errorReason: data?.errorReason ?? cycle.errorReason,
    };

    const updatedSupervisor: Supervisor = {
      ...supervisor,
      state: status === 'evaluating' ? 'evaluating' : 'idle',
      cycles: [
        ...supervisor.cycles.slice(0, cycleIndex),
        updatedCycle,
        ...supervisor.cycles.slice(cycleIndex + 1),
      ],
      lastCycleAt: updatedCycle.completedAt,
      updatedAt: Date.now(),
    };

    this.supervisors.set(supervisorId, updatedSupervisor);

    // Broadcast cycle update
    this.deps.broadcaster.broadcast(
      `workspace.${updatedSupervisor.workspaceId}.session.${updatedSupervisor.sessionId}.supervisor.cycle`,
      { cycle: updatedCycle, event: 'updated' }
    );

    return updatedCycle;
  }

  /**
   * Get supervisor by ID
   */
  get(id: string): Supervisor | undefined {
    return this.supervisors.get(id);
  }

  /**
   * Get supervisor by session ID
   */
  getBySession(sessionId: string): Supervisor | undefined {
    const id = this.supervisorsBySession.get(sessionId);
    return id ? this.supervisors.get(id) : undefined;
  }

  /**
   * Run evaluation cycle for a supervisor
   */
  private async runEvaluation(supervisorId: string): Promise<void> {
    const supervisor = this.supervisors.get(supervisorId);
    if (!supervisor || supervisor.state === 'paused' || supervisor.state === 'inactive') {
      return;
    }

    // Create cycle
    const cycle = await this.triggerEvaluation(supervisorId);

    try {
      // Update cycle to evaluating
      await this.updateCycle(supervisorId, cycle.id, 'evaluating');

      // Get terminal output for evaluation
      const terminalOutput = (this.deps.terminalMgr as any).getSessionOutput?.(supervisor.sessionId) ?? '';

      // Run LLM evaluation
      const result = await evaluateProgress(supervisor.objective, terminalOutput);

      if (result.shouldInject && result.guidance) {
        // Update state to injecting
        await this.setState(supervisorId, 'injecting');

        // Inject guidance
        await injectGuidance(this.deps.terminalMgr, supervisor.sessionId, result.guidance);

        // Complete cycle as injected
        await this.updateCycle(supervisorId, cycle.id, 'injected', {
          progress: result.progress,
          result: result.summary,
          injectedGuidance: result.guidance,
        });
      } else {
        // Complete cycle as completed
        await this.updateCycle(supervisorId, cycle.id, 'completed', {
          progress: result.progress,
          result: result.summary,
        });
      }

      // Return to idle
      await this.setState(supervisorId, 'idle');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Evaluation failed';
      await this.updateCycle(supervisorId, cycle.id, 'failed', {
        errorReason: message,
      });
      await this.setState(supervisorId, 'error');

      // Update supervisor error reason
      const updated = this.supervisors.get(supervisorId);
      if (updated) {
        this.supervisors.set(supervisorId, { ...updated, errorReason: message });
      }
    }
  }

  /**
   * Set supervisor state
   */
  private async setState(id: string, state: SupervisorState): Promise<Supervisor> {
    const supervisor = this.supervisors.get(id);
    if (!supervisor) {
      throw new Error(`Supervisor not found: ${id}`);
    }

    const updated: Supervisor = {
      ...supervisor,
      state,
      updatedAt: Date.now(),
    };

    this.supervisors.set(id, updated);

    // Broadcast state change
    this.deps.broadcaster.broadcast(
      `workspace.${updated.workspaceId}.session.${updated.sessionId}.supervisor.state`,
      { supervisor: updated, event: 'state_changed' }
    );

    return updated;
  }
}
