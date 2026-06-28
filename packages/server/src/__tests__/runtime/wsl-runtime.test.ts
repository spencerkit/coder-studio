import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { PassThrough } from "node:stream";
import type { CustomProviderConfig, ProviderDefinition, Workspace } from "@coder-studio/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceRuntimeBindingStore } from "../../host/workspace-runtime-binding.js";
import type { RuntimeHandle, RuntimeHostBridge } from "../../runtime/contract.js";
import { WSL_RUNTIME_NODE_LAUNCH_SCRIPT } from "../../runtime/wsl-bootstrap.js";

function mockWslLaunchArgs(distro: string, entryPath = "/tmp/wsl-runtime-entry.mjs"): string[] {
  return [
    "-d",
    distro,
    "--cd",
    "/home/me/app",
    "-e",
    "sh",
    "-c",
    WSL_RUNTIME_NODE_LAUNCH_SCRIPT,
    "sh",
    entryPath,
  ];
}

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
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const child: MockChildProcess = {
    stdout: new PassThrough(),
    stdin: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const next = listeners.get(event) ?? [];
      next.push(handler);
      listeners.set(event, next);
      return child;
    }),
    once: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const wrapped = (...args: unknown[]) => {
        child.removeListener(event, wrapped);
        handler(...args);
      };
      const next = listeners.get(event) ?? [];
      next.push(wrapped);
      listeners.set(event, next);
      return child;
    }),
    removeListener: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const next = (listeners.get(event) ?? []).filter((candidate) => candidate !== handler);
      listeners.set(event, next);
      return child;
    }),
  };
  Object.assign(child, {
    emit(event: string, ...args: unknown[]) {
      for (const listener of listeners.get(event) ?? []) {
        listener(...args);
      }
      return true;
    },
  });
  return child;
}

function emitReady(child: MockChildProcess, port = 41733): void {
  queueMicrotask(() => {
    child.stdout.write(
      `${JSON.stringify({ type: "wslRuntime.ready", host: "127.0.0.1", port })}\n`
    );
  });
}

describe("WslRuntimeHandle", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("node:child_process");
    vi.doUnmock("../../runtime/remote/socket-json-rpc.js");
    vi.doUnmock("../../runtime/wsl-bootstrap.js");
  });

  it("launches a WSL child process and routes runtime operations over socket RPC", async () => {
    const child = createMockChildProcess();
    emitReady(child);
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
    const createSocketJsonRpcClient = vi.fn(async () => rpcClient);
    const resolveWslRuntimeLaunchSpec = vi.fn(async () => ({
      command: "wsl.exe",
      args: mockWslLaunchArgs("Ubuntu-24.04"),
      cwd: "/tmp",
      env: {
        CODER_STUDIO_WSL_RUNTIME_BOOTSTRAP: '{"runtimeId":"wsl:ws-1"}',
        CODER_STUDIO_WSL_NODE_PTY_SOURCE_PACKAGE_JSON:
          "/mnt/c/coder-studio/node_modules/node-pty/package.json",
        CODER_STUDIO_WSL_NODE_ADDON_API_SOURCE_PACKAGE_JSON:
          "/mnt/c/coder-studio/node_modules/node-addon-api/package.json",
        CODER_STUDIO_WSL_NODE_PTY_STAGING_ROOT:
          "~/.coder-studio/runtimes/wsl_ws-1/native-deps/node-pty",
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
    vi.doMock("../../runtime/remote/socket-json-rpc.js", () => ({
      createSocketJsonRpcClient,
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
      mockWslLaunchArgs("Ubuntu-24.04"),
      expect.objectContaining({
        cwd: "/tmp",
        env: expect.objectContaining({
          CODER_STUDIO_WSL_NODE_PTY_SOURCE_PACKAGE_JSON:
            "/mnt/c/coder-studio/node_modules/node-pty/package.json",
          CODER_STUDIO_WSL_NODE_ADDON_API_SOURCE_PACKAGE_JSON:
            "/mnt/c/coder-studio/node_modules/node-addon-api/package.json",
          CODER_STUDIO_WSL_NODE_PTY_STAGING_ROOT:
            "~/.coder-studio/runtimes/wsl_ws-1/native-deps/node-pty",
        }),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      })
    );
    expect(createSocketJsonRpcClient).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "127.0.0.1",
        port: 41733,
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

  it("sanitizes the WSL launch environment so Linux-side node tooling does not resolve to Windows shims", async () => {
    const child = createMockChildProcess();
    emitReady(child);
    const spawn = vi.fn(() => child);
    const rpcClient = {
      request: vi.fn(async (method: string) => (method === "health" ? { ok: true as const } : {})),
      notify: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
    };
    const createSocketJsonRpcClient = vi.fn(async () => rpcClient);
    const resolveWslRuntimeLaunchSpec = vi.fn(async () => ({
      command: "wsl.exe",
      args: mockWslLaunchArgs("Ubuntu-24.04"),
      cwd: "/tmp",
      env: {
        CODER_STUDIO_WSL_RUNTIME_BOOTSTRAP: '{"runtimeId":"wsl:ws-1"}',
        WSLENV: "CODER_STUDIO_WSL_RUNTIME_BOOTSTRAP/u",
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
        settings: {},
        workspaces: [],
        customProviders: [],
      },
    }));

    vi.stubEnv(
      "PATH",
      [
        "/home/w/.local/share/fnm_multishell/bin",
        "/home/w/.local/share/fnm/node-versions/v24.13.0/installation/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/mnt/c/Users/yeshaopeng/AppData/Local/fnm_multishells/12345_1782561599614/bin",
        "/mnt/c/Program Files/nodejs",
      ].join(":")
    );
    vi.stubEnv(
      "FNM_MULTISHELL_PATH",
      "/mnt/c/Users/yeshaopeng/AppData/Local/fnm_multishells/12345"
    );
    vi.stubEnv("npm_config_prefix", "/mnt/c/Users/yeshaopeng/AppData/Roaming/npm");
    vi.stubEnv("NPM_CONFIG_GLOBALCONFIG", "C:\\Users\\yeshaopeng\\.npmrc");
    vi.stubEnv("HTTP_PROXY", "http://127.0.0.1:7890");

    vi.doMock("node:child_process", () => ({
      spawn,
    }));
    vi.doMock("../../runtime/remote/socket-json-rpc.js", () => ({
      createSocketJsonRpcClient,
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

    await createWslRuntime({
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
      hostBridge: {
        issueSessionToken: vi.fn(() => ({ token: "token" })),
        revokeSessionTokensBySessionId: vi.fn(),
        getHostApiUrl: vi.fn(() => "http://127.0.0.1:4173"),
        emitDomainEvent: vi.fn(),
        broadcast: vi.fn(),
        recordWorkspaceFetch: vi.fn(),
        sendToClient: vi.fn(() => true),
        sendBinaryToClient: vi.fn(() => true),
      } satisfies RuntimeHostBridge,
      providerRegistry: [],
      workspaceLookup: {
        get: () => undefined,
        list: () => [],
      },
      settingsSnapshot: {},
      customProviderConfigs: [],
    });

    const spawnEnv = spawn.mock.calls[0]?.[2]?.env as Record<string, string | undefined>;
    expect(spawnEnv.PATH).toBe(
      "/home/w/.local/share/fnm_multishell/bin:/home/w/.local/share/fnm/node-versions/v24.13.0/installation/bin:/usr/local/bin:/usr/bin"
    );
    expect(spawnEnv.FNM_MULTISHELL_PATH).toBeUndefined();
    expect(spawnEnv.npm_config_prefix).toBeUndefined();
    expect(spawnEnv.NPM_CONFIG_GLOBALCONFIG).toBeUndefined();
    expect(spawnEnv.HTTP_PROXY).toBe("http://127.0.0.1:7890");
    expect(spawnEnv.WSLENV).toBe("CODER_STUDIO_WSL_RUNTIME_BOOTSTRAP/u");
  });

  it("hydrates terminal and session bindings immediately from remote create results", async () => {
    const child = createMockChildProcess();
    emitReady(child);
    const spawn = vi.fn(() => child);
    const rpcClient = {
      request: vi.fn(async (method: string, params: unknown) => {
        if (method === "health") {
          return { ok: true as const };
        }

        if (method === "execute" && (params as { op?: string }).op === "terminal.create") {
          return {
            id: "term-wsl-1",
            workspaceId: "ws-1",
            kind: "shell",
            title: "zsh",
            cwd: "/home/me/app",
            argv: ["zsh"],
            cols: 120,
            rows: 30,
            alive: true,
            createdAt: 1,
          };
        }

        if (method === "execute" && (params as { op?: string }).op === "session.create") {
          return {
            id: "sess-wsl-1",
            workspaceId: "ws-1",
            terminalId: "term-agent-1",
            providerId: "codex",
            state: "starting",
            capability: "full",
            startedAt: 2,
            lastActiveAt: 2,
            title: "Fix WSL",
          };
        }

        return {};
      }),
      notify: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
    };
    const createSocketJsonRpcClient = vi.fn(async () => rpcClient);
    const resolveWslRuntimeLaunchSpec = vi.fn(async () => ({
      command: "wsl.exe",
      args: mockWslLaunchArgs("Ubuntu-24.04"),
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
        settings: {},
        workspaces: [],
        customProviders: [],
      },
    }));

    vi.doMock("node:child_process", () => ({
      spawn,
    }));
    vi.doMock("../../runtime/remote/socket-json-rpc.js", () => ({
      createSocketJsonRpcClient,
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

    const bindings = new WorkspaceRuntimeBindingStore();
    bindings.bindWorkspace("ws-1", "wsl:ws-1");

    const { createWslRuntime } = await import("../../runtime/wsl-runtime.js");
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
      hostBridge: {
        issueSessionToken: vi.fn(() => ({ token: "token" })),
        revokeSessionTokensBySessionId: vi.fn(),
        getHostApiUrl: vi.fn(() => "http://127.0.0.1:4173"),
        emitDomainEvent: vi.fn(),
        broadcast: vi.fn(),
        recordWorkspaceFetch: vi.fn(),
        sendToClient: vi.fn(() => true),
        sendBinaryToClient: vi.fn(() => true),
      } satisfies RuntimeHostBridge,
      providerRegistry: [],
      workspaceLookup: {
        get: () => undefined,
        list: () => [],
      },
      settingsSnapshot: {},
      customProviderConfigs: [],
      runtimeBindings: bindings,
    });

    await runtime.execute("terminal.create", {
      workspaceId: "ws-1",
    });
    expect(bindings.findWorkspaceIdByTerminalId("term-wsl-1")).toBe("ws-1");

    await runtime.execute("session.create", {
      workspaceId: "ws-1",
      providerId: "codex",
    });
    expect(bindings.findWorkspaceIdBySessionId("sess-wsl-1")).toBe("ws-1");
    expect(bindings.findWorkspaceIdByTerminalId("term-agent-1")).toBe("ws-1");
    expect(bindings.findSessionIdByTerminalId("term-agent-1")).toBe("sess-wsl-1");
  });

  it("projects remote host bridge notifications and requests back into the host bridge", async () => {
    const child = createMockChildProcess();
    emitReady(child);
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
    const createSocketJsonRpcClient = vi.fn(
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
      args: mockWslLaunchArgs("Ubuntu"),
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
    vi.doMock("../../runtime/remote/socket-json-rpc.js", () => ({
      createSocketJsonRpcClient,
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

    await hostHandlers!.onNotification("domainEvent", {
      event: {
        type: "terminal.output",
        workspaceId: "ws-1",
        terminalId: "term-1",
        chunk: {
          type: "Buffer",
          data: [104, 105],
        },
        seq: 7,
      },
    });
    expect(hostBridge.emitDomainEvent).toHaveBeenCalledWith({
      type: "terminal.output",
      workspaceId: "ws-1",
      terminalId: "term-1",
      chunk: Buffer.from("hi"),
      seq: 7,
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

  it("surfaces runtime bootstrap diagnostics when the WSL service exits before announcing its socket", async () => {
    const child = createMockChildProcess();
    const spawn = vi.fn(() => child);
    const resolveWslRuntimeLaunchSpec = vi.fn(async () => ({
      command: "wsl.exe",
      args: mockWslLaunchArgs("Ubuntu-24.04"),
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
        settings: {},
        workspaces: [],
        customProviders: [],
      },
    }));

    vi.doMock("node:child_process", () => ({
      spawn,
    }));
    vi.doMock("../../runtime/remote/socket-json-rpc.js", () => ({
      createSocketJsonRpcClient: vi.fn(),
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

    const createPromise = createWslRuntime({
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
      hostBridge: {
        issueSessionToken: vi.fn(() => ({ token: "token" })),
        revokeSessionTokensBySessionId: vi.fn(),
        getHostApiUrl: vi.fn(() => "http://127.0.0.1:4173"),
        emitDomainEvent: vi.fn(),
        broadcast: vi.fn(),
        recordWorkspaceFetch: vi.fn(),
        sendToClient: vi.fn(() => true),
        sendBinaryToClient: vi.fn(() => true),
      } satisfies RuntimeHostBridge,
      providerRegistry: [],
      workspaceLookup: {
        get: () => undefined,
        list: () => [],
      },
      settingsSnapshot: {},
      customProviderConfigs: [],
    });

    queueMicrotask(() => {
      child.stderr.write("boom on boot\n");
      (child as MockChildProcess & { emit(event: string, ...args: unknown[]): boolean }).emit(
        "exit",
        17,
        null
      );
    });

    await expect(createPromise).rejects.toThrow(
      "WSL runtime wsl:ws-1 exited before announcing its socket"
    );
    await expect(createPromise).rejects.toThrow("boom on boot");
  });
});
