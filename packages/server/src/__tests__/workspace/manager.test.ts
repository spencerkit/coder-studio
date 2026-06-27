/**
 * Tests for WorkspaceManager.
 */

import type { DomainEvent } from "@coder-studio/core";
import chokidar, { type FSWatcher } from "chokidar";
import { mkdir, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceRepo } from "../../storage/repositories/workspace-repo.js";
import { WorkspaceManager } from "../../workspace/manager.js";

describe("WorkspaceManager", () => {
  let testDir: string;
  let stateDir: string;
  let manager: WorkspaceManager;
  let events: DomainEvent[];
  let eventBus: {
    emit: (event: DomainEvent) => void;
    on: () => () => void;
  };
  let watchSpy: ReturnType<typeof vi.spyOn<typeof chokidar, "watch">>;

  beforeEach(async () => {
    // Create test directory
    testDir = join(tmpdir(), `workspace-test-${Date.now()}`);
    await mkdir(testDir);
    stateDir = join(testDir, ".state");

    // Event bus mock
    events = [];
    eventBus = {
      emit: (event: DomainEvent) => {
        events.push(event);
      },
      on: () => () => {},
    };

    watchSpy = vi.spyOn(chokidar, "watch").mockReturnValue({
      on() {
        return this;
      },
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as FSWatcher);

    manager = new WorkspaceManager({
      workspaceRepo: new WorkspaceRepo({
        filePath: join(stateDir, "workspaces.json"),
      }),
      eventBus,
    });
  });

  afterEach(async () => {
    watchSpy.mockRestore();
    await rm(testDir, { recursive: true, force: true });
  });

  describe("open", () => {
    it("should open a valid workspace", async () => {
      const workspace = await manager.open({
        path: testDir,
      });

      expect(workspace.id).toBeDefined();
      expect(workspace.path).toBe(testDir);
      expect(workspace.openedAt).toBeDefined();
      expect(workspace.uiState).toBeDefined();
    });

    it("persists explicit targetRuntime and wslDistro on new workspaces", async () => {
      manager = new WorkspaceManager({
        workspaceRepo: new WorkspaceRepo({
          filePath: join(stateDir, "workspaces.json"),
        }),
        eventBus,
        validatorOptions: {
          commandExists: async () => true,
          runCommand: async (file: string, args?: string[]) => {
            if (file === "wsl.exe" && args?.join(" ") === "-l -q") {
              return { stdout: "Ubuntu-24.04\n", stderr: "" };
            }
            throw new Error(`unexpected command: ${file}`);
          },
        },
      });

      const workspace = await manager.open({
        path: "/home/spencer/workspace",
        targetRuntime: "wsl",
        wslDistro: "Ubuntu-24.04",
      });

      expect(workspace.targetRuntime).toBe("wsl");
      expect(workspace.wslDistro).toBe("Ubuntu-24.04");
      expect(workspace.path).toBe("/home/spencer/workspace");
    });

    it("triggers open-time auto fetch for new workspaces", async () => {
      const autoFetch = {
        triggerOpenTimeFetch: vi.fn(),
        recordSuccess: vi.fn(),
        getLastFetchAt: vi.fn(),
      };
      manager = new WorkspaceManager({
        workspaceRepo: new WorkspaceRepo({
          filePath: join(stateDir, "workspaces.json"),
        }),
        eventBus,
        autoFetch,
      });

      const workspace = await manager.open({
        path: testDir,
      });

      expect(autoFetch.triggerOpenTimeFetch).toHaveBeenCalledWith(workspace.id);
    });

    it("should emit workspace.meta.changed event", async () => {
      await manager.open({
        path: testDir,
      });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("workspace.meta.changed");
    });

    it("should reject non-existent path", async () => {
      await expect(
        manager.open({
          path: join(testDir, "nonexistent"),
        })
      ).rejects.toThrow();
    });

    it("should return existing workspace for duplicate paths (idempotent open)", async () => {
      const first = await manager.open({
        path: testDir,
      });

      const second = await manager.open({
        path: testDir,
      });

      // Should return the same workspace
      expect(second.id).toBe(first.id);
      expect(second.path).toBe(first.path);
    });

    it("triggers open-time auto fetch for existing workspaces", async () => {
      const autoFetch = {
        triggerOpenTimeFetch: vi.fn(),
        recordSuccess: vi.fn(),
        getLastFetchAt: vi.fn(),
      };
      manager = new WorkspaceManager({
        workspaceRepo: new WorkspaceRepo({
          filePath: join(stateDir, "workspaces.json"),
        }),
        eventBus,
        autoFetch,
      });

      const first = await manager.open({ path: testDir });
      autoFetch.triggerOpenTimeFetch.mockClear();

      const second = await manager.open({ path: testDir });

      expect(second.id).toBe(first.id);
      expect(autoFetch.triggerOpenTimeFetch).toHaveBeenCalledWith(first.id);
    });

    it("does not start file watchers when broadcaster is omitted", async () => {
      await manager.open({
        path: testDir,
      });

      expect((manager as unknown as { watchers: Map<string, unknown> }).watchers.size).toBe(0);
    });

    it("does not start host file watchers for WSL workspaces", async () => {
      manager = new WorkspaceManager({
        workspaceRepo: new WorkspaceRepo({
          filePath: join(stateDir, "workspaces.json"),
        }),
        eventBus,
        broadcaster: { broadcast: vi.fn() } as never,
        validatorOptions: {
          commandExists: async () => true,
          runCommand: async (file: string, args?: string[]) => {
            if (file === "wsl.exe" && args?.join(" ") === "-l -q") {
              return { stdout: "Ubuntu-24.04\n", stderr: "" };
            }

            throw new Error(`unexpected command: ${file}`);
          },
        },
      });

      await manager.open({
        path: "/home/spencer/workspace",
        targetRuntime: "wsl",
        wslDistro: "Ubuntu-24.04",
      });

      expect(watchSpy).not.toHaveBeenCalled();
      expect((manager as unknown as { watchers: Map<string, unknown> }).watchers.size).toBe(0);
    });
  });

  describe("list", () => {
    it("should list all workspaces", async () => {
      await manager.open({ path: testDir });

      const workspaces = manager.list();
      expect(workspaces).toHaveLength(1);
      expect(workspaces[0].path).toBe(testDir);
    });

    it("should return empty array when no workspaces", () => {
      const workspaces = manager.list();
      expect(workspaces).toHaveLength(0);
    });
  });

  describe("get", () => {
    it("should get workspace by id", async () => {
      const created = await manager.open({ path: testDir });
      const workspace = manager.get(created.id);

      expect(workspace).toBeDefined();
      expect(workspace?.id).toBe(created.id);
    });

    it("should return undefined for non-existent workspace", () => {
      const workspace = manager.get("nonexistent");
      expect(workspace).toBeUndefined();
    });
  });

  describe("close", () => {
    it("should close workspace", async () => {
      const workspace = await manager.open({ path: testDir });
      await manager.close(workspace.id);

      const workspaces = manager.list();
      expect(workspaces).toHaveLength(0);
    });

    it("should throw for non-existent workspace", async () => {
      await expect(manager.close("nonexistent")).rejects.toThrow();
    });
  });

  describe("touch", () => {
    it("should update last active timestamp", async () => {
      const workspace = await manager.open({ path: testDir });
      const originalLastActive = workspace.lastActiveAt;

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      manager.touch(workspace.id);

      const updated = manager.get(workspace.id);
      expect(updated?.lastActiveAt).toBeGreaterThan(originalLastActive);
    });
  });

  describe("recordFetch", () => {
    it("forwards fetch success tracking to autoFetch", async () => {
      const autoFetch = {
        triggerOpenTimeFetch: vi.fn(),
        recordSuccess: vi.fn(),
        getLastFetchAt: vi.fn(),
      };
      manager = new WorkspaceManager({
        workspaceRepo: new WorkspaceRepo({
          filePath: join(stateDir, "workspaces.json"),
        }),
        eventBus,
        autoFetch,
      });
      const workspace = await manager.open({ path: testDir });

      manager.recordFetch(workspace.id);

      expect(autoFetch.recordSuccess).toHaveBeenCalledWith(workspace.id);
    });
  });

  describe("hydrateWatchers", () => {
    it("starts file watchers for persisted workspaces", async () => {
      const persisted = await manager.open({ path: testDir });
      const broadcaster = { broadcast: vi.fn() };
      const restoredManager = new WorkspaceManager({
        workspaceRepo: new WorkspaceRepo({
          filePath: join(stateDir, "workspaces.json"),
        }),
        eventBus,
        broadcaster,
      });

      restoredManager.hydrateWatchers();

      expect(watchSpy).toHaveBeenCalledTimes(1);
      expect(watchSpy).toHaveBeenCalledWith(
        testDir,
        expect.objectContaining({
          ignoreInitial: true,
          persistent: true,
        })
      );
      expect(
        (restoredManager as unknown as { watchers: Map<string, unknown> }).watchers.has(
          persisted.id
        )
      ).toBe(true);
    });

    it("does not create duplicate watchers when called multiple times", async () => {
      const persisted = await manager.open({ path: testDir });
      const broadcaster = { broadcast: vi.fn() };
      const restoredManager = new WorkspaceManager({
        workspaceRepo: new WorkspaceRepo({
          filePath: join(stateDir, "workspaces.json"),
        }),
        eventBus,
        broadcaster,
      });

      restoredManager.hydrateWatchers();
      restoredManager.hydrateWatchers();

      expect(watchSpy).toHaveBeenCalledTimes(1);
      expect(
        (restoredManager as unknown as { watchers: Map<string, unknown> }).watchers.has(
          persisted.id
        )
      ).toBe(true);
    });

    it("skips host watcher hydration for persisted WSL workspaces", async () => {
      manager = new WorkspaceManager({
        workspaceRepo: new WorkspaceRepo({
          filePath: join(stateDir, "workspaces.json"),
        }),
        eventBus,
        broadcaster: { broadcast: vi.fn() } as never,
        validatorOptions: {
          commandExists: async () => true,
          runCommand: async (file: string, args?: string[]) => {
            if (file === "wsl.exe" && args?.join(" ") === "-l -q") {
              return { stdout: "Ubuntu-24.04\n", stderr: "" };
            }

            throw new Error(`unexpected command: ${file}`);
          },
        },
      });
      const persisted = await manager.open({
        path: "/home/spencer/workspace",
        targetRuntime: "wsl",
        wslDistro: "Ubuntu-24.04",
      });
      watchSpy.mockClear();

      const restoredManager = new WorkspaceManager({
        workspaceRepo: new WorkspaceRepo({
          filePath: join(stateDir, "workspaces.json"),
        }),
        eventBus,
        broadcaster: { broadcast: vi.fn() } as never,
        validatorOptions: {
          commandExists: async () => true,
          runCommand: async (file: string, args?: string[]) => {
            if (file === "wsl.exe" && args?.join(" ") === "-l -q") {
              return { stdout: "Ubuntu-24.04\n", stderr: "" };
            }

            throw new Error(`unexpected command: ${file}`);
          },
        },
      });

      restoredManager.hydrateWatchers();

      expect(watchSpy).not.toHaveBeenCalled();
      expect(
        (restoredManager as unknown as { watchers: Map<string, unknown> }).watchers.has(
          persisted.id
        )
      ).toBe(false);
    });
  });

  describe("updateUiState", () => {
    it("updates workspace pane layout and emits workspace meta changed", async () => {
      const workspace = await manager.open({ path: testDir });
      events.length = 0;

      manager.updateUiState(workspace.id, {
        ...workspace.uiState,
        paneLayout: {
          id: "root",
          type: "split",
          direction: "horizontal",
          children: [
            { id: "left", type: "leaf", sessionId: "sess-left" },
            { id: "right", type: "leaf", sessionId: "sess-right" },
          ],
        },
      });

      const updated = manager.get(workspace.id);
      expect(updated?.uiState.paneLayout).toEqual({
        id: "root",
        type: "split",
        direction: "horizontal",
        children: [
          { id: "left", type: "leaf", sessionId: "sess-left" },
          { id: "right", type: "leaf", sessionId: "sess-right" },
        ],
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "workspace.meta.changed",
        workspaceId: workspace.id,
        patch: {
          uiState: updated?.uiState,
        },
      });
    });
  });
});
