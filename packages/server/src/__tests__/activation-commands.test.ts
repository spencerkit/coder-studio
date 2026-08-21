import type { FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { RequestAuthContext } from "../auth/plugin.js";
import { ActivationManager } from "../ws/activation.js";
import { type CommandContext, dispatch } from "../ws/dispatch.js";
import type { Broadcaster } from "../ws/hub.js";
import "../commands/activation.js";
import "../commands/automation.js";
import "../commands/canvas.js";
import "../commands/memory.js";
import "../commands/workspace.js";
import "../commands/workspace-activity.js";
import "../commands/ui-actions.js";

function createMockRequest(authContext?: RequestAuthContext): FastifyRequest {
  return {
    ip: "127.0.0.1",
    headers: { "user-agent": "test-agent" },
    ...(authContext ? { coderStudioAuthContext: authContext } : {}),
  } as unknown as FastifyRequest;
}

function createBaseContext(overrides?: {
  broadcaster?: Broadcaster;
  activationMgr?: ActivationManager;
}): CommandContext {
  return {
    workspaceMgr: {
      list: vi.fn(() => [{ id: "workspace-1" }]),
    } as unknown as CommandContext["workspaceMgr"],
    sessionMgr: {} as never,
    terminalMgr: {
      getRingBufferTail: vi.fn(() => Buffer.from("tail")),
    } as unknown as CommandContext["terminalMgr"],
    eventBus: {} as never,
    broadcaster:
      overrides?.broadcaster ??
      ({
        broadcast: vi.fn(),
        sendToClient: vi.fn(() => true),
        sendBinaryToClient: vi.fn(() => true),
      } as unknown as Broadcaster),
    providerRegistry: [],
    fencingMgr: {} as never,
    supervisorMgr: {} as never,
    autoFetch: {} as never,
    activationMgr: overrides?.activationMgr ?? new ActivationManager(),
    memoryRepo: {
      list: vi.fn(() => []),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    } as never,
    settingsRepo: {
      get: vi.fn(() => undefined),
      set: vi.fn(),
      delete: vi.fn(),
      getAll: vi.fn(() => ({})),
    } as never,
    canvasService: {
      list: vi.fn(async (workspaceId: string) =>
        workspaceId === "workspace-1" ? [{ id: "canvas-1", workspaceId }] : []
      ),
    } as never,
    workspaceMgr: {
      list: vi.fn(() => [{ id: "workspace-1" }]),
      get: vi.fn((workspaceId: string) =>
        workspaceId === "workspace-1" ? { id: "workspace-1", path: "/repo" } : undefined
      ),
    } as unknown as CommandContext["workspaceMgr"],
    sessionMgr: {
      getForWorkspace: vi.fn((workspaceId: string) =>
        workspaceId === "workspace-1"
          ? [
              {
                id: "sess-1",
                workspaceId: "workspace-1",
                terminalId: "term-1",
                providerId: "codex",
                state: "running",
                capability: "full",
                startedAt: 1,
                lastActiveAt: 1,
              },
            ]
          : []
      ),
      get: vi.fn((sessionId: string) =>
        sessionId === "sess-1"
          ? {
              id: "sess-1",
              workspaceId: "workspace-1",
              terminalId: "term-1",
              providerId: "codex",
              state: "running",
              capability: "full",
              startedAt: 1,
              lastActiveAt: 1,
            }
          : undefined
      ),
      findSessionIdByTerminal: vi.fn((terminalId: string) =>
        terminalId === "term-1" ? "sess-1" : undefined
      ),
    } as unknown as CommandContext["sessionMgr"],
  };
}

describe("activation commands", () => {
  it("returns generation data from activation.claim", async () => {
    const request = createMockRequest();
    const broadcaster = {
      broadcast: vi.fn(),
      sendToClient: vi.fn(() => true),
      sendBinaryToClient: vi.fn(() => true),
      getRequestMetadata: vi.fn(() => request),
    } satisfies Broadcaster;
    const ctx = createBaseContext({ broadcaster });

    const result = await dispatch(
      {
        kind: "command",
        id: "00000000-0000-4000-8000-000000000001",
        op: "activation.claim",
        args: { clientInstanceId: "client-a" },
      },
      ctx,
      "ws-a"
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      active: true,
      generation: 1,
      recoveryMode: "fresh",
    });
    expect(broadcaster.getRequestMetadata).toHaveBeenCalledWith("ws-a");
    expect(ctx.activationMgr.getLease()).toMatchObject({
      clientInstanceId: "client-a",
      wsClientId: "ws-a",
      ip: "127.0.0.1",
      userAgent: "test-agent",
    });
  });

  it("allows read-only automation commands for websocket clients without an active lease", async () => {
    const broadcaster = {
      broadcast: vi.fn(),
      sendToClient: vi.fn(() => true),
      sendBinaryToClient: vi.fn(() => true),
      getRequestMetadata: vi.fn(() => createMockRequest()),
    } satisfies Broadcaster;
    const ctx = createBaseContext({ broadcaster });

    const result = await dispatch(
      {
        kind: "command",
        id: "00000000-0000-4000-8000-000000000002",
        op: "workspace.list",
        args: {},
      },
      ctx,
      "ws-a"
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual([{ id: "workspace-1" }]);
  });

  it("allows workspace last-viewed-target reads for websocket clients without an active lease", async () => {
    const broadcaster = {
      broadcast: vi.fn(),
      sendToClient: vi.fn(() => true),
      sendBinaryToClient: vi.fn(() => true),
      getRequestMetadata: vi.fn(() => createMockRequest()),
    } satisfies Broadcaster;
    const ctx = createBaseContext({ broadcaster });

    const result = await dispatch(
      {
        kind: "command",
        id: "00000000-0000-4000-8000-000000000002a",
        op: "workspace.lastViewedTarget.get",
        args: {},
      },
      ctx,
      "ws-a"
    );

    expect(result.ok).toBe(true);
    expect(result.data).toBeNull();
  });

  it("rejects non-allowlisted commands for websocket clients without an active lease", async () => {
    const broadcaster = {
      broadcast: vi.fn(),
      sendToClient: vi.fn(() => true),
      sendBinaryToClient: vi.fn(() => true),
      getRequestMetadata: vi.fn(() => createMockRequest()),
    } satisfies Broadcaster;
    const ctx = createBaseContext({ broadcaster });

    const result = await dispatch(
      {
        kind: "command",
        id: "00000000-0000-4000-8000-000000000003",
        op: "workspace.open",
        args: {
          path: "/tmp/project",
        },
      },
      ctx,
      "ws-a"
    );

    expect(result.ok).toBe(false);
    expect(result.error).toEqual({
      code: "activation_required",
      message: "This tab is no longer the active session",
    });
  });

  it("rejects non-allowlisted websocket commands when metadata lookup returns undefined", async () => {
    const broadcaster = {
      broadcast: vi.fn(),
      sendToClient: vi.fn(() => true),
      sendBinaryToClient: vi.fn(() => true),
      getRequestMetadata: vi.fn(() => undefined),
    } satisfies Broadcaster;
    const ctx = createBaseContext({ broadcaster });

    const result = await dispatch(
      {
        kind: "command",
        id: "00000000-0000-4000-8000-000000000004",
        op: "workspace.open",
        args: {
          path: "/tmp/project",
        },
      },
      ctx,
      "ws-a"
    );

    expect(result.ok).toBe(false);
    expect(result.error).toEqual({
      code: "activation_required",
      message: "This tab is no longer the active session",
    });
  });

  it("does not allow a stale websocket to release after same-client rebind", async () => {
    const request = createMockRequest();
    const broadcaster = {
      broadcast: vi.fn(),
      sendToClient: vi.fn(() => true),
      sendBinaryToClient: vi.fn(() => true),
      getRequestMetadata: vi.fn(() => request),
    } satisfies Broadcaster;
    const ctx = createBaseContext({ broadcaster });

    await dispatch(
      {
        kind: "command",
        id: "claim-3",
        op: "activation.claim",
        args: { clientInstanceId: "client-a" },
      },
      ctx,
      "ws-a"
    );

    await dispatch(
      {
        kind: "command",
        id: "claim-4",
        op: "activation.claim",
        args: { clientInstanceId: "client-a" },
      },
      ctx,
      "ws-b"
    );

    const release = await dispatch(
      {
        kind: "command",
        id: "release-stale",
        op: "activation.release",
        args: { clientInstanceId: "client-a", generation: 1 },
      },
      ctx,
      "ws-a"
    );

    expect(release.ok).toBe(true);
    expect(release.data).toEqual({ ok: false });
    expect(ctx.activationMgr.getLease()).toMatchObject({
      clientInstanceId: "client-a",
      wsClientId: "ws-b",
      generation: 1,
    });
  });

  it("claiming from a second client revokes the previous websocket", async () => {
    const request = createMockRequest();
    const revokeAndCloseClient = vi.fn();
    const ctx = createBaseContext({
      broadcaster: {
        broadcast: vi.fn(),
        sendToClient: vi.fn(() => true),
        sendBinaryToClient: vi.fn(() => true),
        getRequestMetadata: vi.fn(() => request),
        revokeAndCloseClient,
      } as unknown as Broadcaster,
    });

    await dispatch(
      {
        kind: "command",
        id: "00000000-0000-4000-8000-000000000003",
        op: "activation.claim",
        args: { clientInstanceId: "client-a" },
      },
      ctx,
      "ws-a"
    );

    await dispatch(
      {
        kind: "command",
        id: "00000000-0000-4000-8000-000000000004",
        op: "activation.claim",
        args: { clientInstanceId: "client-b" },
      },
      ctx,
      "ws-b"
    );

    expect(revokeAndCloseClient).toHaveBeenCalledWith("ws-a", 2);
  });

  it("does not block direct internal dispatches without websocket request metadata", async () => {
    const ctx = createBaseContext();

    const result = await dispatch(
      {
        kind: "command",
        id: "00000000-0000-4000-8000-000000000003",
        op: "workspace.list",
        args: {},
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual([{ id: "workspace-1" }]);
  });

  it("allows token-auth websocket commands within the scoped permission set without an active lease", async () => {
    const request = createMockRequest({
      mode: "session_token",
      token: "tok-1",
      sessionId: "sess-1",
      workspaceId: "workspace-1",
      providerId: "codex",
      permissions: ["session:read", "memory:read", "ui:command"],
      createdAt: 1,
    });
    const broadcaster = {
      broadcast: vi.fn(),
      sendToClient: vi.fn(() => true),
      sendBinaryToClient: vi.fn(() => true),
      getRequestMetadata: vi.fn(() => request),
    } satisfies Broadcaster;
    const ctx = createBaseContext({ broadcaster });

    const memoryList = await dispatch(
      {
        kind: "command",
        id: "token-memory-list",
        op: "memory.list",
        args: { workspaceId: "workspace-1" },
      },
      ctx,
      "ws-token"
    );

    const uiDispatch = await dispatch(
      {
        kind: "command",
        id: "token-ui-dispatch",
        op: "uiAction.dispatch",
        args: {
          workspaceId: "workspace-1",
          intent: { type: "command.run", commandId: "quickOpen.open" },
        },
      },
      ctx,
      "ws-token"
    );

    expect(memoryList.ok).toBe(true);
    expect(uiDispatch.ok).toBe(true);
  });

  it("rejects token-auth websocket commands outside the scoped permission set", async () => {
    const request = createMockRequest({
      mode: "session_token",
      token: "tok-2",
      sessionId: "sess-1",
      workspaceId: "workspace-1",
      providerId: "codex",
      permissions: ["session:read"],
      createdAt: 1,
    });
    const broadcaster = {
      broadcast: vi.fn(),
      sendToClient: vi.fn(() => true),
      sendBinaryToClient: vi.fn(() => true),
      getRequestMetadata: vi.fn(() => request),
    } satisfies Broadcaster;
    const ctx = createBaseContext({ broadcaster });

    const result = await dispatch(
      {
        kind: "command",
        id: "token-workspace-list",
        op: "workspace.list",
        args: {},
      },
      ctx,
      "ws-token"
    );

    expect(result.ok).toBe(false);
    expect(result.error).toEqual({
      code: "permission_denied",
      message: "Token is not authorized for this command",
    });
  });

  it("allows token-auth websocket canvas commands within the scoped permission set", async () => {
    const request = createMockRequest({
      mode: "session_token",
      token: "tok-canvas-1",
      sessionId: "sess-1",
      workspaceId: "workspace-1",
      providerId: "codex",
      permissions: ["memory:read"],
      createdAt: 1,
    });
    const broadcaster = {
      broadcast: vi.fn(),
      sendToClient: vi.fn(() => true),
      sendBinaryToClient: vi.fn(() => true),
      getRequestMetadata: vi.fn(() => request),
    } satisfies Broadcaster;
    const ctx = createBaseContext({ broadcaster });

    const result = await dispatch(
      {
        kind: "command",
        id: "token-canvas-list",
        op: "canvas.list",
        args: { workspaceId: "workspace-1" },
      },
      ctx,
      "ws-token"
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual([{ id: "canvas-1", workspaceId: "workspace-1" }]);
  });

  it("allows token-auth websocket extended canvas commands within the scoped permission set", async () => {
    const cases = [
      {
        op: "canvas.preset.list",
        args: { workspaceId: "workspace-1" },
        permissions: ["memory:read"],
        expected: [{ id: "token-consumption-trend" }],
      },
      {
        op: "canvas.create-from-preset",
        args: {
          workspaceId: "workspace-1",
          presetId: "token-consumption-trend",
          title: "Token Consumption",
        },
        permissions: ["memory:write"],
        expected: { record: { id: "canvas-preset-1" } },
      },
      {
        op: "canvas.snapshot.create",
        args: {
          workspaceId: "workspace-1",
          sourcePath: ".coder-studio/canvases/token-consumption.csc",
        },
        permissions: ["memory:write"],
        expected: { snapshotId: "snapshot-1" },
      },
      {
        op: "canvas.clone",
        args: {
          workspaceId: "workspace-1",
          sourcePath: ".coder-studio/canvases/token-consumption.csc",
          title: "Token Consumption Copy",
        },
        permissions: ["memory:write"],
        expected: { record: { id: "canvas-clone-1" } },
      },
      {
        op: "canvas.inspect",
        args: {
          workspaceId: "workspace-1",
          sourcePath: ".coder-studio/canvases/token-consumption.csc",
        },
        permissions: ["memory:read"],
        expected: { sceneManifest: { version: 1, elements: [] } },
      },
    ];

    for (const entry of cases) {
      const request = createMockRequest({
        mode: "session_token",
        token: `tok-${entry.op}`,
        sessionId: "sess-1",
        workspaceId: "workspace-1",
        providerId: "codex",
        permissions: entry.permissions,
        createdAt: 1,
      });
      const broadcaster = {
        broadcast: vi.fn(),
        sendToClient: vi.fn(() => true),
        sendBinaryToClient: vi.fn(() => true),
        getRequestMetadata: vi.fn(() => request),
      } satisfies Broadcaster;
      const ctx = createBaseContext({ broadcaster });
      ctx.canvasService = {
        list: vi.fn(),
        listPresets: vi.fn(async () => [{ id: "token-consumption-trend" }]),
        createFromPreset: vi.fn(async () => ({ record: { id: "canvas-preset-1" } })),
        createSnapshot: vi.fn(async () => ({ snapshotId: "snapshot-1" })),
        cloneCanvas: vi.fn(async () => ({ record: { id: "canvas-clone-1" } })),
        getCanvasInspectionData: vi.fn(async () => ({
          sceneManifest: { version: 1, elements: [] },
        })),
      } as never;

      const result = await dispatch(
        {
          kind: "command",
          id: `token-${entry.op}`,
          op: entry.op,
          args: entry.args,
        },
        ctx,
        "ws-token"
      );

      expect(result.ok).toBe(true);
      expect(result.data).toEqual(entry.expected);
    }
  });

  it("rejects token-auth websocket extended canvas commands that target another workspace", async () => {
    const request = createMockRequest({
      mode: "session_token",
      token: "tok-canvas-cross-workspace",
      sessionId: "sess-1",
      workspaceId: "workspace-1",
      providerId: "codex",
      permissions: ["memory:read"],
      createdAt: 1,
    });
    const broadcaster = {
      broadcast: vi.fn(),
      sendToClient: vi.fn(() => true),
      sendBinaryToClient: vi.fn(() => true),
      getRequestMetadata: vi.fn(() => request),
    } satisfies Broadcaster;
    const ctx = createBaseContext({ broadcaster });

    const result = await dispatch(
      {
        kind: "command",
        id: "token-canvas-inspect-cross-workspace",
        op: "canvas.inspect",
        args: {
          workspaceId: "workspace-2",
          sourcePath: ".coder-studio/canvases/token-consumption.csc",
        },
      },
      ctx,
      "ws-token"
    );

    expect(result.ok).toBe(false);
    expect(result.error).toEqual({
      code: "permission_denied",
      message: "Token is not authorized for the requested workspace",
    });
  });

  it("rejects token-auth websocket commands that target another workspace", async () => {
    const request = createMockRequest({
      mode: "session_token",
      token: "tok-3",
      sessionId: "sess-1",
      workspaceId: "workspace-1",
      providerId: "codex",
      permissions: ["memory:read"],
      createdAt: 1,
    });
    const broadcaster = {
      broadcast: vi.fn(),
      sendToClient: vi.fn(() => true),
      sendBinaryToClient: vi.fn(() => true),
      getRequestMetadata: vi.fn(() => request),
    } satisfies Broadcaster;
    const ctx = createBaseContext({ broadcaster });

    const result = await dispatch(
      {
        kind: "command",
        id: "token-memory-cross-workspace",
        op: "memory.list",
        args: { workspaceId: "workspace-2" },
      },
      ctx,
      "ws-token"
    );

    expect(result.ok).toBe(false);
    expect(result.error).toEqual({
      code: "permission_denied",
      message: "Token is not authorized for the requested workspace",
    });
  });

  it("rejects token-auth uiAction.dispatch when payload workspace ids conflict", async () => {
    const request = createMockRequest({
      mode: "session_token",
      token: "tok-ui-cross-workspace",
      sessionId: "sess-1",
      workspaceId: "workspace-1",
      providerId: "codex",
      permissions: ["ui:navigate"],
      createdAt: 1,
    });
    const broadcaster = {
      broadcast: vi.fn(),
      sendToClient: vi.fn(() => true),
      sendBinaryToClient: vi.fn(() => true),
      getRequestMetadata: vi.fn(() => request),
    } satisfies Broadcaster;
    const ctx = createBaseContext({ broadcaster });

    const result = await dispatch(
      {
        kind: "command",
        id: "token-ui-cross-workspace",
        op: "uiAction.dispatch",
        args: {
          workspaceId: "workspace-1",
          intent: {
            type: "editor.openFile",
            workspaceId: "workspace-2",
            path: "src/index.ts",
          },
        },
      },
      ctx,
      "ws-token"
    );

    expect(result.ok).toBe(false);
    expect(result.error).toEqual({
      code: "permission_denied",
      message: "Token is not authorized for the requested workspace",
    });
  });

  it("rejects token-auth websocket terminal reads for another session", async () => {
    const request = createMockRequest({
      mode: "session_token",
      token: "tok-4",
      sessionId: "sess-1",
      workspaceId: "workspace-1",
      providerId: "codex",
      permissions: ["terminal:read"],
      createdAt: 1,
    });
    const broadcaster = {
      broadcast: vi.fn(),
      sendToClient: vi.fn(() => true),
      sendBinaryToClient: vi.fn(() => true),
      getRequestMetadata: vi.fn(() => request),
    } satisfies Broadcaster;
    const ctx = createBaseContext({ broadcaster });
    ctx.sessionMgr.findSessionIdByTerminal = vi.fn(() => "sess-other");

    const result = await dispatch(
      {
        kind: "command",
        id: "token-terminal-cross-session",
        op: "terminal.read",
        args: { terminalId: "term-2" },
      },
      ctx,
      "ws-token"
    );

    expect(result.ok).toBe(false);
    expect(result.error).toEqual({
      code: "permission_denied",
      message: "Token is not authorized for the requested session",
    });
  });
});
