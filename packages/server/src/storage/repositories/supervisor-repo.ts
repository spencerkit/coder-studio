import type { Supervisor, SupervisorState } from "@coder-studio/core";
import type { Database } from "../database.js";

interface SupervisorRow {
  id: string;
  session_id: string;
  workspace_id: string;
  state: SupervisorState;
  objective: string;
  evaluator_provider_id: string;
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
  lastCycleAt?: number | null;
  lastEvaluatedTurnId?: string | null;
  errorReason?: string | null;
  updatedAt?: number;
}

export class SupervisorRepo {
  constructor(private readonly db: Database) {}

  create(input: NewSupervisor): Supervisor {
    this.db
      .prepare(
        `INSERT INTO supervisors (id, session_id, workspace_id, state, objective, evaluator_provider_id, last_cycle_at, last_evaluated_turn_id, error_reason, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.id,
        input.sessionId,
        input.workspaceId,
        input.state,
        input.objective,
        input.evaluatorProviderId,
        input.lastCycleAt ?? null,
        input.lastEvaluatedTurnId ?? null,
        input.errorReason ?? null,
        input.createdAt,
        input.updatedAt
      );

    return this.findById(input.id)!;
  }

  findById(id: string): Supervisor | undefined {
    const row = this.db.prepare("SELECT * FROM supervisors WHERE id = ?").get(id) as
      | SupervisorRow
      | undefined;
    return row ? this.rowToSupervisor(row) : undefined;
  }

  getBySessionId(sessionId: string): Supervisor | undefined {
    const row = this.db.prepare("SELECT * FROM supervisors WHERE session_id = ?").get(sessionId) as
      | SupervisorRow
      | undefined;
    return row ? this.rowToSupervisor(row) : undefined;
  }

  listAll(): Supervisor[] {
    const rows = this.db
      .prepare("SELECT * FROM supervisors ORDER BY created_at ASC")
      .all() as unknown as SupervisorRow[];
    return rows.map((row) => this.rowToSupervisor(row));
  }

  update(id: string, patch: SupervisorUpdatePatch): Supervisor {
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

  delete(id: string): void {
    this.db.prepare("DELETE FROM supervisors WHERE id = ?").run(id);
  }

  private rowToSupervisor(row: SupervisorRow): Supervisor {
    return {
      id: row.id,
      sessionId: row.session_id,
      workspaceId: row.workspace_id,
      state: row.state,
      objective: row.objective,
      evaluatorProviderId: row.evaluator_provider_id,
      cycles: [],
      lastCycleAt: row.last_cycle_at ?? undefined,
      lastEvaluatedTurnId: row.last_evaluated_turn_id ?? undefined,
      errorReason: row.error_reason ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
