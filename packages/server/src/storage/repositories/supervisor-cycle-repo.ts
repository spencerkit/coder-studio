import type Database from 'better-sqlite3';
import type { SupervisorCycle } from '@coder-studio/core';

interface SupervisorCycleRow {
  id: string;
  supervisor_id: string;
  session_id: string;
  status: SupervisorCycle['status'];
  trigger: SupervisorCycle['trigger'];
  evidence_source: SupervisorCycle['evidenceSource'];
  objective: string;
  evaluator_provider_id: string;
  turn_id: string | null;
  progress: number | null;
  result: string | null;
  injected_guidance: string | null;
  error_reason: string | null;
  created_at: number;
  completed_at: number | null;
}

export class SupervisorCycleRepo {
  constructor(private readonly db: Database.Database) {}

  create(input: SupervisorCycle): SupervisorCycle {
    this.db.prepare(
      `INSERT INTO supervisor_cycles (id, supervisor_id, session_id, status, trigger, evidence_source, objective, evaluator_provider_id, turn_id, progress, result, injected_guidance, error_reason, created_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.id,
      input.supervisorId,
      input.sessionId,
      input.status,
      input.trigger,
      input.evidenceSource,
      input.objective,
      input.evaluatorProviderId,
      input.turnId ?? null,
      input.progress ?? null,
      input.result ?? null,
      input.injectedGuidance ?? null,
      input.errorReason ?? null,
      input.createdAt,
      input.completedAt ?? null
    );

    return this.findById(input.id)!;
  }

  findById(id: string): SupervisorCycle | undefined {
    const row = this.db.prepare('SELECT * FROM supervisor_cycles WHERE id = ?').get(id) as SupervisorCycleRow | undefined;
    return row ? this.rowToCycle(row) : undefined;
  }

  listRecentForSupervisor(supervisorId: string, limit: number): SupervisorCycle[] {
    const rows = this.db.prepare(
      'SELECT * FROM supervisor_cycles WHERE supervisor_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(supervisorId, limit) as SupervisorCycleRow[];
    return rows.map((row) => this.rowToCycle(row));
  }

  update(id: string, patch: Partial<SupervisorCycle>): SupervisorCycle {
    this.db.prepare(
      `UPDATE supervisor_cycles
       SET status = COALESCE(@status, status),
           progress = COALESCE(@progress, progress),
           result = COALESCE(@result, result),
           injected_guidance = COALESCE(@injectedGuidance, injected_guidance),
           error_reason = COALESCE(@errorReason, error_reason),
           completed_at = COALESCE(@completedAt, completed_at)
       WHERE id = @id`
    ).run({
      id,
      status: patch.status ?? null,
      progress: patch.progress ?? null,
      result: patch.result ?? null,
      injectedGuidance: patch.injectedGuidance ?? null,
      errorReason: patch.errorReason ?? null,
      completedAt: patch.completedAt ?? null,
    });

    return this.findById(id)!;
  }

  pruneOldest(supervisorId: string, keep: number): void {
    this.db.prepare(
      `DELETE FROM supervisor_cycles
       WHERE id IN (
         SELECT id FROM supervisor_cycles
         WHERE supervisor_id = ?
         ORDER BY created_at DESC
         LIMIT -1 OFFSET ?
       )`
    ).run(supervisorId, keep);
  }

  private rowToCycle(row: SupervisorCycleRow): SupervisorCycle {
    return {
      id: row.id,
      supervisorId: row.supervisor_id,
      sessionId: row.session_id,
      status: row.status,
      trigger: row.trigger,
      evidenceSource: row.evidence_source,
      objective: row.objective,
      evaluatorProviderId: row.evaluator_provider_id,
      turnId: row.turn_id ?? undefined,
      progress: row.progress ?? undefined,
      result: row.result ?? undefined,
      injectedGuidance: row.injected_guidance ?? undefined,
      errorReason: row.error_reason ?? undefined,
      createdAt: row.created_at,
      completedAt: row.completed_at ?? undefined,
    };
  }
}
