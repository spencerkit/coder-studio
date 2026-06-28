import { beforeEach, describe, expect, it, vi } from "vitest";

const accessMock = vi.fn(async () => undefined);
const createNativeRuntimeMock = vi.fn(async () => ({
  getContext: () => ({
    sessionMgr: { setProviderRegistry: vi.fn() },
    supervisorMgr: { setProviderRegistry: vi.fn() },
  }),
  getResources: () => ({
    providerInstallMgr: { setProviders: vi.fn() },
  }),
  stop: vi.fn(async () => undefined),
}));
const syncWindowsAgentSkillsFromHostMock = vi.fn(async () => undefined);
const startWslHostApiProxyMock = vi.fn(async () => ({
  url: "http://127.0.0.1:4012",
  close: vi.fn(async () => undefined),
}));
const peerRequestMock = vi.fn(async () => ({ kind: "result", id: "relay", ok: true, data: {} }));
const peerNotifyMock = vi.fn(async () => undefined);
const peerDisposeMock = vi.fn(async () => undefined);
const socketServerCloseMock = vi.fn(async () => undefined);
const acceptOnceMock = vi.fn(async () => ({
  request: peerRequestMock,
  notify: peerNotifyMock,
  dispose: peerDisposeMock,
}));
const createSocketJsonRpcServerMock = vi.fn(async () => ({
  port: 41733,
  acceptOnce: acceptOnceMock,
  close: socketServerCloseMock,
}));

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return {
    ...actual,
    access: accessMock,
  };
});

vi.mock("../../runtime/native-runtime.js", () => ({
  createNativeRuntime: createNativeRuntimeMock,
}));

vi.mock("../../runtime/wsl-skill-sync.js", () => ({
  syncWindowsAgentSkillsFromHost: syncWindowsAgentSkillsFromHostMock,
}));

vi.mock("../../runtime/wsl-host-api-proxy.js", () => ({
  startWslHostApiProxy: startWslHostApiProxyMock,
}));

vi.mock("../../runtime/remote/socket-json-rpc.js", () => ({
  createSocketJsonRpcServer: createSocketJsonRpcServerMock,
}));

describe("runWslRuntimeEntrypoint skill sync", () => {
  function mockStdoutWrite() {
    return vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown, cb?: unknown) => {
      if (typeof cb === "function") {
        cb();
      }
      return true;
    }) as typeof process.stdout.write);
  }

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("syncs Windows agent skills before creating the native runtime", async () => {
    process.env.CODER_STUDIO_WSL_RUNTIME_BOOTSTRAP = JSON.stringify({
      runtimeId: "wsl:ws-1",
      workspace: {
        id: "ws-1",
        path: "/home/me/app",
        targetRuntime: "wsl",
        wslDistro: "Ubuntu-24.04",
        uiState: { leftPanelWidth: 250, bottomPanelHeight: 200, focusMode: false },
      },
      stateRoot: "/home/me/.coder-studio/runtimes/wsl_ws-1",
      settings: {},
      workspaces: [],
      customProviders: [],
    });

    const writeSpy = mockStdoutWrite();
    const { runWslRuntimeEntrypoint } = await import("../../runtime/wsl-entry.js");

    const pending = runWslRuntimeEntrypoint();
    await vi.waitFor(() => {
      expect(syncWindowsAgentSkillsFromHostMock).toHaveBeenCalledTimes(1);
      expect(createNativeRuntimeMock).toHaveBeenCalledTimes(1);
    });

    expect(syncWindowsAgentSkillsFromHostMock.mock.invocationCallOrder[0]).toBeLessThan(
      createNativeRuntimeMock.mock.invocationCallOrder[0]
    );
    expect(syncWindowsAgentSkillsFromHostMock).toHaveBeenCalledWith({
      relayHostCommand: expect.any(Function),
    });

    writeSpy.mockRestore();
    pending.catch(() => undefined);
  });

  it("logs and continues startup when skill sync fails", async () => {
    process.env.CODER_STUDIO_WSL_RUNTIME_BOOTSTRAP = JSON.stringify({
      runtimeId: "wsl:ws-1",
      workspace: {
        id: "ws-1",
        path: "/home/me/app",
        targetRuntime: "wsl",
        wslDistro: "Ubuntu-24.04",
        uiState: { leftPanelWidth: 250, bottomPanelHeight: 200, focusMode: false },
      },
      stateRoot: "/home/me/.coder-studio/runtimes/wsl_ws-1",
      settings: {},
      workspaces: [],
      customProviders: [],
    });
    syncWindowsAgentSkillsFromHostMock.mockRejectedValueOnce(new Error("sync failed"));

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const writeSpy = mockStdoutWrite();
    const { runWslRuntimeEntrypoint } = await import("../../runtime/wsl-entry.js");

    const pending = runWslRuntimeEntrypoint();
    await vi.waitFor(() => {
      expect(createNativeRuntimeMock).toHaveBeenCalledTimes(1);
    });

    expect(warnSpy).toHaveBeenCalledWith("[wsl-runtime] agent skill sync failed:", "sync failed");

    warnSpy.mockRestore();
    writeSpy.mockRestore();
    pending.catch(() => undefined);
  });
});
