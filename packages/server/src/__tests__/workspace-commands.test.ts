import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderDefinition } from "@coder-studio/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../bus/event-bus.js";
import { ProviderConfigRepo } from "../storage/repositories/provider-config-repo.js";
import { SettingsRepo } from "../storage/repositories/settings-repo.js";
import { WorkspaceRepo } from "../storage/repositories/workspace-repo.js";
import { WORKSPACE_HISTORY_KEY } from "../workspace/history-store.js";
import { WorkspaceManager } from "../workspace/manager.js";
import type { CommandContext } from "../ws/dispatch.js";
import { dispatch } from "../ws/dispatch.js";

// Import command handlers to register them
import "../commands/workspace.js";
import "../commands/workspace-activity.js";

function createSkillProvider(id: string, roots: string[]): ProviderDefinition {
  return {
    id,
    displayName: id,
    badge: id,
    kind: "built_in",
    capability: "full",
    capabilities: [],
    install: {
      prerequisites: [],
      manualGuideKeys: [],
      docUrls: { provider: "", prerequisites: {} },
      strategies: {},
    },
    buildCommand: () => ({ argv: [id], env: {}, cwd: "/" }),
    configSchema: { parse: (value: unknown) => value } as never,
    defaultConfig: {},
    requiredCommands: [id],
    supportsSkillsMount: true,
    skillMountDirectories: roots,
  } satisfies ProviderDefinition;
}

describe("Workspace Commands", () => {
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
  let settingsRepo: SettingsRepo;
  let providerConfigRepo: ProviderConfigRepo;
  let settingsDir: string;

  beforeEach(() => {
    // Create event bus
    eventBus = new EventBus();
    autoFetch = {
      registerViewer: vi.fn(),
      unregisterViewer: vi.fn(),
      triggerOpenTimeFetch: vi.fn(),
      recordSuccess: vi.fn(),
      getLastFetchAt: vi.fn(() => undefined),
    };
    settingsDir = mkdtempSync(join(tmpdir(), "workspace-settings-"));
    settingsRepo = new SettingsRepo({ filePath: join(settingsDir, "settings.json") });
    providerConfigRepo = new ProviderConfigRepo({
      filePath: join(settingsDir, "provider-configs.json"),
    });

    // Create workspace manager
    workspaceMgr = new WorkspaceManager({
      workspaceRepo: new WorkspaceRepo({
        filePath: join(settingsDir, "workspaces.json"),
      }),
      eventBus,
      autoFetch,
    });

    // Create context with required dependencies
    ctx = {
      workspaceMgr,
      sessionMgr: {
        get: vi.fn(() => undefined),
      },
      terminalMgr: {},
      eventBus,
      broadcaster: { broadcast: () => {} },
      settingsRepo,
      providerConfigRepo,
      providerRegistry: [],
      autoFetch,
    } as unknown as CommandContext;
  });

  afterEach(() => {
    rmSync(settingsDir, { recursive: true, force: true });
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

  describe("workspace.history.list", () => {
    it("returns an empty list by default", async () => {
      const result = await dispatch(
        {
          kind: "command",
          id: "workspace-history-empty",
          op: "workspace.history.list",
          args: {},
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect(result.data).toEqual([]);
    });

    it("records successful workspace opens in newest-first order", async () => {
      const olderDir = join(tmpdir(), `workspace-history-older-${Date.now()}`);
      const newerDir = join(tmpdir(), `workspace-history-newer-${Date.now()}`);
      await mkdir(olderDir, { recursive: true });
      await mkdir(newerDir, { recursive: true });

      await dispatch(
        {
          kind: "command",
          id: "workspace-history-open-older",
          op: "workspace.open",
          args: {
            path: olderDir,
          },
        },
        ctx
      );

      await dispatch(
        {
          kind: "command",
          id: "workspace-history-open-newer",
          op: "workspace.open",
          args: {
            path: newerDir,
          },
        },
        ctx
      );

      const result = await dispatch(
        {
          kind: "command",
          id: "workspace-history-list-newest-first",
          op: "workspace.history.list",
          args: {},
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect(result.data).toEqual([
        expect.objectContaining({
          path: newerDir,
          name: expect.stringMatching(/^workspace-history-newer-/),
        }),
        expect.objectContaining({
          path: olderDir,
          name: expect.stringMatching(/^workspace-history-older-/),
        }),
      ]);
    });

    it("dedupes repeated opens of the same path and moves them to the front", async () => {
      vi.useFakeTimers();
      try {
        const alphaDir = join(tmpdir(), "workspace-history-alpha");
        const betaDir = join(tmpdir(), "workspace-history-beta");
        await mkdir(alphaDir, { recursive: true });
        await mkdir(betaDir, { recursive: true });

        vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
        await dispatch(
          {
            kind: "command",
            id: "workspace-history-open-alpha-first",
            op: "workspace.open",
            args: {
              path: alphaDir,
            },
          },
          ctx
        );

        vi.setSystemTime(new Date("2026-01-02T00:00:00.000Z"));
        await dispatch(
          {
            kind: "command",
            id: "workspace-history-open-beta",
            op: "workspace.open",
            args: {
              path: betaDir,
            },
          },
          ctx
        );

        vi.setSystemTime(new Date("2026-01-03T00:00:00.000Z"));
        await dispatch(
          {
            kind: "command",
            id: "workspace-history-open-alpha-second",
            op: "workspace.open",
            args: {
              path: alphaDir,
            },
          },
          ctx
        );

        const result = await dispatch(
          {
            kind: "command",
            id: "workspace-history-list-deduped",
            op: "workspace.history.list",
            args: {},
          },
          ctx
        );

        expect(result.ok).toBe(true);
        expect(result.data).toEqual([
          {
            path: alphaDir,
            name: "workspace-history-alpha",
            lastOpenedAt: new Date("2026-01-03T00:00:00.000Z").getTime(),
          },
          {
            path: betaDir,
            name: "workspace-history-beta",
            lastOpenedAt: new Date("2026-01-02T00:00:00.000Z").getTime(),
          },
        ]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("filters malformed stored history entries before returning the list", async () => {
      settingsRepo.set(WORKSPACE_HISTORY_KEY, [
        {
          path: "/repo/valid",
          name: "valid",
          lastOpenedAt: 2,
        },
        {
          path: 123,
          name: "broken",
          lastOpenedAt: 1,
        },
        "bad-entry",
      ]);

      const result = await dispatch(
        {
          kind: "command",
          id: "workspace-history-list-filters-malformed",
          op: "workspace.history.list",
          args: {},
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect(result.data).toEqual([
        {
          path: "/repo/valid",
          name: "valid",
          lastOpenedAt: 2,
        },
      ]);
    });

    it("removes a recent workspace by path and returns the updated list", async () => {
      settingsRepo.set(WORKSPACE_HISTORY_KEY, [
        {
          path: "/repo/alpha",
          name: "alpha",
          lastOpenedAt: 3,
        },
        {
          path: "/repo/beta",
          name: "beta",
          lastOpenedAt: 2,
        },
      ]);

      const result = await dispatch(
        {
          kind: "command",
          id: "workspace-history-remove-entry",
          op: "workspace.history.remove",
          args: {
            path: "/repo/alpha",
          },
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect(result.data).toEqual([
        {
          path: "/repo/beta",
          name: "beta",
          lastOpenedAt: 2,
        },
      ]);
      expect(settingsRepo.get(WORKSPACE_HISTORY_KEY)).toEqual(result.data);
    });

    it("clears the recent workspace list and removes the stored key", async () => {
      settingsRepo.set(WORKSPACE_HISTORY_KEY, [
        {
          path: "/repo/alpha",
          name: "alpha",
          lastOpenedAt: 3,
        },
      ]);

      const result = await dispatch(
        {
          kind: "command",
          id: "workspace-history-clear",
          op: "workspace.history.clear",
          args: {},
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect(result.data).toEqual([]);
      expect(settingsRepo.get(WORKSPACE_HISTORY_KEY)).toBeUndefined();
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

    it("workspace.open still records a native workspace through the command layer", async () => {
      const workspaceDir = join(tmpdir(), `workspace-open-native-${Date.now()}`);
      await mkdir(workspaceDir, { recursive: true });

      const result = await dispatch(
        {
          kind: "command",
          id: "workspace-open-native",
          op: "workspace.open",
          args: { path: workspaceDir },
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect(result.data).toMatchObject({ targetRuntime: "native" });
    });

    it("passes explicit WSL runtime metadata through the command layer", async () => {
      const open = vi.fn().mockResolvedValue({
        id: "ws-wsl",
        path: "/home/spencer/workspace",
        targetRuntime: "wsl",
        wslDistro: "Ubuntu-24.04",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 200,
          focusMode: false,
        },
      });
      const ensureRuntimeForWorkspace = vi.fn().mockResolvedValue(undefined);

      ctx = {
        ...ctx,
        workspaceMgr: {
          ...workspaceMgr,
          open,
        } as unknown as WorkspaceManager,
        runtimeOrchestrator: {
          ensureRuntimeForWorkspace,
        },
      } as CommandContext;

      const result = await dispatch(
        {
          kind: "command",
          id: "workspace-open-wsl",
          op: "workspace.open",
          args: {
            path: "/home/spencer/workspace",
            targetRuntime: "wsl",
            wslDistro: "Ubuntu-24.04",
          },
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect(open).toHaveBeenCalledWith({
        path: "/home/spencer/workspace",
        targetRuntime: "wsl",
        wslDistro: "Ubuntu-24.04",
      });
      expect(ensureRuntimeForWorkspace).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "ws-wsl",
          targetRuntime: "wsl",
          wslDistro: "Ubuntu-24.04",
        })
      );
      expect(result.data).toMatchObject({
        targetRuntime: "wsl",
        wslDistro: "Ubuntu-24.04",
      });
    });

    it("rejects WSL workspace opens when the host runtime disables WSL support", async () => {
      const result = await dispatch(
        {
          kind: "command",
          id: "workspace-open-wsl-disabled",
          op: "workspace.open",
          args: {
            path: "/home/spencer/workspace",
            targetRuntime: "wsl",
            wslDistro: "Ubuntu-24.04",
          },
        },
        {
          ...ctx,
          config: {
            auth: { enabled: false },
            host: "localhost",
            wslRuntime: { enabled: false },
          },
        } as CommandContext
      );

      expect(result).toMatchObject({
        ok: false,
        error: {
          code: "wsl_runtime_unavailable",
          message: "WSL workspaces are not supported by this runtime host",
        },
      });
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
      workspaceMgr = new WorkspaceManager({
        workspaceRepo: new WorkspaceRepo({
          filePath: join(settingsDir, "workspaces.json"),
        }),
        eventBus,
        autoFetch,
      });
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

    it("publishes agent instructions during workspace.open", async () => {
      const dir = join(tmpdir(), `workspace-open-publish-${Date.now()}`);
      await mkdir(dir);
      const calls: string[] = [];

      ctx = {
        ...ctx,
        agentInstructionPublisher: {
          syncWorkspace: vi.fn(async () => {
            calls.push("publish");
          }),
          scheduleWorkspaceSync: vi.fn(),
          syncAllOpenWorkspaces: vi.fn(),
        } as never,
      } as CommandContext;

      const result = await dispatch(
        {
          kind: "command",
          id: "workspace-open-publish",
          op: "workspace.open",
          args: {
            path: dir,
          },
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect(calls).toEqual(["publish"]);
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

    it("includes symlinked directories in browse results", async () => {
      const dir = join(tmpdir(), `workspace-browse-symlink-${Date.now()}`);
      const target = join(dir, "target");
      await mkdir(target, { recursive: true });
      await symlink(target, join(dir, "linked"), "dir");

      const result = await dispatch(
        {
          kind: "command",
          id: "workspace-browse-symlink",
          op: "workspace.browse",
          args: {
            path: dir,
          },
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect((result.data as { directories: Array<{ name: string }> }).directories).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: "linked" })])
      );

      rmSync(dir, { recursive: true, force: true });
    });
  });

  describe("workspace.mkdir", () => {
    it("creates a directory at an absolute browse path", async () => {
      const dir = join(tmpdir(), `workspace-mkdir-test-${Date.now()}`);
      await mkdir(dir, { recursive: true });

      const result = await dispatch(
        {
          kind: "command",
          id: "workspace-mkdir-success",
          op: "workspace.mkdir",
          args: {
            path: join(dir, "demo"),
          },
        },
        ctx
      );

      expect(result.ok).toBe(true);
      const createdEntry = await stat(join(dir, "demo"));
      expect(createdEntry.isDirectory()).toBe(true);
    });

    it("rejects creating a directory that already exists", async () => {
      const dir = join(tmpdir(), `workspace-mkdir-exists-${Date.now()}`);
      await mkdir(join(dir, "demo"), { recursive: true });

      const result = await dispatch(
        {
          kind: "command",
          id: "workspace-mkdir-exists",
          op: "workspace.mkdir",
          args: {
            path: join(dir, "demo"),
          },
        },
        ctx
      );

      expect(result.ok).toBe(false);
      expect(result.error).toMatchObject({
        code: "already_exists",
      });
    });

    it.each(["", ".", ".."])('rejects invalid requested folder path "%s"', async (path) => {
      const result = await dispatch(
        {
          kind: "command",
          id: `workspace-mkdir-invalid-${path || "empty"}`,
          op: "workspace.mkdir",
          args: {
            path,
          },
        },
        ctx
      );

      expect(result.ok).toBe(false);
      expect(result.error).toMatchObject({
        code: "invalid_path",
        message: "Folder name is required",
      });
    });

    it.each([
      "~/.",
      "~/..",
      "foo/.",
      "foo/..",
    ])('rejects invalid requested folder path with trailing segment "%s"', async (path) => {
      const result = await dispatch(
        {
          kind: "command",
          id: `workspace-mkdir-invalid-trailing-${path.replaceAll("/", "-")}`,
          op: "workspace.mkdir",
          args: {
            path,
          },
        },
        ctx
      );

      expect(result.ok).toBe(false);
      expect(result.error).toMatchObject({
        code: "invalid_path",
        message: "Folder name is required",
      });
    });
  });

  describe("workspace.wsl.browse", () => {
    it("returns WSL browse results through the command surface", async () => {
      const commandExists = vi.fn(async (command: string) => command === "wsl");
      const runCommand = vi.fn(async () => ({
        stdout: JSON.stringify({
          ok: true,
          currentPath: "/home/spencer/workspace",
          parentPath: "/home/spencer",
          rootPaths: ["/", "/home/spencer"],
          directories: [
            {
              name: "coder-studio",
              path: "/home/spencer/workspace/coder-studio",
            },
          ],
        }),
        stderr: "",
        exitCode: 0,
      }));

      ctx = {
        ...ctx,
        providerRuntimeDeps: {
          commandExists,
          runCommand,
        },
      } as CommandContext;

      const result = await dispatch(
        {
          kind: "command",
          id: "workspace-wsl-browse",
          op: "workspace.wsl.browse",
          args: {
            distro: "Ubuntu-24.04",
            path: "~/workspace",
          },
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect(result.data).toEqual({
        currentPath: "/home/spencer/workspace",
        parentPath: "/home/spencer",
        rootPaths: ["/", "/home/spencer"],
        directories: [
          {
            name: "coder-studio",
            path: "/home/spencer/workspace/coder-studio",
          },
        ],
      });
      expect(commandExists).toHaveBeenCalledWith("wsl");
      expect(runCommand).toHaveBeenCalledWith(
        "wsl",
        expect.arrayContaining([
          "-d",
          "Ubuntu-24.04",
          "--cd",
          "/",
          "-e",
          "sh",
          "-c",
          "sh",
          "~/workspace",
        ]),
        expect.objectContaining({ windowsHide: true, cwd: process.cwd() })
      );
    });
  });

  describe("workspace.wsl.mkdir", () => {
    it("creates a WSL directory through the command surface and returns ok", async () => {
      const commandExists = vi.fn(async (command: string) => command === "wsl");
      const runCommand = vi.fn(async () => ({
        stdout: '{"ok":true}\n',
        stderr: "",
        exitCode: 0,
      }));

      ctx = {
        ...ctx,
        providerRuntimeDeps: {
          commandExists,
          runCommand,
        },
      } as CommandContext;

      const result = await dispatch(
        {
          kind: "command",
          id: "workspace-wsl-mkdir",
          op: "workspace.wsl.mkdir",
          args: {
            distro: "Ubuntu-24.04",
            path: "~/workspace/new-dir",
          },
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect(result.data).toEqual({ ok: true });
      expect(commandExists).toHaveBeenCalledWith("wsl");
      expect(runCommand).toHaveBeenCalledWith(
        "wsl",
        expect.arrayContaining([
          "-d",
          "Ubuntu-24.04",
          "--cd",
          "/",
          "-e",
          "sh",
          "-c",
          "sh",
          "~/workspace/new-dir",
        ]),
        expect.objectContaining({ windowsHide: true, cwd: process.cwd() })
      );
    });
  });

  describe("workspace.wsl.exportAgentSkills", () => {
    it("exports agent skill directories through the host command surface", async () => {
      const tempHome = await mkdtemp(join(homedir(), ".coder-studio-wsl-export-"));
      try {
        const sharedRoot = join(tempHome, ".agents", "skills");
        await mkdir(join(sharedRoot, "reviewer", "notes"), { recursive: true });
        await writeFile(join(sharedRoot, "reviewer", "SKILL.md"), "# Reviewer\n");
        await writeFile(join(sharedRoot, "reviewer", "notes", "tips.md"), "tips\n");

        ctx = {
          ...ctx,
          providerRegistry: [createSkillProvider("codex", [sharedRoot])],
        } as CommandContext;

        const result = await dispatch(
          {
            kind: "command",
            id: "workspace-wsl-export-agent-skills",
            op: "workspace.wsl.exportAgentSkills",
            args: {},
          },
          ctx
        );

        expect(result.ok).toBe(true);
        expect(result.data).toEqual({
          roots: [
            {
              homeRelativeRoot: `${tempHome.slice(homedir().length + 1).replace(/\\/g, "/")}/.agents/skills`,
              skills: [
                {
                  slug: "reviewer",
                  files: [
                    {
                      relativePath: "SKILL.md",
                      contentBase64: Buffer.from("# Reviewer\n").toString("base64"),
                    },
                    {
                      relativePath: "notes/tips.md",
                      contentBase64: Buffer.from("tips\n").toString("base64"),
                    },
                  ],
                },
              ],
            },
          ],
        });
      } finally {
        await rm(tempHome, { recursive: true, force: true });
      }
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
      expect(result.error?.code).toBe("workspace_not_found");
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

    it("preserves preview file tab metadata in workspace ui state", async () => {
      const dir = join(tmpdir(), `workspace-command-preview-tab-test-${Date.now()}`);
      await mkdir(dir);

      const openResult = await dispatch(
        {
          kind: "command",
          id: "open-workspace-preview-tab",
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
          id: "set-ui-state-preview-tab",
          op: "workspace.uiState.set",
          args: {
            workspaceId,
            uiState: {
              leftPanelWidth: 320,
              bottomPanelHeight: 210,
              focusMode: false,
              openEditorTabs: [{ kind: "file", path: "src/preview.ts", pinned: false }],
              activeEditorTab: { kind: "file", path: "src/preview.ts", pinned: false },
            },
          },
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect(
        (result.data as { uiState: { openEditorTabs: unknown } }).uiState.openEditorTabs
      ).toEqual([{ kind: "file", path: "src/preview.ts", pinned: false }]);
      expect(
        (result.data as { uiState: { activeEditorTab: unknown } }).uiState.activeEditorTab
      ).toEqual({ kind: "file", path: "src/preview.ts", pinned: false });
    });

    it("persists typed pane leaves with draft and editor kinds", async () => {
      const dir = join(tmpdir(), `workspace-command-typed-pane-test-${Date.now()}`);
      await mkdir(dir);

      const openResult = await dispatch(
        {
          kind: "command",
          id: "open-workspace-typed-pane-layout",
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
          id: "set-ui-state-typed-pane-layout",
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
                  { id: "left", type: "leaf", leafKind: "draft" },
                  { id: "right", type: "leaf", leafKind: "editor" },
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
          { id: "left", type: "leaf", leafKind: "draft" },
          { id: "right", type: "leaf", leafKind: "editor" },
        ],
      });
    });

    it("rejects invalid typed pane leaves", async () => {
      const dir = join(tmpdir(), `workspace-command-invalid-pane-test-${Date.now()}`);
      await mkdir(dir);

      const openResult = await dispatch(
        {
          kind: "command",
          id: "open-workspace-invalid-pane-layout",
          op: "workspace.open",
          args: {
            path: dir,
          },
        },
        ctx
      );

      expect(openResult.ok).toBe(true);
      const workspaceId = (openResult.data as { id: string }).id;

      const draftWithSessionId = await dispatch(
        {
          kind: "command",
          id: "set-ui-state-invalid-draft-pane-layout",
          op: "workspace.uiState.set",
          args: {
            workspaceId,
            uiState: {
              leftPanelWidth: 320,
              bottomPanelHeight: 210,
              focusMode: false,
              paneLayout: {
                id: "root",
                type: "leaf",
                leafKind: "draft",
                sessionId: "sess-invalid",
              },
            },
          },
        },
        ctx
      );
      expect(draftWithSessionId.ok).toBe(false);

      const sessionWithoutSessionId = await dispatch(
        {
          kind: "command",
          id: "set-ui-state-invalid-session-pane-layout",
          op: "workspace.uiState.set",
          args: {
            workspaceId,
            uiState: {
              leftPanelWidth: 320,
              bottomPanelHeight: 210,
              focusMode: false,
              paneLayout: {
                id: "root",
                type: "leaf",
                leafKind: "session",
              },
            },
          },
        },
        ctx
      );
      expect(sessionWithoutSessionId.ok).toBe(false);

      const editorWithSessionId = await dispatch(
        {
          kind: "command",
          id: "set-ui-state-invalid-editor-pane-layout",
          op: "workspace.uiState.set",
          args: {
            workspaceId,
            uiState: {
              leftPanelWidth: 320,
              bottomPanelHeight: 210,
              focusMode: false,
              paneLayout: {
                id: "root",
                type: "leaf",
                leafKind: "editor",
                sessionId: "sess-invalid",
              },
            },
          },
        },
        ctx
      );
      expect(editorWithSessionId.ok).toBe(false);
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

    it("persists open editor paths and the active editor into workspace ui state", async () => {
      const dir = join(tmpdir(), `workspace-open-editors-test-${Date.now()}`);
      await mkdir(dir);

      const openResult = await dispatch(
        {
          kind: "command",
          id: "open-workspace-open-editors",
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
          id: "set-ui-state-open-editors",
          op: "workspace.uiState.set",
          args: {
            workspaceId,
            uiState: {
              leftPanelWidth: 320,
              bottomPanelHeight: 210,
              focusMode: false,
              openEditorPaths: ["README.md", "src/app.tsx"],
              activeEditorPath: "src/app.tsx",
            },
          },
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect(
        (result.data as { uiState: { openEditorPaths?: string[] } }).uiState.openEditorPaths
      ).toEqual(["README.md", "src/app.tsx"]);
      expect(
        (result.data as { uiState: { activeEditorPath?: string | null } }).uiState.activeEditorPath
      ).toBe("src/app.tsx");
    });

    it("persists editor pinned state into workspace ui state", async () => {
      const dir = join(tmpdir(), `workspace-editor-pinned-test-${Date.now()}`);
      await mkdir(dir);

      const openResult = await dispatch(
        {
          kind: "command",
          id: "open-workspace-editor-pinned",
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
          id: "set-ui-state-editor-pinned",
          op: "workspace.uiState.set",
          args: {
            workspaceId,
            uiState: {
              leftPanelWidth: 320,
              bottomPanelHeight: 210,
              focusMode: false,
              editorPinned: false,
            },
          },
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect((result.data as { uiState: { editorPinned?: boolean } }).uiState.editorPinned).toBe(
        false
      );
    });

    it("persists multiple browser editor tabs with duplicate urls", async () => {
      const dir = join(tmpdir(), `workspace-browser-editors-test-${Date.now()}`);
      await mkdir(dir);

      const openResult = await dispatch(
        {
          kind: "command",
          id: "open-workspace-browser-editors",
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
          id: "set-ui-state-browser-editors",
          op: "workspace.uiState.set",
          args: {
            workspaceId,
            uiState: {
              leftPanelWidth: 320,
              bottomPanelHeight: 210,
              focusMode: false,
              openEditorTabs: [
                {
                  kind: "browser",
                  id: "browser-1",
                  url: "localhost:8001",
                  devicePreset: "desktop",
                  viewportWidth: null,
                  viewportHeight: null,
                  orientation: "portrait",
                  userAgentMode: "desktop",
                },
                {
                  kind: "browser",
                  id: "browser-2",
                  url: "localhost:8001",
                  devicePreset: "desktop",
                  viewportWidth: null,
                  viewportHeight: null,
                  orientation: "portrait",
                  userAgentMode: "desktop",
                },
              ],
              activeEditorTab: {
                kind: "browser",
                id: "browser-2",
                url: "localhost:8001",
                devicePreset: "desktop",
                viewportWidth: null,
                viewportHeight: null,
                orientation: "portrait",
                userAgentMode: "desktop",
              },
            },
          },
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect(
        (result.data as { uiState: { openEditorTabs?: unknown[] } }).uiState.openEditorTabs
      ).toEqual([
        {
          kind: "browser",
          id: "browser-1",
          url: "localhost:8001",
          devicePreset: "desktop",
          viewportWidth: null,
          viewportHeight: null,
          orientation: "portrait",
          userAgentMode: "desktop",
        },
        {
          kind: "browser",
          id: "browser-2",
          url: "localhost:8001",
          devicePreset: "desktop",
          viewportWidth: null,
          viewportHeight: null,
          orientation: "portrait",
          userAgentMode: "desktop",
        },
      ]);
      expect(
        (result.data as { uiState: { activeEditorTab?: unknown } }).uiState.activeEditorTab
      ).toEqual({
        kind: "browser",
        id: "browser-2",
        url: "localhost:8001",
        devicePreset: "desktop",
        viewportWidth: null,
        viewportHeight: null,
        orientation: "portrait",
        userAgentMode: "desktop",
      });
    });

    it("accepts persisted browser device settings and returns them in open editor tabs", async () => {
      const dir = join(tmpdir(), `workspace-browser-device-editors-test-${Date.now()}`);
      await mkdir(dir);

      const openResult = await dispatch(
        {
          kind: "command",
          id: "open-workspace-browser-device-editors",
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
          id: "set-ui-state-browser-device-editors",
          op: "workspace.uiState.set",
          args: {
            workspaceId,
            uiState: {
              leftPanelWidth: 320,
              bottomPanelHeight: 210,
              focusMode: false,
              openEditorTabs: [
                {
                  kind: "browser",
                  id: "browser-1",
                  url: "localhost:8001",
                  devicePreset: "iphone-14",
                  viewportWidth: 390,
                  viewportHeight: 844,
                  orientation: "portrait",
                  userAgentMode: "mobile",
                },
              ],
              activeEditorTab: {
                kind: "browser",
                id: "browser-1",
                url: "localhost:8001",
                devicePreset: "iphone-14",
                viewportWidth: 390,
                viewportHeight: 844,
                orientation: "portrait",
                userAgentMode: "mobile",
              },
            },
          },
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect(
        (result.data as { uiState: { openEditorTabs?: unknown[] } }).uiState.openEditorTabs
      ).toEqual([
        {
          kind: "browser",
          id: "browser-1",
          url: "localhost:8001",
          devicePreset: "iphone-14",
          viewportWidth: 390,
          viewportHeight: 844,
          orientation: "portrait",
          userAgentMode: "mobile",
        },
      ]);
    });

    it("drops auto attach state while persisting other agent instruction ui state", async () => {
      const dir = join(tmpdir(), `workspace-agent-instructions-ui-state-${Date.now()}`);
      await mkdir(dir);

      const openResult = await dispatch(
        {
          kind: "command",
          id: "open-workspace-agent-instructions-ui-state",
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
          id: "set-ui-state-agent-instructions",
          op: "workspace.uiState.set",
          args: {
            workspaceId,
            uiState: {
              leftPanelWidth: 320,
              bottomPanelHeight: 210,
              focusMode: false,
              agentInstructionsExpanded: false,
              agentInstructionsAutoAttach: true,
            },
          },
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect(
        (result.data as { uiState: { agentInstructionsExpanded?: boolean } }).uiState
      ).toMatchObject({
        agentInstructionsExpanded: false,
      });
      expect((result.data as { uiState: Record<string, unknown> }).uiState).not.toHaveProperty(
        "agentInstructionsAutoAttach"
      );
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
      await writeFile(
        join(settingsDir, "settings.json"),
        '{\n  "version": 1,\n  "settings": {\n    "workspace.lastViewedTarget": "{not-json"\n  }\n}\n',
        "utf-8"
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
