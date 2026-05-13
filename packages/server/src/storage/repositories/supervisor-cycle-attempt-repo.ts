import type {
  SupervisorCycleAttempt,
  SupervisorCycleAttemptPatch,
  SupervisorCycleAttemptStatus,
} from "@coder-studio/core";
import type { Database } from "../database.js";

interface SupervisorCycleAttemptRow {
  id: string;
  cycle_id: string;
  attempt_index: number;
  status: SupervisorCycleAttemptStatus;
  started_at: number;
  completed_at: number | null;
  error_reason: string | null;
  provider_model: string | null;
}

export type NewSupervisorCycleAttempt = SupervisorCycleAttempt;

export type SupervisorCycleAttemptUpdatePatch = SupervisorCycleAttemptPatch;

export class SupervisorCycleAttemptRepo {
  constructor(private readonly db: Database) {}

  create(input: NewSupervisorCycleAttempt): SupervisorCycleAttempt {
    this.db
      .prepare(
        `INSERT INTO supervisor_cycle_attempts (id, cycle_id, attempt_index, status, started_at, completed_at, error_reason, provider_model)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.id,
        input.cycleId,
        input.attemptIndex,
        input.status,
        input.startedAt,
        input.completedAt ?? null,
        input.errorReason ?? null,
        input.providerModel ?? null
      );

    return this.findById(input.id)!;
  }

  findById(id: string): SupervisorCycleAttempt | undefined {
    const row = this.db.prepare("SELECT * FROM supervisor_cycle_attempts WHERE id = ?").get(id) as
      | SupervisorCycleAttemptRow
      | undefined;
    return row ? this.rowToAttempt(row) : undefined;
  }

  listForCycle(cycleId: string): SupervisorCycleAttempt[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM supervisor_cycle_attempts WHERE cycle_id = ? ORDER BY attempt_index ASC"
      )
      .all(cycleId) as unknown as SupervisorCycleAttemptRow[];
    return rows.map((row) => this.rowToAttempt(row));
  }

  update(id: string, patch: SupervisorCycleAttemptUpdatePatch): SupervisorCycleAttempt {
    const assignments: string[] = [];
    const params: Record<string, number | string | null> = { id };

    if (patch.status !== undefined) {
      assignments.push("status = @status");
      params.status = patch.status;
    }
    if (patch.completedAt !== undefined) {
      assignments.push("completed_at = @completedAt");
      params.completedAt = patch.completedAt;
    }
    if (patch.errorReason !== undefined) {
      assignments.push("error_reason = @errorReason");
      params.errorReason = patch.errorReason;
    }
    if (patch.providerModel !== undefined) {
      assignments.push("provider_model = @providerModel");
      params.providerModel = patch.providerModel;
    }

    if (assignments.length === 0) {
      const existing = this.findById(id);
      if (!existing) {
        throw new Error(`Supervisor cycle attempt not found: ${id}`);
      }
      return existing;
    }

    const result = this.db
      .prepare(`UPDATE supervisor_cycle_attempts SET ${assignments.join(", ")} WHERE id = @id`)
      .run(params);

    if (result.changes === 0) {
      throw new Error(`Supervisor cycle attempt not found: ${id}`);
    }

    return this.findById(id)!;
  }

  deleteForCycle(cycleId: string): void {
    this.db.prepare("DELETE FROM supervisor_cycle_attempts WHERE cycle_id = ?").run(cycleId);
  }

  private rowToAttempt(row: SupervisorCycleAttemptRow): SupervisorCycleAttempt {
    return {
      id: row.id,
      cycleId: row.cycle_id,
      attemptIndex: row.attempt_index,
      status: row.status,
      startedAt: row.started_at,
      completedAt: row.completed_at ?? undefined,
      errorReason: row.error_reason ?? undefined,
      providerModel: row.provider_model ?? undefined,
    };
  }
}
