import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendTargetCycleRecord,
  createTargetFiles,
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
    });

    const memory = await loadTargetMemory(workspacePath, "tgt-1");

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
});
