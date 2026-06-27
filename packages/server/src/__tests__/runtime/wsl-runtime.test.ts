import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { PassThrough } from "node:stream";
import type { CustomProviderConfig, ProviderDefinition, Workspace } from "@coder-studio/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeHandle, RuntimeHostBridge } from "../../runtime/contract.js";

interface MockChildProcess extends Partial<ChildProcessWithoutNullStreams> {
  stdout: PassThrough;
  stdin: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
  removeListener: ReturnType<typeof vi.fn>;
}

function createMockChildProcess(): MockChildProcess {
  const child: MockChildProcess = {
    stdout: new PassThrough(),
    stdin: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
    on: vi.fn((_event: string, _handler: (...args: unknown[]) => void) => child),
    once: vi.fn((_event: string, _handler: (...args: unknown[]) => void) => child),
    removeListener: vi.fn((_event: string, _handler: (...args: unknown[]) => void) => child),
  };
  return child;
}

describe("WslRuntimeHandle", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("node:child_process");
    vi.doUnmock("../../runtime/remote/stdio-json-rpc.js");
    vi.doUnmock("../../runtime/wsl-bootstrap.js");
  });

  it("launches a WSL child process and routes runtime operations over stdio RPC", async () => {
    const child = createMockChildProcess();
    const spawn = vi.fn(() => child);
    const rpcClient = {
      request: vi.fn(async (method: string, params: unknown) => {
        if (method === "execute") {
          return { ok: true, method, params };
        }
        if (method === "health") {
          return { ok: true as const };
        }
        return { method, params };
      }),
      notify: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
    };
    const createStdioJsonRpcClient = vi.fn(async () => rpcClient);
    const resolveWslRuntimeLaunchSpec = vi.fn(async () => ({
      command: "wsl.exe",
      args: ["-d", "Ubuntu-24.04", "--", "node", "/tmp/wsl-runtime-entry.mjs"],
      cwd: "/tmp",
      env: {
        CODER_STUDIO_WSL_RUNTIME_BOOTSTRAP: '{"runtimeId":"wsl:ws-1"}',
      },
      bootstrap: {
        runtimeId: "wsl:ws-1",
        workspace: {
          id: "ws-1",
          path: "/home/me/app",
          targetRuntime: "wsl",
          wslDistro: "Ubuntu-24.04",
        } satisfies Workspace,
        stateRoot: "/home/me/.coder-studio",
        hostApiUrl: "http://172.29.224.1:4173",
        settings: {
          "lsp.mode": "off",
          "terminal.defaultProfileId": "powershell",
        },
        workspaces: [
          {
            id: "ws-1",
            path: "/home/me/app",
            targetRuntime: "wsl" as const,
            wslDistro: "Ubuntu-24.04",
          },
        ],
        customProviders: [
          {
            id: "custom-review",
            displayName: "Custom Review",
            command: "custom-review",
            args: [],
            env: {},
            cwdMode: "workspace_root",
            sessionMode: "interactive",
            capabilities: [{ key: "interactive_session", supported: true, label: "Interactive" }],
            createdAt: 1,
            updatedAt: 1,
          } satisfies CustomProviderConfig,
        ],
      },
    }));

    vi.doMock("node:child_process", () => ({
      spawn,
    }));
    vi.doMock("../../runtime/remote/stdio-json-rpc.js", () => ({
      createStdioJsonRpcClient,
    }));
    vi.doMock("../../runtime/wsl-bootstrap.js", async () => {
      const actual = await vi.importActual<typeof import("../../runtime/wsl-bootstrap.js")>(
        "../../runtime/wsl-bootstrap.js"
      );
      return {
        ...actual,
        resolveWslRuntimeLaunchSpec,
      };
    });

    const { createWslRuntime } = await import("../../runtime/wsl-runtime.js");
    const createSessionBootstrap = vi.fn(async () => ({
      sessionId: "sess_bootstrap",
      sessionToken: "remote-token",
      apiUrl: "http://172.29.224.1:4173",
    }));
    const resolveClientOwnerId = vi.fn(() => "tab-a");
    const revokeRuntimeTokens = vi.fn();
    const hostBridge = {
      issueSessionToken: vi.fn(() => ({ token: "token" })),
      revokeSessionTokensBySessionId: vi.fn(),
      getHostApiUrl: vi.fn(() => "http://127.0.0.1:4173"),
      emitDomainEvent: vi.fn(),
      broadcast: vi.fn(),
      recordWorkspaceFetch: vi.fn(),
      resolveClientOwnerId,
      sendToClient: vi.fn(() => true),
      sendBinaryToClient: vi.fn(() => true),
    } satisfies RuntimeHostBridge;

    const runtime = await createWslRuntime({
      runtimeId: "wsl:ws-1",
      workspace: {
        id: "ws-1",
        path: "/home/me/app",
        targetRuntime: "wsl",
        wslDistro: "Ubuntu-24.04",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: {
          leftPanelWidth: 250,
          bottomPanelHeight: 200,
          focusMode: false,
        },
      },
      stateRoot: "/tmp/state-root",
      hostBridge,
      providerRegistry: [
        {
          id: "codex",
          displayName: "Codex",
          badge: "OpenAI",
          kind: "preset",
          capability: "full",
          capabilities: [],
          install: {
            prerequisites: [],
            manualGuideKeys: [],
            docUrls: { provider: "", prerequisites: {} },
            strategies: {},
          },
          buildCommand: () => ({ argv: ["codex"], env: {}, cwd: "/home/me/app" }),
          configSchema: {
            parse: (value: unknown) => value,
            safeParse: (value: unknown) => ({ success: true, data: value }),
          } as never,
          defaultConfig: {},
          requiredCommands: ["codex"],
        } satisfies ProviderDefinition,
      ],
      workspaceLookup: {
        get: (workspaceId) =>
          workspaceId === "ws-1"
            ? {
                id: "ws-1",
                path: "/home/me/app",
                targetRuntime: "wsl",
                wslDistro: "Ubuntu-24.04",
              }
            : undefined,
        list: () => [
          {
            id: "ws-1",
            path: "/home/me/app",
            targetRuntime: "wsl",
            wslDistro: "Ubuntu-24.04",
          },
        ],
      },
      createSessionBootstrap,
      resolveClientOwnerId,
      revokeRuntimeTokens,
      settingsSnapshot: {
        "lsp.mode": "off",
      },
      customProviderConfigs: [
        {
          id: "custom-review",
          displayName: "Custom Review",
          command: "custom-review",
          args: [],
          env: {},
          cwdMode: "workspace_root",
          sessionMode: "interactive",
          capabilities: [{ key: "interactive_session", supported: true, label: "Interactive" }],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    expect(rpcClient.request).toHaveBeenNthCalledWith(1, "health", {});
    expect(spawn).toHaveBeenCalledWith(
      "wsl.exe",
      ["-d", "Ubuntu-24.04", "--", "node", "/tmp/wsl-runtime-entry.mjs"],
      expect.objectContaining({
        cwd: "/tmp",
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      })
    );
    expect(createStdioJsonRpcClient).toHaveBeenCalledWith(
      expect.objectContaining({
        child,
        runtimeId: "wsl:ws-1",
      })
    );
    expect(runtime.kind).toBe("wsl");
    expect(runtime.summary).toEqual({
      scope: "workspace",
      workspaceId: "ws-1",
      targetRuntime: "wsl",
      wslDistro: "Ubuntu-24.04",
    });
    expect(runtime.syncSnapshot).toBeTypeOf("function");

    await runtime.execute(
      "session.create",
      {
        workspaceId: "ws-1",
        providerId: "codex",
      },
      {
        clientId: "ws-client-1",
      }
    );

    expect(createSessionBootstrap).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      providerId: "codex",
      runtimeId: "wsl:ws-1",
    });
    expect(rpcClient.request).toHaveBeenCalledWith(
      "execute",
      expect.objectContaining({
        op: "session.create",
        args: {
          workspaceId: "ws-1",
          providerId: "codex",
        },
        meta: expect.objectContaining({
          clientId: "ws-client-1",
          clientOwnerId: "tab-a",
          sessionBootstrap: {
            sessionId: "sess_bootstrap",
            sessionToken: "remote-token",
            apiUrl: "http://172.29.224.1:4173",
          },
        }),
      })
    );

    await runtime.execute(
      "systemDeps.install.start",
      { dependencyId: "git", workspaceId: "ws-1" },
      { clientId: "ws-client-2" }
    );
    expect(rpcClient.request).toHaveBeenLastCalledWith(
      "execute",
      expect.objectContaining({
        meta: expect.objectContaining({
          clientId: "ws-client-2",
          clientOwnerId: "tab-a",
        }),
      })
    );

    await runtime.health();
    expect(rpcClient.request).toHaveBeenCalledWith("health", {});

    await runtime.disposeWorkspace("ws-1");
    expect(rpcClient.request).toHaveBeenCalledWith("disposeWorkspace", {
      workspaceId: "ws-1",
    });
    expect(revokeRuntimeTokens).toHaveBeenCalledWith("wsl:ws-1");

    await runtime.setProviderRegistry?.([
      {
        id: "claude",
        displayName: "Claude Code",
        badge: "Anthropic",
        kind: "preset",
        capability: "full",
        capabilities: [],
        install: {
          prerequisites: [],
          manualGuideKeys: [],
          docUrls: { provider: "", prerequisites: {} },
          strategies: {},
        },
        buildCommand: () => ({ argv: ["claude"], env: {}, cwd: "/home/me/app" }),
        configSchema: {
          parse: (value: unknown) => value,
          safeParse: (value: unknown) => ({ success: true, data: value }),
        } as never,
        defaultConfig: {},
        requiredCommands: ["claude"],
      } satisfies ProviderDefinition,
    ]);
    expect(rpcClient.notify).toHaveBeenCalledWith(
      "updateProviders",
      expect.objectContaining({
        providers: expect.arrayContaining([expect.objectContaining({ id: "claude" })]),
      })
    );

    await runtime.syncSnapshot?.({
      settings: {
        "lsp.mode": "auto",
      },
      workspaces: [
        {
          id: "ws-1",
          path: "/home/me/app",
          targetRuntime: "wsl",
          wslDistro: "Ubuntu-24.04",
        },
      ],
      customProviders: [],
    });
    expect(rpcClient.notify).toHaveBeenCalledWith("updateSnapshot", {
      settings: {
        "lsp.mode": "auto",
      },
      workspaces: [
        {
          id: "ws-1",
          path: "/home/me/app",
          targetRuntime: "wsl",
          wslDistro: "Ubuntu-24.04",
        },
      ],
      customProviders: [],
    });

    await runtime.stop?.();
    expect(rpcClient.request).toHaveBeenCalledWith("stop", {});
    expect(rpcClient.dispose).toHaveBeenCalled();
    expect(revokeRuntimeTokens).toHaveBeenCalledWith("wsl:ws-1");
  });

  it("projects remote host bridge notifications and requests back into the host bridge", async () => {
    const child = createMockChildProcess();
    const spawn = vi.fn(() => child);
    let hostHandlers:
      | {
          onNotification(method: string, params: unknown): Promise<void> | void;
          onRequest(method: string, params: unknown): Promise<unknown> | unknown;
        }
      | undefined;
    const rpcClient = {
      request: vi.fn(async () => ({ ok: true })),
      notify: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
    };
    const createStdioJsonRpcClient = vi.fn(
      async (
        input: typeof hostHandlers extends never
          ? never
          : {
              onNotification(method: string, params: unknown): Promise<void> | void;
              onRequest(method: string, params: unknown): Promise<unknown> | unknown;
            }
      ) => {
        hostHandlers = input;
        return rpcClient;
      }
    );
    const resolveWslRuntimeLaunchSpec = vi.fn(async () => ({
      command: "wsl.exe",
      args: ["-d", "Ubuntu", "--", "node", "/tmp/wsl-runtime-entry.mjs"],
      cwd: "/tmp",
      env: {},
      bootstrap: {
        runtimeId: "wsl:ws-1",
        workspace: {
          id: "ws-1",
          path: "/home/me/app",
          targetRuntime: "wsl",
          wslDistro: "Ubuntu",
        } satisfies Workspace,
        stateRoot: "/home/me/.coder-studio",
        settings: {},
        workspaces: [],
        customProviders: [],
      },
    }));

    vi.doMock("node:child_process", () => ({
      spawn,
    }));
    vi.doMock("../../runtime/remote/stdio-json-rpc.js", () => ({
      createStdioJsonRpcClient,
    }));
    vi.doMock("../../runtime/wsl-bootstrap.js", async () => {
      const actual = await vi.importActual<typeof import("../../runtime/wsl-bootstrap.js")>(
        "../../runtime/wsl-bootstrap.js"
      );
      return {
        ...actual,
        resolveWslRuntimeLaunchSpec,
      };
    });

    const hostBridge = {
      issueSessionToken: vi.fn(() => ({ token: "token" })),
      revokeSessionTokensBySessionId: vi.fn(),
      getHostApiUrl: vi.fn(),
      emitDomainEvent: vi.fn(),
      broadcast: vi.fn(),
      recordWorkspaceFetch: vi.fn(),
      sendToClient: vi.fn(() => true),
      sendBinaryToClient: vi.fn(() => false),
    } satisfies RuntimeHostBridge;
    const { createWslRuntime } = await import("../../runtime/wsl-runtime.js");

    const runtime = await createWslRuntime({
      runtimeId: "wsl:ws-1",
      workspace: {
        id: "ws-1",
        path: "/home/me/app",
        targetRuntime: "wsl",
        wslDistro: "Ubuntu",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: {
          leftPanelWidth: 250,
          bottomPanelHeight: 200,
          focusMode: false,
        },
      },
      stateRoot: "/tmp/state-root",
      hostBridge,
      providerRegistry: [],
      workspaceLookup: {
        get: () => undefined,
        list: () => [],
      },
      settingsSnapshot: {},
      customProviderConfigs: [],
    });

    expect(runtime.id).toBe("wsl:ws-1");
    expect(hostHandlers).toBeDefined();

    await hostHandlers!.onNotification("domainEvent", {
      event: { type: "session.lifecycle", sessionId: "sess-1", event: "removed" },
    });
    expect(hostBridge.emitDomainEvent).toHaveBeenCalledWith({
      type: "session.lifecycle",
      sessionId: "sess-1",
      event: "removed",
    });

    await hostHandlers!.onNotification("broadcast", {
      topic: "workspace:dirty:ws-1",
      payload: { reason: "fs_change" },
    });
    expect(hostBridge.broadcast).toHaveBeenCalledWith("workspace:dirty:ws-1", {
      reason: "fs_change",
    });

    await hostHandlers!.onNotification("recordWorkspaceFetch", {
      workspaceId: "ws-1",
    });
    expect(hostBridge.recordWorkspaceFetch).toHaveBeenCalledWith("ws-1");

    await expect(
      hostHandlers!.onRequest("sendToClient", {
        clientId: "client-1",
        payload: { ok: true },
      })
    ).resolves.toBe(true);
    expect(hostBridge.sendToClient).toHaveBeenCalledWith("client-1", { ok: true });

    await expect(
      hostHandlers!.onRequest("sendBinaryToClient", {
        clientId: "client-1",
        payloadBase64: Buffer.from("abc").toString("base64"),
      })
    ).resolves.toBe(false);
    expect(hostBridge.sendBinaryToClient).toHaveBeenCalledWith("client-1", Buffer.from("abc"));

    await expect(
      hostHandlers!.onRequest("revokeSessionTokensBySessionId", {
        sessionId: "sess-1",
      })
    ).resolves.toEqual({ revoked: true });
    expect(hostBridge.revokeSessionTokensBySessionId).toHaveBeenCalledWith("sess-1");
  });
});
