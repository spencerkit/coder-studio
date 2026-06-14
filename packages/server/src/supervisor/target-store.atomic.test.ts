import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fsState = vi.hoisted(() => ({
  renameCallCount: 0,
  failRenameOnCalls: [] as number[],
  rmCallCount: 0,
  failRmOnCalls: [] as number[],
}));

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return {
    ...actual,
    rename: vi.fn(async (from: string, to: string) => {
      fsState.renameCallCount += 1;
      if (fsState.failRenameOnCalls.includes(fsState.renameCallCount)) {
        throw new Error("promote failed");
      }
      return actual.rename(from, to);
    }),
    rm: vi.fn(async (...args: Parameters<typeof actual.rm>) => {
      fsState.rmCallCount += 1;
      if (fsState.failRmOnCalls.includes(fsState.rmCallCount)) {
        throw new Error("cleanup failed");
      }
      return actual.rm(...args);
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
    fsState.renameCallCount = 0;
    fsState.failRenameOnCalls = [];
    fsState.rmCallCount = 0;
    fsState.failRmOnCalls = [];
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
      supervisor: {
        id: "sup-1",
        sessionId: "sess-1",
        workspaceId: "ws-1",
        targetId: "tgt-1",
        state: "idle",
        objective: "Old objective",
        evaluatorProviderId: "codex",
        maxSupervisionCount: 0,
        completedSupervisionCount: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    });

    await saveTargetMemory(workspacePath, "tgt-1", {
      schemaVersion: 2,
      targetId: "tgt-1",
      planTree: {
        id: "root",
        title: "Supervisor target",
        objective: "Complete the supervised target",
        deliverable: "Completed target",
        acceptanceCriteria: ["Target objective is complete"],
        status: "in_progress",
        taskType: "generic",
        children: [
          {
            id: "stage-1",
            title: "Old step",
            objective: "Keep the old scope",
            deliverable: "The original stage remains intact",
            acceptanceCriteria: ["Original stage is preserved"],
            status: "in_progress",
            taskType: "generic",
            children: [],
          },
        ],
      },
      activeNodeId: "stage-1",
      maxDepth: 6,
      planRevision: 1,
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

    fsState.failRenameOnCalls = [2];

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
      schemaVersion: 2,
      targetId: "tgt-1",
      activeNodeId: "stage-1",
      progressSummary: "In progress",
      lastGuidance: "Do old thing",
      stalledCount: 1,
      updatedAt: 2,
    });
    expect(memory.planTree.children[0]?.id).toBe("stage-1");
    expect(cycles).toMatchObject([
      {
        cycleId: "cycle-1",
        guidance: "Do the old thing",
      },
    ]);
  });

  it("keeps the promoted target live when backup cleanup fails", async () => {
    await createTargetFiles(workspacePath, {
      targetId: "tgt-1",
      sessionId: "sess-1",
      workspaceId: "ws-1",
      objective: "Old objective",
      createdAt: 1,
      supervisor: {
        id: "sup-1",
        sessionId: "sess-1",
        workspaceId: "ws-1",
        targetId: "tgt-1",
        state: "idle",
        objective: "Old objective",
        evaluatorProviderId: "codex",
        maxSupervisionCount: 0,
        completedSupervisionCount: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    });

    fsState.failRmOnCalls = [1];

    await expect(
      resetTargetFiles(workspacePath, {
        targetId: "tgt-1",
        sessionId: "sess-1",
        workspaceId: "ws-1",
        objective: "New objective",
        createdAt: 3,
      })
    ).resolves.toBeUndefined();

    const meta = await readTargetMeta(workspacePath, "tgt-1");
    const memory = await loadTargetMemory(workspacePath, "tgt-1");
    const cycles = await readTargetCycleRecords(workspacePath, "tgt-1");

    expect(meta.objective).toBe("New objective");
    expect(memory).toMatchObject({
      schemaVersion: 2,
      targetId: "tgt-1",
      activeNodeId: undefined,
      stalledCount: 0,
      updatedAt: 3,
    });
    expect(memory.planTree.children).toEqual([]);
    expect(cycles).toEqual([]);
  });

  it("preserves the backup target when both promotion and restore fail", async () => {
    await createTargetFiles(workspacePath, {
      targetId: "tgt-1",
      sessionId: "sess-1",
      workspaceId: "ws-1",
      objective: "Old objective",
      createdAt: 1,
      supervisor: {
        id: "sup-1",
        sessionId: "sess-1",
        workspaceId: "ws-1",
        targetId: "tgt-1",
        state: "idle",
        objective: "Old objective",
        evaluatorProviderId: "codex",
        maxSupervisionCount: 0,
        completedSupervisionCount: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    });

    fsState.failRenameOnCalls = [2, 3];

    await expect(
      resetTargetFiles(workspacePath, {
        targetId: "tgt-1",
        sessionId: "sess-1",
        workspaceId: "ws-1",
        objective: "New objective",
        createdAt: 3,
      })
    ).rejects.toThrow("promote failed");

    const targetsRoot = join(workspacePath, ".coder-studio", "supervisor", "targets");
    const entries = readdirSync(targetsRoot);
    const backupEntry = entries.find((entry) => entry.startsWith("tgt-1.backup-"));
    const stagingEntry = entries.find((entry) => entry.startsWith("tgt-1.reset-"));

    expect(existsSync(join(targetsRoot, "tgt-1"))).toBe(false);
    expect(backupEntry).toBeDefined();
    expect(stagingEntry).toBeDefined();

    const backupMeta = JSON.parse(
      readFileSync(join(targetsRoot, backupEntry!, "meta.json"), "utf-8")
    ) as { objective: string };
    const stagedMeta = JSON.parse(
      readFileSync(join(targetsRoot, stagingEntry!, "meta.json"), "utf-8")
    ) as { objective: string };

    expect(backupMeta.objective).toBe("Old objective");
    expect(stagedMeta.objective).toBe("New objective");
  });
});
