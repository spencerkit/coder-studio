import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeDatabase,
  openDatabase,
  SupervisorCycleAttemptRepo,
  SupervisorCycleRepo,
  SupervisorRepo,
} from "../storage/index.js";

describe("SupervisorRepo", () => {
  let tempDir: string;
  let db: ReturnType<typeof openDatabase>;
  let supervisorRepo: SupervisorRepo;
  let cycleRepo: SupervisorCycleRepo;
  let attemptRepo: SupervisorCycleAttemptRepo;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "supervisor-repo-"));
    db = openDatabase(join(tempDir, "test.db"));

    db.prepare(
      "INSERT INTO workspaces (id, path, target_runtime, opened_at, last_active_at, ui_state) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("ws-1", tempDir, "native", 1, 1, "{}");
    db.prepare(
      "INSERT INTO terminals (id, workspace_id, kind, cwd, argv, cols, rows, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("term-1", "ws-1", "agent", tempDir, "[]", 120, 30, 1);
    db.prepare(
      "INSERT INTO sessions (id, workspace_id, terminal_id, provider_id, capability, state, started_at, last_active_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("sess-1", "ws-1", "term-1", "claude", "full", "idle", 1, 1);

    supervisorRepo = new SupervisorRepo(db);
    cycleRepo = new SupervisorCycleRepo(db);
    attemptRepo = new SupervisorCycleAttemptRepo(db);
  });

  afterEach(() => {
    closeDatabase(db);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("persists evaluatorProviderId and lastEvaluatedTurnId", () => {
    supervisorRepo.create({
      id: "sup-1",
      sessionId: "sess-1",
      workspaceId: "ws-1",
      targetId: "target-1",
      state: "idle",
      objective: "Finish supervisor persistence",
      evaluatorProviderId: "codex",
      lastEvaluatedTurnId: "turn-7",
      createdAt: 10,
      updatedAt: 10,
    });

    const stored = supervisorRepo.getBySessionId("sess-1");
    expect(stored?.evaluatorProviderId).toBe("codex");
    expect(stored?.lastEvaluatedTurnId).toBe("turn-7");
  });

  it("persists supervisor execution policy fields", () => {
    supervisorRepo.create({
      id: "sup-1",
      sessionId: "sess-1",
      workspaceId: "ws-1",
      targetId: "target-initial",
      state: "stopped",
      objective: "Stop when objective is complete",
      evaluatorProviderId: "codex",
      evaluatorModel: "gpt-5",
      maxSupervisionCount: 8,
      completedSupervisionCount: 3,
      scheduledAt: 1234,
      stopReason: "objective_complete",
      createdAt: 10,
      updatedAt: 11,
    });

    const stored = supervisorRepo.findById("sup-1");
    expect(stored).toMatchObject({
      state: "stopped",
      evaluatorModel: "gpt-5",
      maxSupervisionCount: 8,
      completedSupervisionCount: 3,
      scheduledAt: 1234,
      stopReason: "objective_complete",
    });
  });

  it("persists targetId on create and update", () => {
    supervisorRepo.create({
      id: "sup-1",
      sessionId: "sess-1",
      workspaceId: "ws-1",
      targetId: "target-alpha",
      state: "idle",
      objective: "Track target scope",
      evaluatorProviderId: "codex",
      createdAt: 10,
      updatedAt: 10,
    });

    const created = supervisorRepo.findById("sup-1");
    expect(created?.targetId).toBe("target-alpha");

    const updated = supervisorRepo.update("sup-1", {
      targetId: "target-beta",
      updatedAt: 11,
    });

    expect(updated.targetId).toBe("target-beta");
    expect(supervisorRepo.findById("sup-1")?.targetId).toBe("target-beta");
  });

  it("rejects a supervisor whose workspace does not match its session workspace", () => {
    db.prepare(
      "INSERT INTO workspaces (id, path, target_runtime, opened_at, last_active_at, ui_state) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("ws-2", join(tempDir, "ws-2"), "native", 2, 2, "{}");
    db.prepare(
      "INSERT INTO terminals (id, workspace_id, kind, cwd, argv, cols, rows, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("term-2", "ws-2", "agent", tempDir, "[]", 120, 30, 2);
    db.prepare(
      "INSERT INTO sessions (id, workspace_id, terminal_id, provider_id, capability, state, started_at, last_active_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("sess-2", "ws-2", "term-2", "codex", "full", "idle", 2, 2);

    expect(() =>
      supervisorRepo.create({
        id: "sup-bad",
        sessionId: "sess-2",
        workspaceId: "ws-1",
        targetId: "target-bad",
        state: "idle",
        objective: "This insert must fail",
        evaluatorProviderId: "claude",
        createdAt: 10,
        updatedAt: 10,
      })
    ).toThrow();
  });

  it("rejects a cycle whose session does not match its supervisor session", () => {
    db.prepare(
      "INSERT INTO terminals (id, workspace_id, kind, cwd, argv, cols, rows, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("term-2", "ws-1", "agent", tempDir, "[]", 120, 30, 2);
    db.prepare(
      "INSERT INTO sessions (id, workspace_id, terminal_id, provider_id, capability, state, started_at, last_active_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("sess-2", "ws-1", "term-2", "codex", "full", "idle", 2, 2);

    supervisorRepo.create({
      id: "sup-1",
      sessionId: "sess-1",
      workspaceId: "ws-1",
      targetId: "target-1",
      state: "idle",
      objective: "Enforce supervisor/session integrity",
      evaluatorProviderId: "claude",
      createdAt: 10,
      updatedAt: 10,
    });

    expect(() =>
      cycleRepo.create({
        id: "cycle-bad",
        supervisorId: "sup-1",
        sessionId: "sess-2",
        status: "completed",
        trigger: "manual",
        evidenceSource: "headless_snapshot",
        objective: "This insert must fail",
        evaluatorProviderId: "claude",
        createdAt: 11,
        completedAt: 11,
      })
    ).toThrow();
  });

  it("preserves omitted nullable supervisor fields during update", () => {
    supervisorRepo.create({
      id: "sup-1",
      sessionId: "sess-1",
      workspaceId: "ws-1",
      targetId: "target-1",
      state: "idle",
      objective: "Keep nullable fields intact",
      evaluatorProviderId: "claude",
      lastCycleAt: 21,
      lastEvaluatedTurnId: "turn-21",
      errorReason: "needs review",
      createdAt: 10,
      updatedAt: 10,
    });

    const updated = supervisorRepo.update("sup-1", {
      state: "paused",
      updatedAt: 11,
    });

    expect(updated.state).toBe("paused");
    expect(updated.lastCycleAt).toBe(21);
    expect(updated.lastEvaluatedTurnId).toBe("turn-21");
    expect(updated.errorReason).toBe("needs review");
  });

  it("can clear nullable supervisor fields when explicit null is passed", () => {
    supervisorRepo.create({
      id: "sup-1",
      sessionId: "sess-1",
      workspaceId: "ws-1",
      targetId: "target-1",
      state: "idle",
      objective: "Clear nullable fields",
      evaluatorProviderId: "claude",
      lastCycleAt: 21,
      lastEvaluatedTurnId: "turn-21",
      errorReason: "needs review",
      createdAt: 10,
      updatedAt: 10,
    });

    const updated = supervisorRepo.update("sup-1", {
      lastCycleAt: null,
      lastEvaluatedTurnId: null,
      errorReason: null,
      updatedAt: 11,
    });

    expect(updated.lastCycleAt).toBeUndefined();
    expect(updated.lastEvaluatedTurnId).toBeUndefined();
    expect(updated.errorReason).toBeUndefined();
  });

  it("can clear nullable execution policy fields when explicit null is passed", () => {
    supervisorRepo.create({
      id: "sup-1",
      sessionId: "sess-1",
      workspaceId: "ws-1",
      targetId: "target-1",
      state: "idle",
      objective: "Clear execution policy fields",
      evaluatorProviderId: "claude",
      evaluatorModel: "gpt-5-mini",
      maxSupervisionCount: 6,
      completedSupervisionCount: 2,
      scheduledAt: 45,
      stopReason: "max_supervision_count_reached",
      createdAt: 10,
      updatedAt: 10,
    });

    const updated = supervisorRepo.update("sup-1", {
      evaluatorModel: null,
      scheduledAt: null,
      stopReason: null,
      updatedAt: 11,
    });

    expect(updated.evaluatorModel).toBeUndefined();
    expect(updated.maxSupervisionCount).toBe(6);
    expect(updated.completedSupervisionCount).toBe(2);
    expect(updated.scheduledAt).toBeUndefined();
    expect(updated.stopReason).toBeUndefined();
  });

  it("preserves omitted cycle fields during update", () => {
    supervisorRepo.create({
      id: "sup-1",
      sessionId: "sess-1",
      workspaceId: "ws-1",
      targetId: "target-1",
      state: "idle",
      objective: "Keep cycle fields intact",
      evaluatorProviderId: "claude",
      createdAt: 10,
      updatedAt: 10,
    });
    cycleRepo.create({
      id: "cycle-1",
      supervisorId: "sup-1",
      sessionId: "sess-1",
      status: "evaluating",
      trigger: "manual",
      evidenceSource: "headless_snapshot",
      objective: "Keep cycle fields intact",
      evaluatorProviderId: "claude",
      progress: 40,
      result: "working",
      injectedGuidance: "stay focused",
      errorReason: "temporary",
      createdAt: 10,
      completedAt: 12,
    });

    const updated = cycleRepo.update("cycle-1", {
      status: "completed",
    });

    expect(updated.status).toBe("completed");
    expect(updated.progress).toBe(40);
    expect(updated.result).toBe("working");
    expect(updated.injectedGuidance).toBe("stay focused");
    expect(updated.errorReason).toBe("temporary");
    expect(updated.completedAt).toBe(12);
  });

  it("can clear nullable cycle fields when explicit null is passed", () => {
    supervisorRepo.create({
      id: "sup-1",
      sessionId: "sess-1",
      workspaceId: "ws-1",
      targetId: "target-1",
      state: "idle",
      objective: "Clear cycle fields",
      evaluatorProviderId: "claude",
      createdAt: 10,
      updatedAt: 10,
    });
    cycleRepo.create({
      id: "cycle-1",
      supervisorId: "sup-1",
      sessionId: "sess-1",
      status: "evaluating",
      trigger: "manual",
      evidenceSource: "headless_snapshot",
      objective: "Clear cycle fields",
      evaluatorProviderId: "claude",
      progress: 40,
      result: "working",
      injectedGuidance: "stay focused",
      errorReason: "temporary",
      createdAt: 10,
      completedAt: 12,
    });

    const updated = cycleRepo.update("cycle-1", {
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

  it("throws when updating a missing supervisor row", () => {
    expect(() =>
      supervisorRepo.update("missing-supervisor", {
        state: "paused",
        updatedAt: 12,
      })
    ).toThrow(/missing-supervisor/);
  });

  it("throws when updating a missing supervisor cycle row", () => {
    expect(() =>
      cycleRepo.update("missing-cycle", {
        status: "failed",
      })
    ).toThrow(/missing-cycle/);
  });

  it("prunes cycles beyond max retention", () => {
    supervisorRepo.create({
      id: "sup-1",
      sessionId: "sess-1",
      workspaceId: "ws-1",
      targetId: "target-1",
      state: "idle",
      objective: "Keep the newest 100 cycles",
      evaluatorProviderId: "claude",
      createdAt: 10,
      updatedAt: 10,
    });

    for (let i = 0; i < 101; i += 1) {
      cycleRepo.create({
        id: `cycle-${i}`,
        supervisorId: "sup-1",
        sessionId: "sess-1",
        status: "completed",
        trigger: "manual",
        evidenceSource: "headless_snapshot",
        objective: "Keep the newest 100 cycles",
        evaluatorProviderId: "claude",
        createdAt: i,
        completedAt: i,
      });
    }

    cycleRepo.pruneOldest("sup-1", 100);

    const cycles = cycleRepo.listRecentForSupervisor("sup-1", 200);
    expect(cycles).toHaveLength(100);
    expect(cycles.some((cycle) => cycle.id === "cycle-0")).toBe(false);
    expect(cycles[0]?.id).toBe("cycle-100");
  });

  it("accepts new cycle enum values", () => {
    supervisorRepo.create({
      id: "sup-1",
      sessionId: "sess-1",
      workspaceId: "ws-1",
      targetId: "target-1",
      state: "idle",
      objective: "Allow scheduled cancelled cycle",
      evaluatorProviderId: "claude",
      createdAt: 10,
      updatedAt: 10,
    });

    const cycle = cycleRepo.create({
      id: "cycle-1",
      supervisorId: "sup-1",
      sessionId: "sess-1",
      status: "cancelled",
      trigger: "scheduled",
      evidenceSource: "headless_snapshot",
      objective: "Allow scheduled cancelled cycle",
      evaluatorProviderId: "claude",
      createdAt: 12,
    });

    expect(cycle.status).toBe("cancelled");
    expect(cycle.trigger).toBe("scheduled");
  });

  it("stores attempts ordered by attemptIndex ascending", () => {
    supervisorRepo.create({
      id: "sup-1",
      sessionId: "sess-1",
      workspaceId: "ws-1",
      targetId: "target-1",
      state: "idle",
      objective: "Track attempts",
      evaluatorProviderId: "claude",
      createdAt: 10,
      updatedAt: 10,
    });
    cycleRepo.create({
      id: "cycle-1",
      supervisorId: "sup-1",
      sessionId: "sess-1",
      status: "evaluating",
      trigger: "manual",
      evidenceSource: "headless_snapshot",
      objective: "Track attempts",
      evaluatorProviderId: "claude",
      createdAt: 10,
    });

    attemptRepo.create({
      id: "attempt-2",
      cycleId: "cycle-1",
      attemptIndex: 2,
      status: "failed",
      startedAt: 30,
      completedAt: 31,
      errorReason: "second failed",
      providerModel: "gpt-5-mini",
    });
    attemptRepo.create({
      id: "attempt-0",
      cycleId: "cycle-1",
      attemptIndex: 0,
      status: "completed",
      startedAt: 10,
      completedAt: 11,
      providerModel: "gpt-5",
    });
    attemptRepo.create({
      id: "attempt-1",
      cycleId: "cycle-1",
      attemptIndex: 1,
      status: "cancelled",
      startedAt: 20,
      completedAt: 21,
      errorReason: "interrupted",
    });

    const attempts = attemptRepo.listForCycle("cycle-1");
    expect(attempts.map((attempt) => attempt.id)).toEqual(["attempt-0", "attempt-1", "attempt-2"]);
    expect(attempts.map((attempt) => attempt.attemptIndex)).toEqual([0, 1, 2]);
  });

  it("updates attempts and clears nullable fields", () => {
    supervisorRepo.create({
      id: "sup-1",
      sessionId: "sess-1",
      workspaceId: "ws-1",
      targetId: "target-1",
      state: "idle",
      objective: "Update attempts",
      evaluatorProviderId: "claude",
      createdAt: 10,
      updatedAt: 10,
    });
    cycleRepo.create({
      id: "cycle-1",
      supervisorId: "sup-1",
      sessionId: "sess-1",
      status: "evaluating",
      trigger: "manual",
      evidenceSource: "headless_snapshot",
      objective: "Update attempts",
      evaluatorProviderId: "claude",
      createdAt: 10,
    });
    attemptRepo.create({
      id: "attempt-1",
      cycleId: "cycle-1",
      attemptIndex: 0,
      status: "failed",
      startedAt: 20,
      completedAt: 21,
      errorReason: "transient",
      providerModel: "gpt-5-mini",
    });

    const updated = attemptRepo.update("attempt-1", {
      status: "completed",
      completedAt: null,
      errorReason: null,
      providerModel: null,
    });

    expect(updated.status).toBe("completed");
    expect(updated.completedAt).toBeUndefined();
    expect(updated.errorReason).toBeUndefined();
    expect(updated.providerModel).toBeUndefined();
  });
});
