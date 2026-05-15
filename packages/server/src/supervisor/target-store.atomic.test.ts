import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const renameState = vi.hoisted(() => ({
  callCount: 0,
  failOnCall: 0,
}));

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return {
    ...actual,
    rename: vi.fn(async (from: string, to: string) => {
      renameState.callCount += 1;
      if (renameState.failOnCall !== 0 && renameState.callCount === renameState.failOnCall) {
        throw new Error("promote failed");
      }
      return actual.rename(from, to);
    }),
  };
});

import {
  appendTargetCycleRecord,
  createTargetFiles,
  loadTargetMemory,
  readTargetCycleRecords,
  readTargetMeta,
  resetTargetFiles,
  saveTargetMemory,
} from "./target-store.js";

describe("target store atomic reset", () => {
  let workspacePath: string;

  beforeEach(() => {
    workspacePath = mkdtempSync(join(tmpdir(), "supervisor-target-store-atomic-"));
    renameState.callCount = 0;
    renameState.failOnCall = 0;
  });

  afterEach(() => {
    rmSync(workspacePath, { recursive: true, force: true });
  });

  it("restores the existing target files if promotion fails during reset", async () => {
    await createTargetFiles(workspacePath, {
      targetId: "tgt-1",
      sessionId: "sess-1",
      workspaceId: "ws-1",
      objective: "Old objective",
      createdAt: 1,
    });

    await saveTargetMemory(workspacePath, "tgt-1", {
      targetId: "tgt-1",
      planGenerated: true,
      plan: [{ id: "step-1", title: "Old step", status: "in_progress" }],
      activeStepId: "step-1",
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

    renameState.failOnCall = 2;

    await expect(
      resetTargetFiles(workspacePath, {
        targetId: "tgt-1",
        sessionId: "sess-1",
        workspaceId: "ws-1",
        objective: "New objective",
        createdAt: 3,
      })
    ).rejects.toThrow("promote failed");

    const meta = await readTargetMeta(workspacePath, "tgt-1");
    const memory = await loadTargetMemory(workspacePath, "tgt-1");
    const cycles = await readTargetCycleRecords(workspacePath, "tgt-1");

    expect(meta.objective).toBe("Old objective");
    expect(memory).toMatchObject({
      targetId: "tgt-1",
      planGenerated: true,
      activeStepId: "step-1",
      progressSummary: "In progress",
      lastGuidance: "Do old thing",
      stalledCount: 1,
      updatedAt: 2,
    });
    expect(cycles).toMatchObject([
      {
        cycleId: "cycle-1",
        guidance: "Do the old thing",
      },
    ]);
  });
});
