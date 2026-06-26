import { Topics } from "@coder-studio/core";
import { describe, expect, it, vi } from "vitest";
import "../commands/ui-actions.js";
import type { CommandContext } from "../ws/dispatch.js";
import { dispatch } from "../ws/dispatch.js";

function createContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    workspaceMgr: {} as never,
    sessionMgr: {} as never,
    terminalMgr: {} as never,
    taskMgr: {} as never,
    eventBus: {} as never,
    broadcaster: {
      broadcast: vi.fn(),
    } as never,
    settingsRepo: {} as never,
    providerConfigRepo: {} as never,
    providerRegistry: [],
    fencingMgr: {} as never,
    supervisorMgr: {} as never,
    autoFetch: {} as never,
    activationMgr: { getLease: () => undefined } as never,
    lspMgr: {} as never,
    ...overrides,
  } as CommandContext;
}

describe("ui action commands", () => {
  it("returns UI action capabilities", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "ui-capabilities-1",
        op: "uiAction.capabilities",
        args: { permissions: ["ui:navigate"] },
      },
      createContext()
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      version: 1,
      actions: expect.arrayContaining([expect.objectContaining({ type: "editor.openFile" })]),
    });
  });

  it("validates, broadcasts, and returns accepted dispatch metadata", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1234);
    const ctx = createContext();

    const result = await dispatch(
      {
        kind: "command",
        id: "ui-dispatch-1",
        op: "uiAction.dispatch",
        args: {
          intent: { type: "editor.openFile", workspaceId: "ws-1", path: "src/index.ts" },
          requestId: "req-1",
          source: { kind: "agent", sessionId: "sess-1", providerId: "codex" },
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      accepted: true,
      requestId: "req-1",
      topic: Topics.workspaceUiAction("ws-1"),
    });
    expect(ctx.broadcaster.broadcast).toHaveBeenCalledWith(Topics.workspaceUiAction("ws-1"), {
      requestId: "req-1",
      workspaceId: "ws-1",
      intent: { type: "editor.openFile", workspaceId: "ws-1", path: "src/index.ts" },
      source: { kind: "agent", sessionId: "sess-1", providerId: "codex" },
      dispatchedAt: 1234,
    });

    vi.useRealTimers();
  });

  it("validates and broadcasts close-file dispatches", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(2234);
    const ctx = createContext();

    const result = await dispatch(
      {
        kind: "command",
        id: "ui-dispatch-close-file-1",
        op: "uiAction.dispatch",
        args: {
          workspaceId: "ws-1",
          intent: { type: "editor.closeFile", path: "src/index.ts" },
          requestId: "req-close-file-1",
          source: { kind: "agent", sessionId: "sess-1", providerId: "codex" },
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      accepted: true,
      requestId: "req-close-file-1",
      topic: Topics.workspaceUiAction("ws-1"),
    });
    expect(ctx.broadcaster.broadcast).toHaveBeenCalledWith(Topics.workspaceUiAction("ws-1"), {
      requestId: "req-close-file-1",
      workspaceId: "ws-1",
      intent: { type: "editor.closeFile", path: "src/index.ts" },
      source: { kind: "agent", sessionId: "sess-1", providerId: "codex" },
      dispatchedAt: 2234,
    });

    vi.useRealTimers();
  });

  it("validates and broadcasts normalized close-url dispatches", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(3234);
    const ctx = createContext();

    const result = await dispatch(
      {
        kind: "command",
        id: "ui-dispatch-close-url-1",
        op: "uiAction.dispatch",
        args: {
          workspaceId: "ws-1",
          intent: { type: "browser.closeUrl", url: "http://127.0.0.1:5173" },
          requestId: "req-close-url-1",
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      accepted: true,
      requestId: "req-close-url-1",
      topic: Topics.workspaceUiAction("ws-1"),
    });
    expect(ctx.broadcaster.broadcast).toHaveBeenCalledWith(Topics.workspaceUiAction("ws-1"), {
      requestId: "req-close-url-1",
      workspaceId: "ws-1",
      intent: { type: "browser.closeUrl", url: "http://127.0.0.1:5173/" },
      source: undefined,
      dispatchedAt: 3234,
    });

    vi.useRealTimers();
  });

  it("uses fallback workspaceId when the intent does not include one", async () => {
    const ctx = createContext();

    const result = await dispatch(
      {
        kind: "command",
        id: "ui-dispatch-2",
        op: "uiAction.dispatch",
        args: {
          workspaceId: "ws-fallback",
          intent: { type: "panel.show", panel: "terminal" },
          requestId: "req-2",
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ topic: Topics.workspaceUiAction("ws-fallback") });
  });

  it("hydrates and broadcasts canvas.open intents from a source path without caller metadata", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(4234);
    const ctx = createContext({
      workspaceMgr: {
        get: vi.fn((workspaceId: string) =>
          workspaceId === "ws-1" ? { id: "ws-1", path: "/workspace" } : undefined
        ),
      } as never,
      canvasService: {
        getCanvasData: vi.fn(async () => ({
          canvasId: "canvas-1",
          workspaceId: "ws-1",
          sourcePath: ".coder-studio/canvases/runtime-flow.csc",
          title: "Runtime Flow",
          kind: "architecture_canvas",
          renderStatus: "ready",
          lastError: null,
          compiledDocument: {
            kind: "architecture_canvas",
            title: "Runtime Flow",
            summary: "How requests move.",
            sections: [],
          },
        })),
      } as never,
    });

    const result = await dispatch(
      {
        kind: "command",
        id: "ui-dispatch-open-canvas-1",
        op: "uiAction.dispatch",
        args: {
          workspaceId: "ws-1",
          intent: {
            type: "canvas.open",
            sourcePath: ".coder-studio/canvases/runtime-flow.csc",
          },
          requestId: "req-open-canvas-1",
          source: { kind: "agent", sessionId: "sess-1", providerId: "codex" },
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      accepted: true,
      requestId: "req-open-canvas-1",
      topic: Topics.workspaceUiAction("ws-1"),
    });
    expect(ctx.broadcaster.broadcast).toHaveBeenCalledWith(Topics.workspaceUiAction("ws-1"), {
      requestId: "req-open-canvas-1",
      workspaceId: "ws-1",
      intent: {
        type: "canvas.open",
        workspaceId: "ws-1",
        canvasId: "canvas-1",
        title: "Runtime Flow",
        artifactType: "architecture_canvas",
        sourcePath: ".coder-studio/canvases/runtime-flow.csc",
      },
      source: { kind: "agent", sessionId: "sess-1", providerId: "codex" },
      dispatchedAt: 4234,
    });

    vi.useRealTimers();
  });

  it("resolves canvas.open metadata from canvasId compatibility input before broadcasting", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(4734);
    const ctx = createContext({
      workspaceMgr: {
        get: vi.fn((workspaceId: string) =>
          workspaceId === "ws-1" ? { id: "ws-1", path: "/workspace" } : undefined
        ),
      } as never,
      canvasService: {
        getRecord: vi.fn((workspaceId: string, canvasId: string) =>
          workspaceId === "ws-1" && canvasId === "canvas_123"
            ? {
                id: "canvas_123",
                workspaceId: "ws-1",
                title: "Runtime Flow",
                artifactType: "architecture_canvas",
                sourcePath: ".coder-studio/canvases/runtime-flow.csc",
              }
            : undefined
        ),
        getCanvasData: vi.fn(async () => ({
          canvasId: "canvas_123",
          workspaceId: "ws-1",
          sourcePath: ".coder-studio/canvases/runtime-flow.csc",
          title: "Runtime Flow",
          kind: "architecture_canvas",
          renderStatus: "ready",
          lastError: null,
          compiledDocument: {
            kind: "architecture_canvas",
            title: "Runtime Flow",
            summary: "How requests move.",
            sections: [],
          },
        })),
      } as never,
    });

    const result = await dispatch(
      {
        kind: "command",
        id: "ui-dispatch-open-canvas-compat-1",
        op: "uiAction.dispatch",
        args: {
          workspaceId: "ws-1",
          intent: { type: "canvas.open", canvasId: "canvas_123" },
          requestId: "req-open-canvas-compat-1",
          source: { kind: "agent", sessionId: "sess-1", providerId: "codex" },
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      accepted: true,
      requestId: "req-open-canvas-compat-1",
      topic: Topics.workspaceUiAction("ws-1"),
    });
    expect(ctx.broadcaster.broadcast).toHaveBeenCalledWith(Topics.workspaceUiAction("ws-1"), {
      requestId: "req-open-canvas-compat-1",
      workspaceId: "ws-1",
      intent: {
        type: "canvas.open",
        workspaceId: "ws-1",
        canvasId: "canvas_123",
        title: "Runtime Flow",
        artifactType: "architecture_canvas",
        sourcePath: ".coder-studio/canvases/runtime-flow.csc",
      },
      source: { kind: "agent", sessionId: "sess-1", providerId: "codex" },
      dispatchedAt: 4734,
    });

    vi.useRealTimers();
  });

  it("prefers canonical canvas metadata over client-supplied canvas.open metadata", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(5234);
    const ctx = createContext({
      workspaceMgr: {
        get: vi.fn((workspaceId: string) =>
          workspaceId === "ws-1" ? { id: "ws-1", path: "/workspace" } : undefined
        ),
      } as never,
      canvasService: {
        getRecord: vi.fn((workspaceId: string, canvasId: string) =>
          workspaceId === "ws-1" && canvasId === "canvas-1"
            ? {
                id: "canvas-1",
                workspaceId: "ws-1",
                title: "Runtime Flow",
                artifactType: "architecture_canvas",
                sourcePath: ".coder-studio/canvases/runtime-flow.csc",
              }
            : undefined
        ),
        getCanvasData: vi.fn(async () => ({
          canvasId: "canvas-1",
          workspaceId: "ws-1",
          sourcePath: ".coder-studio/canvases/runtime-flow.csc",
          title: "Runtime Flow",
          kind: "architecture_canvas",
          renderStatus: "ready",
          lastError: null,
          compiledDocument: {
            kind: "architecture_canvas",
            title: "Runtime Flow",
            summary: "How requests move.",
            sections: [],
          },
        })),
      } as never,
    });

    const result = await dispatch(
      {
        kind: "command",
        id: "ui-dispatch-open-canvas-2",
        op: "uiAction.dispatch",
        args: {
          workspaceId: "ws-1",
          intent: {
            type: "canvas.open",
            canvasId: "canvas-1",
            title: "Wrong Title",
            artifactType: "report_canvas",
            sourcePath: "docs/wrong.csc",
          },
          requestId: "req-open-canvas-2",
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(ctx.broadcaster.broadcast).toHaveBeenCalledWith(Topics.workspaceUiAction("ws-1"), {
      requestId: "req-open-canvas-2",
      workspaceId: "ws-1",
      intent: {
        type: "canvas.open",
        workspaceId: "ws-1",
        canvasId: "canvas-1",
        title: "Runtime Flow",
        artifactType: "architecture_canvas",
        sourcePath: ".coder-studio/canvases/runtime-flow.csc",
      },
      source: undefined,
      dispatchedAt: 5234,
    });

    vi.useRealTimers();
  });

  it("rejects canvas.open when the canvas metadata cannot be resolved", async () => {
    const ctx = createContext({
      workspaceMgr: {
        get: vi.fn((workspaceId: string) =>
          workspaceId === "ws-1" ? { id: "ws-1", path: "/workspace" } : undefined
        ),
      } as never,
      canvasService: {
        getRecord: vi.fn(() => undefined),
        getCanvasData: vi.fn(async () => {
          throw { code: "canvas_not_found", message: "Canvas not found: missing-canvas" };
        }),
      } as never,
    });

    const result = await dispatch(
      {
        kind: "command",
        id: "ui-dispatch-open-canvas-missing-1",
        op: "uiAction.dispatch",
        args: {
          workspaceId: "ws-1",
          intent: { type: "canvas.open", canvasId: "missing-canvas" },
        },
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({
      code: "canvas_not_found",
    });
    expect(ctx.broadcaster.broadcast).not.toHaveBeenCalled();
  });
  it("rejects unsafe UI action intents before broadcasting", async () => {
    const ctx = createContext();

    const result = await dispatch(
      {
        kind: "command",
        id: "ui-dispatch-unsafe-1",
        op: "uiAction.dispatch",
        args: {
          workspaceId: "ws-1",
          intent: { type: "browser.openUrl", url: "https://example.com" },
        },
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("internal_error");
    expect(ctx.broadcaster.broadcast).not.toHaveBeenCalled();
  });

  it("rejects unsafe close-url intents before broadcasting", async () => {
    const ctx = createContext();

    const result = await dispatch(
      {
        kind: "command",
        id: "ui-dispatch-unsafe-close-url-1",
        op: "uiAction.dispatch",
        args: {
          workspaceId: "ws-1",
          intent: { type: "browser.closeUrl", url: "https://example.com" },
        },
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("internal_error");
    expect(ctx.broadcaster.broadcast).not.toHaveBeenCalled();
  });
});
