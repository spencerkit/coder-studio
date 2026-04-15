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

export interface SupervisorManagerDeps {
  eventBus: EventBus;
  broadcaster: Broadcaster;
}

export interface CreateSupervisorRequest {
  sessionId: string;
  workspaceId: string;
  objective: string;
  intervalMs?: number;
}

export interface UpdateSupervisorRequest {
  objective?: string;
  intervalMs?: number;
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

  constructor(private readonly deps: SupervisorManagerDeps) {}

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
      cycles: [],
      intervalMs: req.intervalMs,
      createdAt: now,
      updatedAt: now,
    };

    this.supervisors.set(id, supervisor);
    this.supervisorsBySession.set(req.sessionId, id);

    // Broadcast supervisor creation
    this.deps.broadcaster.broadcast(
      `workspace.${req.workspaceId}.session.${req.sessionId}.supervisor.state`,
      { supervisor, event: 'created' }
    );

    return supervisor;
  }

  /**
   * Update supervisor objective or interval
   */
  async update(id: string, req: UpdateSupervisorRequest): Promise<Supervisor> {
    const supervisor = this.supervisors.get(id);
    if (!supervisor) {
      throw new Error(`Supervisor not found: ${id}`);
    }

    const updated: Supervisor = {
      ...supervisor,
      objective: req.objective ?? supervisor.objective,
      intervalMs: req.intervalMs ?? supervisor.intervalMs,
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
    return this.setState(id, 'paused');
  }

  /**
   * Resume supervisor evaluation
   */
  async resume(id: string): Promise<Supervisor> {
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
      objective: supervisor.objective,
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
    const updatedCycle: SupervisorCycle = {
      ...cycle,
      ...data,
      status,
      completedAt: status === 'completed' || status === 'failed' ? Date.now() : undefined,
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
