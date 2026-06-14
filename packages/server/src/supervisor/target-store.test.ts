import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SupervisorPlanNode, SupervisorTargetMemory } from "@coder-studio/core";
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

function planRoot(children: SupervisorPlanNode[] = []): SupervisorPlanNode {
  return {
    id: "root",
    title: "Supervisor target",
    objective: "Complete the supervised target",
    deliverable: "Completed target",
    acceptanceCriteria: ["Target objective is complete"],
    status:
      children.length > 0 && children.every((child) => child.status === "done")
        ? "done"
        : children.length > 0
          ? "in_progress"
          : "pending",
    taskType: "generic",
    children,
  };
}

function targetMemory(
  targetId: string,
  overrides: Partial<SupervisorTargetMemory> = {}
): SupervisorTargetMemory {
  return {
    schemaVersion: 2,
    targetId,
    planTree: planRoot(),
    activeNodeId: undefined,
    maxDepth: 6,
    planRevision: 0,
    progressSummary: undefined,
    lastGuidance: undefined,
    stalledCount: 0,
    updatedAt: 1,
    ...overrides,
  };
}

function expectEmptyV2Memory(
  memory: SupervisorTargetMemory,
  expected: { targetId: string; updatedAt: number }
): void {
  expect(memory).toMatchObject({
    schemaVersion: 2,
    targetId: expected.targetId,
    activeNodeId: undefined,
    maxDepth: 6,
    planRevision: 0,
    stalledCount: 0,
    updatedAt: expected.updatedAt,
  });
  expect(memory.planTree.id).toMatch(/^plan_/);
  expect(memory.planTree.children).toEqual([]);
  expect(memory.planTree.status).toBe("pending");
}

describe("target store", () => {
  let workspacePath: string;

  beforeEach(() => {
    workspacePath = mkdtempSync(join(tmpdir(), "supervisor-target-store-"));
  });

  afterEach(() => {
    rmSync(workspacePath, { recursive: true, force: true });
  });

  it("creates target metadata with an empty v2 plan tree before first trigger", async () => {
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
    expectEmptyV2Memory(memory, { targetId: "tgt-1", updatedAt: 1 });
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
      ...targetMemory("tgt-1", {
        planTree: planRoot([
          {
            id: "stage-1",
            title: "Old step",
            objective: "Keep the old scope",
            deliverable: "The legacy stage remains intact",
            acceptanceCriteria: ["Legacy stage is preserved"],
            status: "in_progress",
            taskType: "generic",
            children: [],
          },
        ]),
        activeNodeId: "stage-1",
        planRevision: 1,
        updatedAt: 2,
      }),
      progressSummary: "In progress",
      lastGuidance: "Do old thing",
      stalledCount: 1,
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
    expectEmptyV2Memory(memory, { targetId: "tgt-1", updatedAt: 3 });
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
      ...targetMemory("tgt-1", {
        planTree: planRoot([
          {
            id: "stage-1",
            title: "Keep this",
            objective: "Preserve the existing decomposition",
            deliverable: "The existing decomposition item remains unchanged",
            acceptanceCriteria: ["Existing decomposition item remains"],
            status: "in_progress",
            taskType: "generic",
            children: [],
          },
        ]),
        activeNodeId: "stage-1",
        updatedAt: 2,
      }),
      progressSummary: "Existing progress",
      lastGuidance: "Do not reset",
      stalledCount: 2,
    });

    await createTargetFiles(workspacePath, {
      targetId: "tgt-1",
      sessionId: "sess-1",
      workspaceId: "ws-1",
      objective: "New objective",
      createdAt: 3,
    });

    const memory = await loadTargetMemory(workspacePath, "tgt-1");
    expect(memory).toMatchObject({
      schemaVersion: 2,
      targetId: "tgt-1",
      activeNodeId: "stage-1",
      progressSummary: "Existing progress",
      lastGuidance: "Do not reset",
      stalledCount: 2,
      updatedAt: 2,
    });
    expect(memory.planTree.children[0]?.id).toBe("stage-1");
  });

  it("does not convert legacy flat plan memory into the v2 tree", async () => {
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
    const rootId = memory.planTree?.id ?? "";
    expect(rootId).toMatch(/^plan_/);

    expect(memory).toMatchObject({
      schemaVersion: 2,
      targetId: "tgt-legacy",
      activeNodeId: undefined,
      planRevision: 0,
      progressSummary: "Legacy plan is mid-flight",
      lastGuidance: "Follow the existing implementation path",
      stalledCount: 3,
      updatedAt: 42,
    });
    expect(memory.planTree.id).toBe(rootId);
    expect(memory.planTree.children).toEqual([]);
  });

  it("falls back to default metadata and memory when persisted JSON is corrupted", async () => {
    await createTargetFiles(workspacePath, {
      targetId: "tgt-corrupt",
      sessionId: "sess-1",
      workspaceId: "ws-1",
      objective: "Corrupt state",
      createdAt: 1,
    });

    const targetRoot = join(workspacePath, ".coder-studio", "supervisor", "targets", "tgt-corrupt");
    writeFileSync(join(targetRoot, "meta.json"), "{broken", "utf8");
    writeFileSync(join(targetRoot, "memory.json"), "{broken", "utf8");
    writeFileSync(
      join(targetRoot, "cycles.jsonl"),
      '{"cycleId":"ok","targetId":"tgt-corrupt","startedAt":1,"completedAt":2,"result":"continue","attemptCount":1}\n{broken}\n',
      "utf8"
    );

    await expect(readTargetMeta(workspacePath, "tgt-corrupt")).resolves.toEqual({
      targetId: "tgt-corrupt",
      sessionId: "",
      workspaceId: "",
      objective: "",
      status: "active",
      createdAt: 0,
      updatedAt: 0,
      supersededBy: null,
      completedAt: null,
      supervisor: undefined,
    });

    const memory = await loadTargetMemory(workspacePath, "tgt-corrupt");
    expectEmptyV2Memory(memory, { targetId: "tgt-corrupt", updatedAt: 0 });

    await expect(readTargetCycleRecords(workspacePath, "tgt-corrupt")).resolves.toEqual([
      expect.objectContaining({
        cycleId: "ok",
      }),
    ]);
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
      ...targetMemory("tgt-1", {
        updatedAt: 5,
      }),
      progressSummary: "Halfway there",
      lastGuidance: "Keep going",
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

  it("does not count failed evaluation records in recoverable target cycle totals", async () => {
    await createTargetFiles(workspacePath, {
      targetId: "tgt-1",
      sessionId: "sess-1",
      workspaceId: "ws-1",
      objective: "Recover this target",
      createdAt: 1,
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
    await appendTargetCycleRecord(workspacePath, "tgt-1", {
      cycleId: "cycle-2",
      targetId: "tgt-1",
      startedAt: 3,
      completedAt: 4,
      result: "error",
      errorReason: "Evaluator exploded",
      attemptCount: 1,
    });

    const targets = await listRecoverableTargets(workspacePath);

    expect(targets[0]?.cycleCount).toBe(1);
  });

  it("ignores backup and reset staging directories when listing recoverable targets", async () => {
    await createTargetFiles(workspacePath, {
      targetId: "tgt-1",
      sessionId: "sess-1",
      workspaceId: "ws-1",
      objective: "Recover this target",
      createdAt: 1,
    });

    const targetsDir = join(workspacePath, ".coder-studio", "supervisor", "targets");
    mkdirSync(join(targetsDir, "tgt-1.backup-123"), { recursive: true });
    mkdirSync(join(targetsDir, "tgt-1.reset-456"), { recursive: true });
    writeFileSync(
      join(targetsDir, "tgt-1.backup-123", "meta.json"),
      JSON.stringify({ targetId: "tgt-1.backup-123", updatedAt: 999 }),
      "utf8"
    );
    writeFileSync(
      join(targetsDir, "tgt-1.reset-456", "meta.json"),
      JSON.stringify({ targetId: "tgt-1.reset-456", updatedAt: 998 }),
      "utf8"
    );

    const targets = await listRecoverableTargets(workspacePath);

    expect(targets).toHaveLength(1);
    expect(targets[0]?.targetId).toBe("tgt-1");
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
      schemaVersion: 2,
      targetId: "tgt-old",
      planTree: {
        id: "tgt-old-root",
        title: "Supervisor target",
        objective: "Complete the supervised target",
        deliverable: "Completed target",
        acceptanceCriteria: ["Target objective is complete"],
        status: "done",
        taskType: "generic",
        children: [
          {
            id: "stage-1",
            title: "Keep state",
            objective: "Preserve old progress",
            deliverable: "Old state copied",
            acceptanceCriteria: ["State remains"],
            status: "done",
            taskType: "generic",
            children: [],
          },
        ],
      },
      activeNodeId: "stage-1",
      progressSummary: "Preserve me",
      lastGuidance: "Do not lose state",
      maxDepth: 6,
      planRevision: 0,
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
    expect(memory.planTree.id).not.toBe("tgt-old-root");
    expect(memory.planTree.id).toMatch(/^plan_/);
    expect(memory.planTree.children[0]?.id).toBe("stage-1");
    expect(memory.activeNodeId).toBe("stage-1");
    expect(memory.progressSummary).toBe("Preserve me");
    expect(cycles).toEqual([
      expect.objectContaining({
        cycleId: "cycle-1",
        targetId: "tgt-new",
      }),
    ]);
  });

  it("returns only non-error cycle records when cloning target files", async () => {
    await createTargetFiles(workspacePath, {
      targetId: "tgt-old",
      sessionId: "sess-old",
      workspaceId: "ws-1",
      objective: "Old objective",
      createdAt: 10,
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
    await appendTargetCycleRecord(workspacePath, "tgt-old", {
      cycleId: "cycle-2",
      targetId: "tgt-old",
      startedAt: 12,
      completedAt: 13,
      result: "error",
      errorReason: "Evaluator exploded",
      attemptCount: 1,
    });

    const cycleCount = await cloneTargetFiles(workspacePath, {
      sourceTargetId: "tgt-old",
      targetId: "tgt-new",
      sessionId: "sess-new",
      workspaceId: "ws-2",
      objective: "New objective",
      createdAt: 20,
    });

    expect(cycleCount).toBe(1);
    expect(await readTargetCycleRecords(workspacePath, "tgt-new")).toEqual([
      expect.objectContaining({
        cycleId: "cycle-2",
        result: "error",
        targetId: "tgt-new",
      }),
      expect.objectContaining({
        cycleId: "cycle-1",
        result: "continue",
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
