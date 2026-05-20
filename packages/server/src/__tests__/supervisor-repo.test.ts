import { describe, expect, it } from "vitest";
import { SupervisorRepo } from "../storage/index.js";

describe("SupervisorRepo", () => {
  it("stores and looks up supervisors in memory", () => {
    const repo = new SupervisorRepo();

    repo.create({
      id: "sup-1",
      sessionId: "sess-1",
      workspaceId: "ws-1",
      state: "idle",
      objective: "Finish supervisor persistence",
      evaluatorProviderId: "codex",
      lastEvaluatedTurnId: "turn-7",
      createdAt: 10,
      updatedAt: 10,
      maxSupervisionCount: 0,
      completedSupervisionCount: 0,
    });

    expect(repo.findById("sup-1")).toMatchObject({
      id: "sup-1",
      sessionId: "sess-1",
      workspaceId: "ws-1",
      targetId: "sup-1",
      evaluatorProviderId: "codex",
      lastEvaluatedTurnId: "turn-7",
    });
    expect(repo.getBySessionId("sess-1")?.id).toBe("sup-1");
  });

  it("updates supervisors and preserves omitted nullable fields", () => {
    const repo = new SupervisorRepo();

    repo.create({
      id: "sup-1",
      sessionId: "sess-1",
      workspaceId: "ws-1",
      state: "idle",
      objective: "Keep nullable fields intact",
      evaluatorProviderId: "claude",
      lastCycleAt: 21,
      lastEvaluatedTurnId: "turn-21",
      errorReason: "needs review",
      createdAt: 10,
      updatedAt: 10,
      maxSupervisionCount: 0,
      completedSupervisionCount: 0,
    });

    const updated = repo.update("sup-1", {
      state: "paused",
      updatedAt: 11,
    });

    expect(updated.state).toBe("paused");
    expect(updated.lastCycleAt).toBe(21);
    expect(updated.lastEvaluatedTurnId).toBe("turn-21");
    expect(updated.errorReason).toBe("needs review");
  });

  it("can clear nullable execution policy fields when explicit null is passed", () => {
    const repo = new SupervisorRepo();

    repo.create({
      id: "sup-1",
      sessionId: "sess-1",
      workspaceId: "ws-1",
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

    const updated = repo.update("sup-1", {
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

  it("lists supervisors in created order and deletes them", () => {
    const repo = new SupervisorRepo();

    repo.create({
      id: "sup-1",
      sessionId: "sess-1",
      workspaceId: "ws-1",
      state: "idle",
      objective: "First",
      evaluatorProviderId: "claude",
      createdAt: 10,
      updatedAt: 10,
      maxSupervisionCount: 0,
      completedSupervisionCount: 0,
    });
    repo.create({
      id: "sup-2",
      sessionId: "sess-2",
      workspaceId: "ws-1",
      state: "paused",
      objective: "Second",
      evaluatorProviderId: "codex",
      createdAt: 20,
      updatedAt: 20,
      maxSupervisionCount: 1,
      completedSupervisionCount: 0,
    });

    expect(repo.listAll().map((supervisor) => supervisor.id)).toEqual(["sup-1", "sup-2"]);

    repo.delete("sup-1");
    expect(repo.findById("sup-1")).toBeUndefined();
    expect(repo.listAll().map((supervisor) => supervisor.id)).toEqual(["sup-2"]);
  });

  it("throws when updating a missing supervisor", () => {
    const repo = new SupervisorRepo();

    expect(() =>
      repo.update("missing-supervisor", {
        state: "paused",
        updatedAt: 12,
      })
    ).toThrow(/missing-supervisor/);
  });
});
