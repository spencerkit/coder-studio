import { describe, expect, it, vi } from "vitest";
import type { CommandContext } from "../ws/dispatch.js";
import { dispatch } from "../ws/dispatch.js";

import "../commands/provider.js";

function createContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    workspaceMgr: {} as never,
    sessionMgr: {} as never,
    terminalMgr: {} as never,
    eventBus: {} as never,
    broadcaster: {
      broadcast: vi.fn(),
      sendToClient: () => true,
      sendBinaryToClient: () => true,
    } as never,
    settingsRepo: {} as never,
    providerConfigRepo: {} as never,
    providerRegistry: [],
    fencingMgr: {} as never,
    supervisorMgr: {} as never,
    autoFetch: {} as never,
    activationMgr: {} as never,
    lspMgr: {} as never,
    runtimeBindings: {} as never,
    runtimeRouter: {
      executeOnTarget: vi.fn(),
    } as never,
    ...overrides,
  } as CommandContext;
}

describe("provider commands", () => {
  it("routes workspace-scoped runtime status and install polling through the runtime router", async () => {
    const executeOnTarget = vi
      .fn()
      .mockResolvedValueOnce({
        providers: {},
      })
      .mockResolvedValueOnce({
        jobId: "job-1",
        providerId: "codex",
        status: "running",
        steps: [],
      });
    const context = createContext({
      runtimeRouter: {
        executeOnTarget,
      } as never,
    });

    const status = await dispatch(
      {
        kind: "command",
        id: "provider-status-wsl",
        op: "provider.runtimeStatus",
        args: {
          workspaceId: "ws-wsl",
        },
      },
      context,
      "client-a"
    );

    expect(status.ok).toBe(true);
    expect(executeOnTarget).toHaveBeenNthCalledWith(
      1,
      { kind: "workspace", workspaceId: "ws-wsl" },
      "provider.runtimeStatus",
      { workspaceId: "ws-wsl" },
      { authContext: undefined, clientId: "client-a" }
    );

    const job = await dispatch(
      {
        kind: "command",
        id: "provider-install-get-wsl",
        op: "provider.install.get",
        args: {
          jobId: "job-1",
          runtimeId: "wsl:ws-wsl",
        },
      },
      context,
      "client-a"
    );

    expect(job.ok).toBe(true);
    expect(executeOnTarget).toHaveBeenNthCalledWith(
      2,
      { kind: "runtime", runtimeId: "wsl:ws-wsl" },
      "provider.install.get",
      { jobId: "job-1", runtimeId: "wsl:ws-wsl" },
      { authContext: undefined, clientId: "client-a" }
    );
  });
});
