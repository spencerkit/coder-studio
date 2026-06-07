import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceExtensionStateView } from "@coder-studio/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../bus/event-bus.js";
import { WorkspaceExtensionStateService } from "../extension-state/workspace-extension-state-service.js";
import { WorkspaceExtensionStateRepo } from "../storage/repositories/workspace-extension-state-repo.js";
import { WorkspaceRepo } from "../storage/repositories/workspace-repo.js";
import type { CommandContext } from "../ws/dispatch.js";
import { dispatch } from "../ws/dispatch.js";
import "../commands/workspace-extension-state.js";

describe("workspace extension state commands", () => {
  let tempDir: string;
  let workspaceRepo: WorkspaceRepo;
  let eventBus: EventBus;
  let service: WorkspaceExtensionStateService;
  let ctx: CommandContext;
  let now = 1000;
  const changedEvents: Array<{ workspaceId: string; state: WorkspaceExtensionStateView }> = [];

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "workspace-extension-state-commands-"));
    const workspacePath = join(tempDir, "workspace");
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
    eventBus = new EventBus();
    eventBus.on("workspace.extension_state.changed" as never, (event) => {
      changedEvents.push(event as { workspaceId: string; state: WorkspaceExtensionStateView });
    });
    service = new WorkspaceExtensionStateService({
      repo: new WorkspaceExtensionStateRepo({
        workspaceRepo,
        now: () => now,
      }),
      eventBus,
      now: () => now,
    });
    ctx = {
      workspaceMgr: { get: (workspaceId: string) => workspaceRepo.findById(workspaceId) },
      sessionMgr: {},
      terminalMgr: {},
      eventBus,
      broadcaster: {},
      settingsRepo: {},
      providerConfigRepo: {},
      providerRegistry: [],
      fencingMgr: {},
      supervisorMgr: {},
      autoFetch: {},
      activationMgr: { getLease: vi.fn(() => undefined) },
      lspMgr: {},
      workspaceExtensionStateService: service,
    } as unknown as CommandContext;
  });

  afterEach(async () => {
    changedEvents.length = 0;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("sets and lists status, progress, log, and quick action contributions", async () => {
    await dispatch(
      {
        kind: "command",
        id: "status-set-1",
        op: "workspace.extensionState.statusPills.set",
        args: {
          workspaceId: "ws-1",
          key: "ci",
          label: "CI running",
          state: "running",
          detail: "unit tests",
        },
      },
      ctx
    );
    now = 1100;
    await dispatch(
      {
        kind: "command",
        id: "progress-set-1",
        op: "workspace.extensionState.progress.set",
        args: {
          workspaceId: "ws-1",
          key: "tests",
          label: "Tests",
          value: 42,
          max: 100,
          detail: "unit tests",
        },
      },
      ctx
    );
    now = 1200;
    await dispatch(
      {
        kind: "command",
        id: "log-append-1",
        op: "workspace.extensionState.logs.append",
        args: {
          workspaceId: "ws-1",
          key: "ci",
          message: "Unit tests started",
          level: "info",
        },
      },
      ctx
    );
    await dispatch(
      {
        kind: "command",
        id: "quick-action-set-1",
        op: "workspace.extensionState.quickActions.set",
        args: {
          workspaceId: "ws-1",
          id: "rerun-tests",
          label: "Rerun tests",
          command: "pnpm test",
          description: "Run the focused test suite again",
        },
      },
      ctx
    );

    const result = await dispatch(
      {
        kind: "command",
        id: "extension-state-list-1",
        op: "workspace.extensionState.list",
        args: { workspaceId: "ws-1" },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      workspaceId: "ws-1",
      statusPills: [
        {
          key: "ci",
          label: "CI running",
          state: "running",
          detail: "unit tests",
          updatedAt: 1000,
        },
      ],
      progress: [
        {
          key: "tests",
          label: "Tests",
          value: 42,
          max: 100,
          detail: "unit tests",
          updatedAt: 1100,
        },
      ],
      logs: [
        {
          key: "ci",
          level: "info",
          message: "Unit tests started",
          timestamp: 1200,
        },
      ],
      quickActions: [
        {
          id: "rerun-tests",
          label: "Rerun tests",
          command: "pnpm test",
          description: "Run the focused test suite again",
        },
      ],
      updatedAt: 1200,
    });
    expect(changedEvents).toHaveLength(4);
    expect(changedEvents.at(-1)).toMatchObject({
      workspaceId: "ws-1",
      state: expect.objectContaining({
        quickActions: [expect.objectContaining({ id: "rerun-tests" })],
      }),
    });
  });

  it("clears contributions and broadcasts the resulting workspace extension state", async () => {
    await service.setStatusPill({
      workspaceId: "ws-1",
      key: "ci",
      label: "CI running",
      state: "running",
    });
    await service.setProgress({
      workspaceId: "ws-1",
      key: "tests",
      label: "Tests",
      value: 1,
    });
    await service.appendLog({
      workspaceId: "ws-1",
      key: "ci",
      message: "Unit tests started",
      level: "info",
    });
    await service.setQuickAction({
      workspaceId: "ws-1",
      id: "rerun-tests",
      label: "Rerun tests",
      command: "pnpm test",
    });
    changedEvents.length = 0;

    await dispatch(
      {
        kind: "command",
        id: "status-clear-1",
        op: "workspace.extensionState.statusPills.clear",
        args: { workspaceId: "ws-1", key: "ci" },
      },
      ctx
    );
    await dispatch(
      {
        kind: "command",
        id: "progress-clear-1",
        op: "workspace.extensionState.progress.clear",
        args: { workspaceId: "ws-1", key: "tests" },
      },
      ctx
    );
    await dispatch(
      {
        kind: "command",
        id: "logs-clear-1",
        op: "workspace.extensionState.logs.clear",
        args: { workspaceId: "ws-1", key: "ci" },
      },
      ctx
    );
    const result = await dispatch(
      {
        kind: "command",
        id: "quick-action-clear-1",
        op: "workspace.extensionState.quickActions.clear",
        args: { workspaceId: "ws-1", id: "rerun-tests" },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      workspaceId: "ws-1",
      statusPills: [],
      progress: [],
      logs: [],
      quickActions: [],
    });
    expect(changedEvents).toHaveLength(4);
    expect(changedEvents.at(-1)?.state.quickActions).toEqual([]);
  });

  it("lists individual workspace extension state contribution categories", async () => {
    service.setStatusPill({
      workspaceId: "ws-1",
      key: "ci",
      label: "CI running",
      state: "running",
    });
    service.setProgress({
      workspaceId: "ws-1",
      key: "tests",
      label: "Tests",
      value: 1,
    });
    service.appendLog({
      workspaceId: "ws-1",
      key: "ci",
      message: "Unit tests started",
      level: "info",
    });
    service.setQuickAction({
      workspaceId: "ws-1",
      id: "rerun-tests",
      label: "Rerun tests",
      command: "pnpm test",
    });

    await expect(
      dispatch(
        {
          kind: "command",
          id: "status-pills-list-1",
          op: "workspace.extensionState.statusPills.list",
          args: { workspaceId: "ws-1" },
        },
        ctx
      )
    ).resolves.toMatchObject({
      ok: true,
      data: [expect.objectContaining({ key: "ci" })],
    });
    await expect(
      dispatch(
        {
          kind: "command",
          id: "progress-list-1",
          op: "workspace.extensionState.progress.list",
          args: { workspaceId: "ws-1" },
        },
        ctx
      )
    ).resolves.toMatchObject({
      ok: true,
      data: [expect.objectContaining({ key: "tests" })],
    });
    await expect(
      dispatch(
        {
          kind: "command",
          id: "logs-list-1",
          op: "workspace.extensionState.logs.list",
          args: { workspaceId: "ws-1" },
        },
        ctx
      )
    ).resolves.toMatchObject({
      ok: true,
      data: [expect.objectContaining({ key: "ci" })],
    });
    await expect(
      dispatch(
        {
          kind: "command",
          id: "quick-actions-list-1",
          op: "workspace.extensionState.quickActions.list",
          args: { workspaceId: "ws-1" },
        },
        ctx
      )
    ).resolves.toMatchObject({
      ok: true,
      data: [expect.objectContaining({ id: "rerun-tests" })],
    });
  });

  it("allows workspace extension state commands from WebSocket callers without an activation lease", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "extension-state-ws-1",
        op: "workspace.extensionState.statusPills.set",
        args: {
          workspaceId: "ws-1",
          key: "ci",
          label: "CI running",
          state: "running",
        },
      },
      ctx,
      "script-client"
    );

    expect(result.ok).toBe(true);
    expect(ctx.activationMgr.getLease).not.toHaveBeenCalled();
  });

  it("returns a typed unavailable error when the service is not configured", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "extension-state-unavailable-1",
        op: "workspace.extensionState.list",
        args: { workspaceId: "ws-1" },
      },
      {
        ...ctx,
        workspaceExtensionStateService: undefined,
      },
      "script-client"
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("workspace_extension_state_unavailable");
  });
});
