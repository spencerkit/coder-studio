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
