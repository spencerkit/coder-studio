import { mkdir } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../bus/event-bus.js";
import { openDatabase, runMigrations } from "../storage/db.js";
import { WorkspaceManager } from "../workspace/manager.js";
import type { CommandContext } from "../ws/dispatch.js";
import { dispatch } from "../ws/dispatch.js";

// Import command handlers to register them
import "../commands/workspace.js";
import "../commands/workspace-activity.js";

describe("Workspace Commands", () => {
  let db: ReturnType<typeof openDatabase>;
  let ctx: CommandContext;
  let eventBus: EventBus;
  let workspaceMgr: WorkspaceManager;
  let autoFetch: {
    registerViewer: ReturnType<typeof vi.fn>;
    unregisterViewer: ReturnType<typeof vi.fn>;
    triggerOpenTimeFetch: ReturnType<typeof vi.fn>;
    recordSuccess: ReturnType<typeof vi.fn>;
    getLastFetchAt: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    // Create in-memory database for testing
    db = openDatabase(":memory:");
    runMigrations(db);

    // Create event bus
    eventBus = new EventBus();
    autoFetch = {
      registerViewer: vi.fn(),
      unregisterViewer: vi.fn(),
      triggerOpenTimeFetch: vi.fn(),
      recordSuccess: vi.fn(),
      getLastFetchAt: vi.fn(() => undefined),
    };

    // Create workspace manager
    workspaceMgr = new WorkspaceManager({ db, eventBus, autoFetch });

    // Create context with required dependencies
    ctx = {
      db,
      workspaceMgr,
      sessionMgr: {
        get: vi.fn(() => undefined),
      },
      terminalMgr: {},
      eventBus,
      broadcaster: { broadcast: () => {} },
      providerRegistry: [],
      autoFetch,
    } as unknown as CommandContext;
  });

  describe("workspace.list", () => {
    it("should return empty array when no workspaces exist", async () => {
      const result = await dispatch(
        {
          kind: "command",
          id: "test-id-1",
          op: "workspace.list",
          args: {},
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect(result.data).toEqual([]);
    });
  });

  describe("workspace.open", () => {
    it("should fail for non-existent path", async () => {
      const result = await dispatch(
        {
          kind: "command",
          id: "test-id-3",
          op: "workspace.open",
          args: {
            path: "/non/existent/path/that/does/not/exist",
          },
        },
        ctx
      );

      expect(result.ok).toBe(false);
    });

    it("triggers open-time auto fetch after workspace.open succeeds", async () => {
      const dir = join(tmpdir(), `workspace-open-test-${Date.now()}`);
      await mkdir(dir);
      const triggerOpenTimeFetch = vi.fn();
      autoFetch = {
        registerViewer: () => {},
        unregisterViewer: () => {},
        triggerOpenTimeFetch,
        recordSuccess: () => {},
        getLastFetchAt: () => undefined,
      } as never;
      workspaceMgr = new WorkspaceManager({ db, eventBus, autoFetch });
      ctx = {
        ...ctx,
        workspaceMgr,
        autoFetch,
      } as CommandContext;

      const result = await dispatch(
        {
          kind: "command",
          id: "workspace-open-auto-fetch",
          op: "workspace.open",
          args: {
            path: dir,
          },
        },
        ctx
      );

      expect(result.ok).toBe(true);
      const workspaceId = (result.data as { id: string }).id;
      expect(triggerOpenTimeFetch).toHaveBeenCalledWith(workspaceId);
    });
  });

  describe("workspace.browse", () => {
    it("expands ~ to the current home directory", async () => {
      const result = await dispatch(
        {
          kind: "command",
          id: "workspace-browse-home",
          op: "workspace.browse",
          args: {
            path: "~",
          },
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect(result.data).toMatchObject({
        currentPath: homedir(),
      });
    });

    it("returns dynamic root paths based on the current browse target", async () => {
      const result = await dispatch(
        {
          kind: "command",
          id: "workspace-browse-roots",
          op: "workspace.browse",
          args: {
            path: homedir(),
          },
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect((result.data as { rootPaths?: string[] }).rootPaths).toEqual(
        expect.arrayContaining(["/", homedir()])
      );
    });
  });

  describe("workspace.close", () => {
    it("should error if workspace not found", async () => {
      const result = await dispatch(
        {
          kind: "command",
          id: "test-id-6",
          op: "workspace.close",
          args: {
            id: "non-existent-id",
          },
        },
        ctx
      );

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("internal_error");
    });
  });

  describe("workspace.uiState.set", () => {
    it("persists pane layout into workspace ui state", async () => {
      const dir = join(tmpdir(), `workspace-command-test-${Date.now()}`);
      await mkdir(dir);

      const openResult = await dispatch(
        {
          kind: "command",
          id: "open-workspace",
          op: "workspace.open",
          args: {
            path: dir,
          },
        },
        ctx
      );

      expect(openResult.ok).toBe(true);

      const workspaceId = (openResult.data as { id: string }).id;
      const result = await dispatch(
        {
          kind: "command",
          id: "set-ui-state",
          op: "workspace.uiState.set",
          args: {
            workspaceId,
            uiState: {
              leftPanelWidth: 320,
              bottomPanelHeight: 210,
              focusMode: false,
              paneLayout: {
                id: "root",
                type: "split",
                direction: "horizontal",
                children: [
                  { id: "left", type: "leaf", sessionId: "sess-left" },
                  { id: "right", type: "leaf", sessionId: "sess-right" },
                ],
              },
            },
          },
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect((result.data as { uiState: { paneLayout: unknown } }).uiState.paneLayout).toEqual({
        id: "root",
        type: "split",
        direction: "horizontal",
        children: [
          { id: "left", type: "leaf", sessionId: "sess-left" },
          { id: "right", type: "leaf", sessionId: "sess-right" },
        ],
      });
    });

    it("persists fileTreeExpandedDirs into workspace ui state", async () => {
      const dir = join(tmpdir(), `workspace-expanded-dirs-test-${Date.now()}`);
      await mkdir(dir);

      const openResult = await dispatch(
        {
          kind: "command",
          id: "open-workspace-expanded-dirs",
          op: "workspace.open",
          args: { path: dir },
        },
        ctx
      );

      expect(openResult.ok).toBe(true);
      const workspaceId = (openResult.data as { id: string }).id;

      const result = await dispatch(
        {
          kind: "command",
          id: "set-ui-state-expanded-dirs",
          op: "workspace.uiState.set",
          args: {
            workspaceId,
            uiState: {
              leftPanelWidth: 320,
              bottomPanelHeight: 210,
              focusMode: false,
              fileTreeExpandedDirs: ["packages", "packages/web"],
            },
          },
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect(
        (result.data as { uiState: { fileTreeExpandedDirs?: string[] } }).uiState
          .fileTreeExpandedDirs
      ).toEqual(["packages", "packages/web"]);
    });
  });

  describe("workspace.lastViewedTarget", () => {
    it("persists and returns the global workspace last-viewed target", async () => {
      const dir = join(tmpdir(), `workspace-target-test-${Date.now()}`);
      await mkdir(dir);

      const openResult = await dispatch(
        {
          kind: "command",
          id: "open-workspace-target",
          op: "workspace.open",
          args: { path: dir },
        },
        ctx
      );

      expect(openResult.ok).toBe(true);
      const workspaceId = (openResult.data as { id: string }).id;

      const writeResult = await dispatch(
        {
          kind: "command",
          id: "set-last-viewed-target",
          op: "workspace.lastViewedTarget.set",
          args: {
            workspaceId,
            sessionId: "sess-123",
          },
        },
        ctx
      );

      expect(writeResult.ok).toBe(true);
      expect(writeResult.data).toMatchObject({
        workspaceId,
        sessionId: undefined,
      });
      expect((writeResult.data as { updatedAt: number }).updatedAt).toEqual(expect.any(Number));

      const readResult = await dispatch(
        {
          kind: "command",
          id: "get-last-viewed-target",
          op: "workspace.lastViewedTarget.get",
          args: {},
        },
        ctx
      );

      expect(readResult.ok).toBe(true);
      expect(readResult.data).toMatchObject({
        workspaceId,
      });
      expect(readResult.data).not.toHaveProperty("sessionId");
      expect((readResult.data as { updatedAt: number }).updatedAt).toEqual(expect.any(Number));
    });

    it("preserves a session id that belongs to the workspace", async () => {
      const dir = join(tmpdir(), `workspace-target-session-test-${Date.now()}`);
      await mkdir(dir);

      const openResult = await dispatch(
        {
          kind: "command",
          id: "open-workspace-target-session",
          op: "workspace.open",
          args: { path: dir },
        },
        ctx
      );

      expect(openResult.ok).toBe(true);
      const workspaceId = (openResult.data as { id: string }).id;
      ctx.sessionMgr.get = vi.fn((sessionId: string) =>
        sessionId === "sess-123" ? { id: "sess-123", workspaceId } : undefined
      ) as never;

      const writeResult = await dispatch(
        {
          kind: "command",
          id: "set-last-viewed-target-session",
          op: "workspace.lastViewedTarget.set",
          args: {
            workspaceId,
            sessionId: "sess-123",
          },
        },
        ctx
      );

      expect(writeResult.ok).toBe(true);
      expect(writeResult.data).toMatchObject({
        workspaceId,
        sessionId: "sess-123",
      });

      const readResult = await dispatch(
        {
          kind: "command",
          id: "get-last-viewed-target-session",
          op: "workspace.lastViewedTarget.get",
          args: {},
        },
        ctx
      );

      expect(readResult.ok).toBe(true);
      expect(readResult.data).toMatchObject({
        workspaceId,
        sessionId: "sess-123",
      });
    });

    it("drops an out-of-workspace session id while preserving the workspace target", async () => {
      const dir = join(tmpdir(), `workspace-target-mismatch-${Date.now()}`);
      await mkdir(dir);

      const openResult = await dispatch(
        {
          kind: "command",
          id: "open-workspace-target-mismatch",
          op: "workspace.open",
          args: { path: dir },
        },
        ctx
      );

      expect(openResult.ok).toBe(true);
      const workspaceId = (openResult.data as { id: string }).id;

      const result = await dispatch(
        {
          kind: "command",
          id: "set-last-viewed-target-mismatch",
          op: "workspace.lastViewedTarget.set",
          args: {
            workspaceId,
            sessionId: "sess-missing",
          },
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect(result.data).toMatchObject({
        workspaceId,
        sessionId: undefined,
      });
    });

    it("returns workspace_not_found when writing a target for a missing workspace", async () => {
      const result = await dispatch(
        {
          kind: "command",
          id: "set-last-viewed-target-missing-workspace",
          op: "workspace.lastViewedTarget.set",
          args: {
            workspaceId: "ws-missing",
          },
        },
        ctx
      );

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("workspace_not_found");
    });

    it("returns null when the stored last-viewed target is malformed", async () => {
      db.prepare("INSERT INTO user_settings (key, value) VALUES (?, ?)").run(
        "workspace.lastViewedTarget",
        "{not-json"
      );

      const result = await dispatch(
        {
          kind: "command",
          id: "get-last-viewed-target-malformed",
          op: "workspace.lastViewedTarget.get",
          args: {},
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect(result.data).toBeNull();
    });
  });
});
