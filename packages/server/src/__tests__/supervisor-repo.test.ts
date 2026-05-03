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
      'INSERT INTO sessions (id, workspace_id, terminal_id, provider_id, capability, state, started_at, last_active_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('sess-1', 'ws-1', 'term-1', 'claude', 'full', 'idle', 1, 1);

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

  it('rejects a supervisor whose workspace does not match its session workspace', () => {
    db.prepare(
      'INSERT INTO workspaces (id, path, target_runtime, opened_at, last_active_at, ui_state) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('ws-2', join(tempDir, 'ws-2'), 'native', 2, 2, '{}');
    db.prepare(
      'INSERT INTO terminals (id, workspace_id, kind, cwd, argv, cols, rows, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('term-2', 'ws-2', 'agent', tempDir, '[]', 120, 30, 2);
    db.prepare(
      'INSERT INTO sessions (id, workspace_id, terminal_id, provider_id, capability, state, started_at, last_active_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('sess-2', 'ws-2', 'term-2', 'codex', 'full', 'idle', 2, 2);

    expect(() =>
      supervisorRepo.create({
        id: 'sup-bad',
        sessionId: 'sess-2',
        workspaceId: 'ws-1',
        state: 'idle',
        objective: 'This insert must fail',
        evaluatorProviderId: 'claude',
        createdAt: 10,
        updatedAt: 10,
      })
    ).toThrow();
  });

  it('rejects a cycle whose session does not match its supervisor session', () => {
    db.prepare(
      'INSERT INTO terminals (id, workspace_id, kind, cwd, argv, cols, rows, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('term-2', 'ws-1', 'agent', tempDir, '[]', 120, 30, 2);
    db.prepare(
      'INSERT INTO sessions (id, workspace_id, terminal_id, provider_id, capability, state, started_at, last_active_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('sess-2', 'ws-1', 'term-2', 'codex', 'full', 'idle', 2, 2);

    supervisorRepo.create({
      id: 'sup-1',
      sessionId: 'sess-1',
      workspaceId: 'ws-1',
      state: 'idle',
      objective: 'Enforce supervisor/session integrity',
      evaluatorProviderId: 'claude',
      createdAt: 10,
      updatedAt: 10,
    });

    expect(() =>
      cycleRepo.create({
        id: 'cycle-bad',
        supervisorId: 'sup-1',
        sessionId: 'sess-2',
        status: 'completed',
        trigger: 'manual',
        evidenceSource: 'headless_snapshot',
        objective: 'This insert must fail',
        evaluatorProviderId: 'claude',
        createdAt: 11,
        completedAt: 11,
      })
    ).toThrow();
  });

  it('preserves omitted nullable supervisor fields during update', () => {
    supervisorRepo.create({
      id: 'sup-1',
      sessionId: 'sess-1',
      workspaceId: 'ws-1',
      state: 'idle',
      objective: 'Keep nullable fields intact',
      evaluatorProviderId: 'claude',
      lastCycleAt: 21,
      lastEvaluatedTurnId: 'turn-21',
      errorReason: 'needs review',
      createdAt: 10,
      updatedAt: 10,
    });

    const updated = supervisorRepo.update('sup-1', {
      state: 'paused',
      updatedAt: 11,
    });

    expect(updated.state).toBe('paused');
    expect(updated.lastCycleAt).toBe(21);
    expect(updated.lastEvaluatedTurnId).toBe('turn-21');
    expect(updated.errorReason).toBe('needs review');
  });

  it('can clear nullable supervisor fields when explicit null is passed', () => {
    supervisorRepo.create({
      id: 'sup-1',
      sessionId: 'sess-1',
      workspaceId: 'ws-1',
      state: 'idle',
      objective: 'Clear nullable fields',
      evaluatorProviderId: 'claude',
      lastCycleAt: 21,
      lastEvaluatedTurnId: 'turn-21',
      errorReason: 'needs review',
      createdAt: 10,
      updatedAt: 10,
    });

    const updated = supervisorRepo.update('sup-1', {
      lastCycleAt: null,
      lastEvaluatedTurnId: null,
      errorReason: null,
      updatedAt: 11,
    });

    expect(updated.lastCycleAt).toBeUndefined();
    expect(updated.lastEvaluatedTurnId).toBeUndefined();
    expect(updated.errorReason).toBeUndefined();
  });

  it('preserves omitted cycle fields during update', () => {
    supervisorRepo.create({
      id: 'sup-1',
      sessionId: 'sess-1',
      workspaceId: 'ws-1',
      state: 'idle',
      objective: 'Keep cycle fields intact',
      evaluatorProviderId: 'claude',
      createdAt: 10,
      updatedAt: 10,
    });
    cycleRepo.create({
      id: 'cycle-1',
      supervisorId: 'sup-1',
      sessionId: 'sess-1',
      status: 'evaluating',
      trigger: 'manual',
      evidenceSource: 'headless_snapshot',
      objective: 'Keep cycle fields intact',
      evaluatorProviderId: 'claude',
      progress: 40,
      result: 'working',
      injectedGuidance: 'stay focused',
      errorReason: 'temporary',
      createdAt: 10,
      completedAt: 12,
    });

    const updated = cycleRepo.update('cycle-1', {
      status: 'completed',
    });

    expect(updated.status).toBe('completed');
    expect(updated.progress).toBe(40);
    expect(updated.result).toBe('working');
    expect(updated.injectedGuidance).toBe('stay focused');
    expect(updated.errorReason).toBe('temporary');
    expect(updated.completedAt).toBe(12);
  });

  it('can clear nullable cycle fields when explicit null is passed', () => {
    supervisorRepo.create({
      id: 'sup-1',
      sessionId: 'sess-1',
      workspaceId: 'ws-1',
      state: 'idle',
      objective: 'Clear cycle fields',
      evaluatorProviderId: 'claude',
      createdAt: 10,
      updatedAt: 10,
    });
    cycleRepo.create({
      id: 'cycle-1',
      supervisorId: 'sup-1',
      sessionId: 'sess-1',
      status: 'evaluating',
      trigger: 'manual',
      evidenceSource: 'headless_snapshot',
      objective: 'Clear cycle fields',
      evaluatorProviderId: 'claude',
      progress: 40,
      result: 'working',
      injectedGuidance: 'stay focused',
      errorReason: 'temporary',
      createdAt: 10,
      completedAt: 12,
    });

    const updated = cycleRepo.update('cycle-1', {
      progress: null,
      result: null,
      injectedGuidance: null,
      errorReason: null,
      completedAt: null,
    });

    expect(updated.progress).toBeUndefined();
    expect(updated.result).toBeUndefined();
    expect(updated.injectedGuidance).toBeUndefined();
    expect(updated.errorReason).toBeUndefined();
    expect(updated.completedAt).toBeUndefined();
  });

  it('throws when updating a missing supervisor row', () => {
    expect(() =>
      supervisorRepo.update('missing-supervisor', {
        state: 'paused',
        updatedAt: 12,
      })
    ).toThrow(/missing-supervisor/);
  });

  it('throws when updating a missing supervisor cycle row', () => {
    expect(() =>
      cycleRepo.update('missing-cycle', {
        status: 'failed',
      })
    ).toThrow(/missing-cycle/);
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
        evidenceSource: 'headless_snapshot',
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
