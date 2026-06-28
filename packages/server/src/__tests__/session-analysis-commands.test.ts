import { describe, expect, it, vi } from "vitest";
import type { CommandContext } from "../ws/dispatch.js";
import { dispatch, executeRuntimeCommand } from "../ws/dispatch.js";

import "../commands/session.js";

describe("session analysis commands", () => {
  function createContext(): CommandContext {
    const sessionAnalysisService = {
      get: vi.fn(() => ({ sessionId: "sess-1", status: "succeeded" })),
      run: vi.fn(async () => ({ sessionId: "sess-1", status: "running" })),
    };
    let runtimeCtxRef: CommandContext;

    const ctx = {
      workspaceMgr: {} as never,
      sessionMgr: {} as never,
      terminalMgr: {} as never,
      eventBus: {} as never,
      broadcaster: {} as never,
      settingsRepo: {} as never,
      providerConfigRepo: {} as never,
      providerRegistry: [],
      fencingMgr: {} as never,
      supervisorMgr: {} as never,
      autoFetch: {} as never,
      activationMgr: { getLease: () => null } as never,
      runtimeBindings: {
        findWorkspaceIdByTerminalId: vi.fn(),
        findSessionIdByTerminalId: vi.fn(),
        findWorkspaceIdBySessionId: vi.fn(() => "ws-1"),
        getRuntimeIdForWorkspace: vi.fn(() => "native-default"),
      } as never,
      runtimeRouter: {
        executeOnTarget: vi.fn(async (target, op, args) =>
          executeRuntimeCommand(op, args, {
            runtimeId: "native-default",
            workspaceLookup: { get: () => undefined, list: () => [] },
            hostBridge: {} as never,
            eventBus: runtimeCtxRef.eventBus,
            providerConfigRepo: runtimeCtxRef.providerConfigRepo,
            providerRegistry: runtimeCtxRef.providerRegistry,
            settingsRepo: runtimeCtxRef.settingsRepo,
            sessionMgr: runtimeCtxRef.sessionMgr,
            terminalMgr: runtimeCtxRef.terminalMgr,
            taskMgr: {} as never,
            lspMgr: {} as never,
            lspToolMgr: {} as never,
            lspToolInstallMgr: {} as never,
            supervisorMgr: runtimeCtxRef.supervisorMgr,
            sessionAnalysisService,
          } as never)
        ),
      } as never,
      sessionAnalysisService: sessionAnalysisService as never,
    };

    runtimeCtxRef = ctx as CommandContext;
    return runtimeCtxRef;
  }

  it("dispatches session.analysis.get", async () => {
    const ctx = createContext();
    const result = await dispatch(
      {
        kind: "command",
        id: "1",
        op: "session.analysis.get",
        args: { sessionId: "sess-1" },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(ctx.sessionAnalysisService?.get).toHaveBeenCalledWith("sess-1");
  });

  it("dispatches session.analysis.run", async () => {
    const ctx = createContext();
    const result = await dispatch(
      {
        kind: "command",
        id: "2",
        op: "session.analysis.run",
        args: { sessionId: "sess-1", force: true },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(ctx.sessionAnalysisService?.run).toHaveBeenCalledWith({
      sessionId: "sess-1",
      force: true,
    });
  });
});
