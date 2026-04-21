import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDatabase, openDatabase, SupervisorCycleRepo, SupervisorRepo } from '../storage/index.js';

describe('SupervisorRepo', () => {
  let tempDir: string;
  let db: ReturnType<typeof openDatabase>;
  let supervisorRepo: SupervisorRepo;
  let cycleRepo: SupervisorCycleRepo;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'supervisor-repo-'));
    db = openDatabase(join(tempDir, 'test.db'));

    db.prepare(
      'INSERT INTO workspaces (id, path, target_runtime, opened_at, last_active_at, ui_state) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('ws-1', tempDir, 'native', 1, 1, '{}');
    db.prepare(
      'INSERT INTO terminals (id, workspace_id, kind, cwd, argv, cols, rows, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('term-1', 'ws-1', 'agent', tempDir, '[]', 120, 30, 1);
    db.prepare(
      'INSERT INTO sessions (id, workspace_id, terminal_id, provider_id, resume_id, capability, state, started_at, last_active_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('sess-1', 'ws-1', 'term-1', 'claude', null, 'full', 'idle', 1, 1);

    supervisorRepo = new SupervisorRepo(db);
    cycleRepo = new SupervisorCycleRepo(db);
  });

  afterEach(() => {
    closeDatabase(db);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('persists evaluatorProviderId and lastEvaluatedTurnId', () => {
    supervisorRepo.create({
      id: 'sup-1',
      sessionId: 'sess-1',
      workspaceId: 'ws-1',
      state: 'idle',
      objective: 'Finish supervisor persistence',
      evaluatorProviderId: 'codex',
      lastEvaluatedTurnId: 'turn-7',
      createdAt: 10,
      updatedAt: 10,
    });

    const stored = supervisorRepo.getBySessionId('sess-1');
    expect(stored?.evaluatorProviderId).toBe('codex');
    expect(stored?.lastEvaluatedTurnId).toBe('turn-7');
  });

  it('prunes cycles beyond max retention', () => {
    supervisorRepo.create({
      id: 'sup-1',
      sessionId: 'sess-1',
      workspaceId: 'ws-1',
      state: 'idle',
      objective: 'Keep the newest 100 cycles',
      evaluatorProviderId: 'claude',
      createdAt: 10,
      updatedAt: 10,
    });

    for (let i = 0; i < 101; i += 1) {
      cycleRepo.create({
        id: `cycle-${i}`,
        supervisorId: 'sup-1',
        sessionId: 'sess-1',
        status: 'completed',
        trigger: 'manual',
        evidenceSource: 'terminal_fallback',
        objective: 'Keep the newest 100 cycles',
        evaluatorProviderId: 'claude',
        createdAt: i,
        completedAt: i,
      });
    }

    cycleRepo.pruneOldest('sup-1', 100);

    const cycles = cycleRepo.listRecentForSupervisor('sup-1', 200);
    expect(cycles).toHaveLength(100);
    expect(cycles.some((cycle) => cycle.id === 'cycle-0')).toBe(false);
    expect(cycles[0]?.id).toBe('cycle-100');
  });
});
