import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendTargetCycleRecord,
  cloneTargetFiles,
  createTargetFiles,
  deleteTarget,
  listRecoverableTargets,
  loadTargetMemory,
  readTargetCycleRecords,
  readTargetMeta,
  resetTargetFiles,
  saveTargetMemory,
} from "./target-store.js";

describe("target store", () => {
  let workspacePath: string;

  beforeEach(() => {
    workspacePath = mkdtempSync(join(tmpdir(), "supervisor-target-store-"));
  });

  afterEach(() => {
    rmSync(workspacePath, { recursive: true, force: true });
  });

  it("creates target metadata with decompositionGenerated=false before first trigger", async () => {
    await createTargetFiles(workspacePath, {
      targetId: "tgt-1",
      sessionId: "sess-1",
      workspaceId: "ws-1",
      objective: "Ship feature",
      createdAt: 1,
      supervisor: {
        id: "sup-1",
        sessionId: "sess-1",
        workspaceId: "ws-1",
        targetId: "tgt-1",
        state: "idle",
        objective: "Ship feature",
        evaluatorProviderId: "codex",
        evaluatorModel: "gpt-test",
        maxSupervisionCount: 3,
        completedSupervisionCount: 1,
        scheduledAt: 9,
        stopReason: undefined,
        lastCycleAt: 8,
        lastEvaluatedTurnId: "turn-1",
        errorReason: undefined,
        createdAt: 1,
        updatedAt: 2,
      },
    });

    const meta = await readTargetMeta(workspacePath, "tgt-1");
    const memory = await loadTargetMemory(workspacePath, "tgt-1");

    expect(meta.supervisor).toEqual({
      id: "sup-1",
      sessionId: "sess-1",
      workspaceId: "ws-1",
      targetId: "tgt-1",
      state: "idle",
      objective: "Ship feature",
      evaluatorProviderId: "codex",
      evaluatorModel: "gpt-test",
      maxSupervisionCount: 3,
      completedSupervisionCount: 1,
      scheduledAt: 9,
      stopReason: undefined,
      lastCycleAt: 8,
      lastEvaluatedTurnId: "turn-1",
      errorReason: undefined,
      createdAt: 1,
      updatedAt: 2,
    });
    expect(memory).toEqual({
      targetId: "tgt-1",
      decompositionGenerated: false,
      decompositionMode: undefined,
      items: [],
      activeItemId: undefined,
      progressSummary: undefined,
      lastGuidance: undefined,
      stalledCount: 0,
      updatedAt: 1,
    });
  });

  it("appends cycle records as newline-delimited json", async () => {
    await createTargetFiles(workspacePath, {
      targetId: "tgt-1",
      sessionId: "sess-1",
      workspaceId: "ws-1",
      objective: "Ship feature",
      createdAt: 1,
    });

    await appendTargetCycleRecord(workspacePath, "tgt-1", {
      cycleId: "cycle-1",
      targetId: "tgt-1",
      startedAt: 1,
      completedAt: 2,
      result: "continue",
      reason: "Need one more implementation step",
      guidance: "Implement the store",
      injected: true,
      attemptCount: 1,
    });

    const lines = await readTargetCycleRecords(workspacePath, "tgt-1");
    expect(lines).toHaveLength(1);
    expect(lines[0]?.guidance).toBe("Implement the store");
  });

  it("resets target files in place when the objective changes", async () => {
    await createTargetFiles(workspacePath, {
      targetId: "tgt-1",
      sessionId: "sess-1",
      workspaceId: "ws-1",
      objective: "Old objective",
      createdAt: 1,
    });

    await saveTargetMemory(workspacePath, "tgt-1", {
      targetId: "tgt-1",
      decompositionGenerated: true,
      decompositionMode: "stage",
      items: [
        {
          id: "stage-1",
          kind: "stage",
          title: "Old step",
          objective: "Keep the old scope",
          deliverable: "The legacy stage remains intact",
          acceptanceCriteria: ["Legacy stage is preserved"],
          status: "in_progress",
        },
      ],
      activeItemId: "stage-1",
      progressSummary: "In progress",
      lastGuidance: "Do old thing",
      stalledCount: 1,
      updatedAt: 2,
    });

    await appendTargetCycleRecord(workspacePath, "tgt-1", {
      cycleId: "cycle-1",
      targetId: "tgt-1",
      startedAt: 1,
      completedAt: 2,
      result: "continue",
      reason: "Stale progress",
      guidance: "Do the old thing",
      injected: true,
      attemptCount: 1,
    });

    await resetTargetFiles(workspacePath, {
      targetId: "tgt-1",
      sessionId: "sess-1",
      workspaceId: "ws-1",
      objective: "New objective",
      createdAt: 3,
    });

    const meta = await readTargetMeta(workspacePath, "tgt-1");
    const memory = await loadTargetMemory(workspacePath, "tgt-1");
    const cycles = await readTargetCycleRecords(workspacePath, "tgt-1");

    expect(meta).toEqual({
      targetId: "tgt-1",
      sessionId: "sess-1",
      workspaceId: "ws-1",
      objective: "New objective",
      status: "active",
      createdAt: 3,
      updatedAt: 3,
      supersededBy: null,
      completedAt: null,
    });
    expect(memory).toEqual({
      targetId: "tgt-1",
      decompositionGenerated: false,
      decompositionMode: undefined,
      items: [],
      activeItemId: undefined,
      progressSummary: undefined,
      lastGuidance: undefined,
      stalledCount: 0,
      updatedAt: 3,
    });
    expect(cycles).toEqual([]);
  });

  it("does not overwrite existing memory when createTargetFiles is called for an existing target", async () => {
    await createTargetFiles(workspacePath, {
      targetId: "tgt-1",
      sessionId: "sess-1",
      workspaceId: "ws-1",
      objective: "Old objective",
      createdAt: 1,
    });

    await saveTargetMemory(workspacePath, "tgt-1", {
      targetId: "tgt-1",
      decompositionGenerated: true,
      decompositionMode: "stage",
      items: [
        {
          id: "stage-1",
          kind: "stage",
          title: "Keep this",
          objective: "Preserve the existing decomposition",
          deliverable: "The existing decomposition item remains unchanged",
          acceptanceCriteria: ["Existing decomposition item remains"],
          status: "in_progress",
        },
      ],
      activeItemId: "stage-1",
      progressSummary: "Existing progress",
      lastGuidance: "Do not reset",
      stalledCount: 2,
      updatedAt: 2,
    });

    await createTargetFiles(workspacePath, {
      targetId: "tgt-1",
      sessionId: "sess-1",
      workspaceId: "ws-1",
      objective: "New objective",
      createdAt: 3,
    });

    const memory = await loadTargetMemory(workspacePath, "tgt-1");
    expect(memory).toEqual({
      targetId: "tgt-1",
      decompositionGenerated: true,
      decompositionMode: "stage",
      items: [
        {
          id: "stage-1",
          kind: "stage",
          title: "Keep this",
          objective: "Preserve the existing decomposition",
          deliverable: "The existing decomposition item remains unchanged",
          acceptanceCriteria: ["Existing decomposition item remains"],
          status: "in_progress",
        },
      ],
      activeItemId: "stage-1",
      progressSummary: "Existing progress",
      lastGuidance: "Do not reset",
      stalledCount: 2,
      updatedAt: 2,
    });
  });

  it("normalizes legacy plan memory into stage decomposition items", async () => {
    await createTargetFiles(workspacePath, {
      targetId: "tgt-legacy",
      sessionId: "sess-1",
      workspaceId: "ws-1",
      objective: "Legacy objective",
      createdAt: 1,
    });

    writeFileSync(
      join(workspacePath, ".coder-studio", "supervisor", "targets", "tgt-legacy", "memory.json"),
      JSON.stringify(
        {
          targetId: "tgt-legacy",
          planGenerated: true,
          plan: [
            {
              id: "step-1",
              title: "Inspect current behavior",
              status: "done",
            },
            {
              id: "step-2",
              title: "Implement decomposition flow",
              status: "in_progress",
            },
          ],
          activeStepId: "step-2",
          progressSummary: "Legacy plan is mid-flight",
          lastGuidance: "Follow the existing implementation path",
          stalledCount: 3,
          updatedAt: 42,
        },
        null,
        2
      ) + "\n",
      "utf-8"
    );

    const memory = await loadTargetMemory(workspacePath, "tgt-legacy");

    expect(memory).toEqual({
      targetId: "tgt-legacy",
      decompositionGenerated: true,
      decompositionMode: "stage",
      items: [
        {
          id: "step-1",
          kind: "stage",
          title: "Inspect current behavior",
          objective: "Inspect current behavior",
          deliverable: "Inspect current behavior completed",
          acceptanceCriteria: ["Inspect current behavior is complete"],
          status: "done",
        },
        {
          id: "step-2",
          kind: "stage",
          title: "Implement decomposition flow",
          objective: "Implement decomposition flow",
          deliverable: "Implement decomposition flow completed",
          acceptanceCriteria: ["Implement decomposition flow is complete"],
          status: "in_progress",
        },
      ],
      activeItemId: "step-2",
      progressSummary: "Legacy plan is mid-flight",
      lastGuidance: "Follow the existing implementation path",
      stalledCount: 3,
      updatedAt: 42,
    });
  });

  it("lists recoverable targets with summary details", async () => {
    await createTargetFiles(workspacePath, {
      targetId: "tgt-1",
      sessionId: "sess-1",
      workspaceId: "ws-1",
      objective: "Recover this target",
      createdAt: 1,
    });

    await saveTargetMemory(workspacePath, "tgt-1", {
      targetId: "tgt-1",
      decompositionGenerated: true,
      decompositionMode: "stage",
      items: [],
      activeItemId: undefined,
      progressSummary: "Halfway there",
      lastGuidance: "Keep going",
      stalledCount: 0,
      updatedAt: 5,
    });

    await appendTargetCycleRecord(workspacePath, "tgt-1", {
      cycleId: "cycle-1",
      targetId: "tgt-1",
      startedAt: 1,
      completedAt: 2,
      result: "continue",
      reason: "Needs more work",
      guidance: "Continue",
      injected: true,
      attemptCount: 1,
    });

    const targets = await listRecoverableTargets(workspacePath);

    expect(targets).toEqual([
      {
        targetId: "tgt-1",
        sessionId: "sess-1",
        workspaceId: "ws-1",
        objective: "Recover this target",
        status: "active",
        updatedAt: 1,
        progressSummary: "Halfway there",
        cycleCount: 1,
      },
    ]);
  });

  it("clones a target into a new target id and rewrites persisted identifiers", async () => {
    await createTargetFiles(workspacePath, {
      targetId: "tgt-old",
      sessionId: "sess-old",
      workspaceId: "ws-1",
      objective: "Old objective",
      createdAt: 10,
      supervisor: {
        id: "sup-old",
        sessionId: "sess-old",
        workspaceId: "ws-1",
        targetId: "tgt-old",
        state: "paused",
        objective: "Old objective",
        evaluatorProviderId: "codex",
        evaluatorModel: "gpt-old",
        maxSupervisionCount: 7,
        completedSupervisionCount: 4,
        scheduledAt: 77,
        stopReason: undefined,
        lastCycleAt: 12,
        lastEvaluatedTurnId: "turn-old",
        errorReason: undefined,
        createdAt: 10,
        updatedAt: 12,
      },
    });

    await saveTargetMemory(workspacePath, "tgt-old", {
      targetId: "tgt-old",
      decompositionGenerated: true,
      decompositionMode: "stage",
      items: [
        {
          id: "stage-1",
          kind: "stage",
          title: "Keep state",
          objective: "Preserve old progress",
          deliverable: "Old state copied",
          acceptanceCriteria: ["State remains"],
          status: "done",
        },
      ],
      activeItemId: "stage-1",
      progressSummary: "Preserve me",
      lastGuidance: "Do not lose state",
      stalledCount: 2,
      updatedAt: 12,
    });

    await appendTargetCycleRecord(workspacePath, "tgt-old", {
      cycleId: "cycle-1",
      targetId: "tgt-old",
      startedAt: 10,
      completedAt: 11,
      result: "continue",
      reason: "Keep copying",
      guidance: "Copy state",
      injected: true,
      attemptCount: 1,
    });

    await cloneTargetFiles(workspacePath, {
      sourceTargetId: "tgt-old",
      targetId: "tgt-new",
      sessionId: "sess-new",
      workspaceId: "ws-2",
      objective: "New objective",
      createdAt: 20,
      supervisor: {
        id: "sup-new",
        sessionId: "sess-new",
        workspaceId: "ws-2",
        targetId: "tgt-new",
        state: "idle",
        objective: "New objective",
        evaluatorProviderId: "claude",
        evaluatorModel: "gpt-new",
        maxSupervisionCount: 2,
        completedSupervisionCount: 1,
        scheduledAt: undefined,
        stopReason: undefined,
        lastCycleAt: 19,
        lastEvaluatedTurnId: "turn-new",
        errorReason: undefined,
        createdAt: 20,
        updatedAt: 21,
      },
    });

    const meta = await readTargetMeta(workspacePath, "tgt-new");
    const memory = await loadTargetMemory(workspacePath, "tgt-new");
    const cycles = await readTargetCycleRecords(workspacePath, "tgt-new");

    expect(meta).toEqual({
      targetId: "tgt-new",
      sessionId: "sess-new",
      workspaceId: "ws-2",
      objective: "New objective",
      status: "active",
      createdAt: 20,
      updatedAt: 20,
      supersededBy: null,
      completedAt: null,
      supervisor: {
        id: "sup-new",
        sessionId: "sess-new",
        workspaceId: "ws-2",
        targetId: "tgt-new",
        state: "idle",
        objective: "New objective",
        evaluatorProviderId: "claude",
        evaluatorModel: "gpt-new",
        maxSupervisionCount: 2,
        completedSupervisionCount: 1,
        scheduledAt: undefined,
        stopReason: undefined,
        lastCycleAt: 19,
        lastEvaluatedTurnId: "turn-new",
        errorReason: undefined,
        createdAt: 20,
        updatedAt: 21,
      },
    });
    expect(memory.targetId).toBe("tgt-new");
    expect(memory.progressSummary).toBe("Preserve me");
    expect(cycles).toEqual([
      expect.objectContaining({
        cycleId: "cycle-1",
        targetId: "tgt-new",
      }),
    ]);
  });

  it("deletes the source target after a successful restore", async () => {
    await createTargetFiles(workspacePath, {
      targetId: "tgt-delete",
      sessionId: "sess-1",
      workspaceId: "ws-1",
      objective: "Delete me",
      createdAt: 1,
    });

    await deleteTarget(workspacePath, "tgt-delete");

    await expect(readTargetMeta(workspacePath, "tgt-delete")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
