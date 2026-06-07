import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkspaceExtensionStateRepo } from "../storage/repositories/workspace-extension-state-repo.js";
import { WorkspaceRepo } from "../storage/repositories/workspace-repo.js";

describe("WorkspaceExtensionStateRepo", () => {
  let tempDir: string;
  let workspacePath: string;
  let workspaceRepo: WorkspaceRepo;
  let repo: WorkspaceExtensionStateRepo;
  let now = 1000;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "workspace-extension-state-repo-"));
    workspacePath = join(tempDir, "workspace");
    await mkdir(workspacePath, { recursive: true });
    workspaceRepo = new WorkspaceRepo({
      filePath: join(tempDir, "workspaces.json"),
    });
    workspaceRepo.create({
      id: "ws-1",
      path: workspacePath,
      targetRuntime: "native",
      openedAt: 1,
      lastActiveAt: 1,
      uiState: { leftPanelWidth: 1, bottomPanelHeight: 1, focusMode: false },
    });
    repo = new WorkspaceExtensionStateRepo({
      workspaceRepo,
      now: () => now,
    });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns an empty workspace-scoped state before any contributions exist", () => {
    expect(repo.get("ws-1")).toEqual({
      workspaceId: "ws-1",
      statusPills: [],
      progress: [],
      logs: [],
      quickActions: [],
      updatedAt: 1000,
    });
  });

  it("persists workspace extension state under the workspace state directory", async () => {
    repo.save({
      workspaceId: "ws-1",
      statusPills: [
        {
          key: "ci",
          label: "CI running",
          state: "running",
          detail: "unit tests",
          updatedAt: 1100,
        },
      ],
      progress: [],
      logs: [],
      quickActions: [],
      updatedAt: 1100,
    });

    const filePath = join(workspacePath, ".coder-studio", "extension-state.json");
    await expect(stat(filePath)).resolves.toBeDefined();
    await expect(readFile(filePath, "utf8").then((raw) => JSON.parse(raw))).resolves.toMatchObject({
      version: 1,
      state: {
        workspaceId: "ws-1",
        statusPills: [
          {
            key: "ci",
            label: "CI running",
            state: "running",
            detail: "unit tests",
            updatedAt: 1100,
          },
        ],
        updatedAt: 1100,
      },
    });

    now = 9999;
    const reloaded = new WorkspaceExtensionStateRepo({
      workspaceRepo,
      now: () => now,
    });
    expect(reloaded.get("ws-1").statusPills).toEqual([
      {
        key: "ci",
        label: "CI running",
        state: "running",
        detail: "unit tests",
        updatedAt: 1100,
      },
    ]);
    expect(reloaded.get("ws-1").updatedAt).toBe(1100);
  });
});
