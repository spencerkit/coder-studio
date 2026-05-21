import type { Supervisor, SupervisorState, SupervisorStopReason } from "@coder-studio/core";

export interface NewSupervisor {
  id: string;
  sessionId: string;
  workspaceId: string;
  state: SupervisorState;
  objective: string;
  evaluatorProviderId: string;
  evaluatorModel?: string;
  maxSupervisionCount: number;
  completedSupervisionCount: number;
  scheduledAt?: number;
  stopReason?: SupervisorStopReason;
  lastCycleAt?: number;
  lastEvaluatedTurnId?: string;
  errorReason?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SupervisorUpdatePatch {
  state?: SupervisorState;
  objective?: string;
  evaluatorProviderId?: string;
  evaluatorModel?: string | null;
  maxSupervisionCount?: number;
  completedSupervisionCount?: number;
  scheduledAt?: number | null;
  stopReason?: SupervisorStopReason | null;
  lastCycleAt?: number | null;
  lastEvaluatedTurnId?: string | null;
  errorReason?: string | null;
  updatedAt?: number;
}

export class SupervisorRepo {
  private readonly supervisors = new Map<string, Supervisor>();

  create(input: NewSupervisor): Supervisor {
    const supervisor = this.normalizeSupervisor(input);
    this.supervisors.set(supervisor.id, { ...supervisor });
    return { ...supervisor };
  }

  findById(id: string): Supervisor | undefined {
    const supervisor = this.supervisors.get(id);
    return supervisor ? { ...supervisor } : undefined;
  }

  getBySessionId(sessionId: string): Supervisor | undefined {
    const supervisor = [...this.supervisors.values()].find(
      (value) => value.sessionId === sessionId
    );
    return supervisor ? { ...supervisor } : undefined;
  }

  listAll(): Supervisor[] {
    return [...this.supervisors.values()]
      .slice()
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((supervisor) => ({ ...supervisor }));
  }

  update(id: string, patch: SupervisorUpdatePatch): Supervisor {
    const current = this.supervisors.get(id);
    if (!current) {
      throw new Error(`Supervisor not found: ${id}`);
    }

    const next: Supervisor = {
      ...current,
      ...(patch.state !== undefined ? { state: patch.state } : {}),
      ...(patch.objective !== undefined ? { objective: patch.objective } : {}),
      ...(patch.evaluatorProviderId !== undefined
        ? { evaluatorProviderId: patch.evaluatorProviderId }
        : {}),
      ...(patch.evaluatorModel !== undefined
        ? { evaluatorModel: patch.evaluatorModel ?? undefined }
        : {}),
      ...(patch.maxSupervisionCount !== undefined
        ? { maxSupervisionCount: patch.maxSupervisionCount }
        : {}),
      ...(patch.completedSupervisionCount !== undefined
        ? { completedSupervisionCount: patch.completedSupervisionCount }
        : {}),
      ...(patch.scheduledAt !== undefined ? { scheduledAt: patch.scheduledAt ?? undefined } : {}),
      ...(patch.stopReason !== undefined ? { stopReason: patch.stopReason ?? undefined } : {}),
      ...(patch.lastCycleAt !== undefined ? { lastCycleAt: patch.lastCycleAt ?? undefined } : {}),
      ...(patch.lastEvaluatedTurnId !== undefined
        ? { lastEvaluatedTurnId: patch.lastEvaluatedTurnId ?? undefined }
        : {}),
      ...(patch.errorReason !== undefined ? { errorReason: patch.errorReason ?? undefined } : {}),
      updatedAt: patch.updatedAt ?? Date.now(),
    };
    this.supervisors.set(id, { ...next });
    return { ...next };
  }

  delete(id: string): void {
    this.supervisors.delete(id);
  }

  private normalizeSupervisor(input: NewSupervisor): Supervisor {
    return {
      id: input.id,
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      targetId: input.id,
      state: input.state,
      objective: input.objective,
      evaluatorProviderId: input.evaluatorProviderId,
      evaluatorModel: input.evaluatorModel ?? undefined,
      maxSupervisionCount: input.maxSupervisionCount ?? 0,
      completedSupervisionCount: input.completedSupervisionCount ?? 0,
      scheduledAt: input.scheduledAt ?? undefined,
      stopReason: input.stopReason ?? undefined,
      currentTargetMemory: undefined,
      recentTargetCycles: [],
      lastCycleAt: input.lastCycleAt ?? undefined,
      lastEvaluatedTurnId: input.lastEvaluatedTurnId ?? undefined,
      errorReason: input.errorReason ?? undefined,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    };
  }
}
