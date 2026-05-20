import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceRepo } from "../../storage/repositories/workspace-repo.js";
import { WorkspaceManager } from "../../workspace/manager.js";

describe("WorkspaceManager.close — onClose callback", () => {
  let rootDir: string;
  let stateDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "workspace-onclose-"));
    stateDir = join(rootDir, ".state");
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("invokes onClose after the workspace row is deleted", async () => {
    let manager!: WorkspaceManager;
    const onClose = vi.fn(async (workspaceId: string) => {
      expect(manager.get(workspaceId)).toBeUndefined();
    });
    const eventBus = {
      emit: () => {},
      on: () => () => {},
    };

    manager = new WorkspaceManager({
      workspaceRepo: new WorkspaceRepo({
        filePath: join(stateDir, "workspaces.json"),
      }),
      eventBus,
      onClose,
    });

    const workspace = await manager.open({ path: rootDir });
    await manager.close(workspace.id);

    expect(onClose).toHaveBeenCalledWith(workspace.id);
    expect(manager.get(workspace.id)).toBeUndefined();
  });

  it("swallows onClose errors and still removes the workspace", async () => {
    const eventBus = {
      emit: () => {},
      on: () => () => {},
    };
    const manager = new WorkspaceManager({
      workspaceRepo: new WorkspaceRepo({
        filePath: join(stateDir, "workspaces.json"),
      }),
      eventBus,
      onClose: async () => {
        throw new Error("cleanup failed");
      },
    });

    const workspacePath = join(rootDir, "nested");
    await mkdir(workspacePath);
    const workspace = await manager.open({ path: workspacePath });

    await expect(manager.close(workspace.id)).resolves.toBeUndefined();
    expect(manager.get(workspace.id)).toBeUndefined();
  });

  it("runs runtime teardown before deleting the workspace row and post-close cleanup after", async () => {
    let manager!: WorkspaceManager;
    const callOrder: string[] = [];
    const teardown = vi.fn(async (workspaceId: string) => {
      callOrder.push(`teardown:${workspaceId}`);
      expect(manager.get(workspaceId)).toBeDefined();
    });
    const onClose = vi.fn(async (workspaceId: string) => {
      callOrder.push(`cleanup:${workspaceId}`);
      expect(manager.get(workspaceId)).toBeUndefined();
    });
    const eventBus = {
      emit: () => {},
      on: () => () => {},
    };

    manager = new WorkspaceManager({
      workspaceRepo: new WorkspaceRepo({
        filePath: join(stateDir, "workspaces.json"),
      }),
      eventBus,
      onClose,
      teardown,
    });

    const workspace = await manager.open({ path: rootDir });
    await manager.close(workspace.id);

    expect(teardown).toHaveBeenCalledWith(workspace.id);
    expect(onClose).toHaveBeenCalledWith(workspace.id);
    expect(callOrder).toEqual([`teardown:${workspace.id}`, `cleanup:${workspace.id}`]);
  });
});
