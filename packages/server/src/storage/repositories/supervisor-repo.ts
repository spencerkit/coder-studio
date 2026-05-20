import type { Supervisor, SupervisorState, SupervisorStopReason } from "@coder-studio/core";
import type { Database } from "../database.js";

interface SupervisorRow {
  id: string;
  session_id: string;
  workspace_id: string;
  state: SupervisorState;
  objective: string;
  evaluator_provider_id: string;
  evaluator_model: string | null;
  max_supervision_count: number;
  completed_supervision_count: number;
  scheduled_at: number | null;
  stop_reason: SupervisorStopReason | null;
  last_cycle_at: number | null;
  last_evaluated_turn_id: string | null;
  error_reason: string | null;
  created_at: number;
  updated_at: number;
}

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

  constructor(private readonly db?: Database) {}

  create(input: NewSupervisor): Supervisor {
    if (this.db) {
      this.db
        .prepare(
          `INSERT INTO supervisors (id, session_id, workspace_id, state, objective, evaluator_provider_id, evaluator_model, max_supervision_count, completed_supervision_count, scheduled_at, stop_reason, last_cycle_at, last_evaluated_turn_id, error_reason, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.id,
          input.sessionId,
          input.workspaceId,
          input.state,
          input.objective,
          input.evaluatorProviderId,
          input.evaluatorModel ?? null,
          input.maxSupervisionCount ?? 0,
          input.completedSupervisionCount ?? 0,
          input.scheduledAt ?? null,
          input.stopReason ?? null,
          input.lastCycleAt ?? null,
          input.lastEvaluatedTurnId ?? null,
          input.errorReason ?? null,
          input.createdAt,
          input.updatedAt
        );

      return this.findById(input.id)!;
    }

    const supervisor = this.normalizeSupervisor(input);
    this.supervisors.set(supervisor.id, { ...supervisor });
    return { ...supervisor };
  }

  findById(id: string): Supervisor | undefined {
    if (this.db) {
      const row = this.db.prepare("SELECT * FROM supervisors WHERE id = ?").get(id) as
        | SupervisorRow
        | undefined;
      return row ? this.rowToSupervisor(row) : undefined;
    }

    const supervisor = this.supervisors.get(id);
    return supervisor ? { ...supervisor } : undefined;
  }

  getBySessionId(sessionId: string): Supervisor | undefined {
    if (this.db) {
      const row = this.db
        .prepare("SELECT * FROM supervisors WHERE session_id = ?")
        .get(sessionId) as SupervisorRow | undefined;
      return row ? this.rowToSupervisor(row) : undefined;
    }

    const supervisor = [...this.supervisors.values()].find(
      (value) => value.sessionId === sessionId
    );
    return supervisor ? { ...supervisor } : undefined;
  }

  listAll(): Supervisor[] {
    if (this.db) {
      const rows = this.db
        .prepare("SELECT * FROM supervisors ORDER BY created_at ASC")
        .all() as unknown as SupervisorRow[];
      return rows.map((row) => this.rowToSupervisor(row));
    }

    return [...this.supervisors.values()]
      .slice()
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((supervisor) => ({ ...supervisor }));
  }

  update(id: string, patch: SupervisorUpdatePatch): Supervisor {
    if (this.db) {
      const assignments = ["updated_at = @updatedAt"];
      const params: Record<string, number | string | null> = {
        id,
        updatedAt: patch.updatedAt ?? Date.now(),
      };

      if (patch.state !== undefined) {
        assignments.push("state = @state");
        params.state = patch.state;
      }
      if (patch.objective !== undefined) {
        assignments.push("objective = @objective");
        params.objective = patch.objective;
      }
      if (patch.evaluatorProviderId !== undefined) {
        assignments.push("evaluator_provider_id = @evaluatorProviderId");
        params.evaluatorProviderId = patch.evaluatorProviderId;
      }
      if (patch.evaluatorModel !== undefined) {
        assignments.push("evaluator_model = @evaluatorModel");
        params.evaluatorModel = patch.evaluatorModel;
      }
      if (patch.maxSupervisionCount !== undefined) {
        assignments.push("max_supervision_count = @maxSupervisionCount");
        params.maxSupervisionCount = patch.maxSupervisionCount;
      }
      if (patch.completedSupervisionCount !== undefined) {
        assignments.push("completed_supervision_count = @completedSupervisionCount");
        params.completedSupervisionCount = patch.completedSupervisionCount;
      }
      if (patch.scheduledAt !== undefined) {
        assignments.push("scheduled_at = @scheduledAt");
        params.scheduledAt = patch.scheduledAt;
      }
      if (patch.stopReason !== undefined) {
        assignments.push("stop_reason = @stopReason");
        params.stopReason = patch.stopReason;
      }
      if (patch.lastCycleAt !== undefined) {
        assignments.push("last_cycle_at = @lastCycleAt");
        params.lastCycleAt = patch.lastCycleAt;
      }
      if (patch.lastEvaluatedTurnId !== undefined) {
        assignments.push("last_evaluated_turn_id = @lastEvaluatedTurnId");
        params.lastEvaluatedTurnId = patch.lastEvaluatedTurnId;
      }
      if (patch.errorReason !== undefined) {
        assignments.push("error_reason = @errorReason");
        params.errorReason = patch.errorReason;
      }

      const result = this.db
        .prepare(`UPDATE supervisors SET ${assignments.join(", ")} WHERE id = @id`)
        .run(params);

      if (result.changes === 0) {
        throw new Error(`Supervisor not found: ${id}`);
      }

      return this.findById(id)!;
    }

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
    if (this.db) {
      this.db.prepare("DELETE FROM supervisors WHERE id = ?").run(id);
      return;
    }
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

  private rowToSupervisor(row: SupervisorRow): Supervisor {
    return {
      id: row.id,
      sessionId: row.session_id,
      workspaceId: row.workspace_id,
      targetId: row.id,
      state: row.state,
      objective: row.objective,
      evaluatorProviderId: row.evaluator_provider_id,
      evaluatorModel: row.evaluator_model ?? undefined,
      maxSupervisionCount: row.max_supervision_count,
      completedSupervisionCount: row.completed_supervision_count,
      scheduledAt: row.scheduled_at ?? undefined,
      stopReason: row.stop_reason ?? undefined,
      currentTargetMemory: undefined,
      recentTargetCycles: [],
      lastCycleAt: row.last_cycle_at ?? undefined,
      lastEvaluatedTurnId: row.last_evaluated_turn_id ?? undefined,
      errorReason: row.error_reason ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
