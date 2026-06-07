import { describe, expect, it, vi } from "vitest";
import { ManagedProcessRegistry } from "../monitoring/managed-process-registry.js";
import { LspManager } from "./manager.js";

const readySummary = {
  workspaceId: "ws-1",
  serverKind: "typescript" as const,
  status: "ready" as const,
  capabilities: {
    definition: true,
    references: true,
    hover: true,
    documentSymbols: true,
    diagnostics: true,
  },
};

const readyToolResolution = {
  kind: "ready" as const,
  serverKind: "typescript" as const,
  displayName: "TypeScript language server",
  source: "bundled" as const,
  command: "node",
  args: ["tsls.js"],
};

describe("LspManager", () => {
  it("returns disabled when runtime mode is off", async () => {
    const createSession = vi.fn();
    const manager = new LspManager({
      requestTimeoutMs: 2000,
      idleTtlMs: 1000,
      restartLimit: 2,
      workspaceMgr: {
        get: () => ({
          id: "ws-1",
          path: process.cwd(),
          targetRuntime: "native",
          openedAt: 1,
          lastActiveAt: 1,
          uiState: { leftPanelWidth: 250, bottomPanelHeight: 200, focusMode: false },
        }),
      },
      eventBus: { emit: vi.fn() },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      lspToolMgr: { resolve: vi.fn(async () => readyToolResolution) } as never,
      createSession,
    });

    await manager.setRuntimeMode("off");

    await expect(
      manager.ensureSession({
        workspaceId: "ws-1",
        path: "e2e/fixtures/lsp-workspace/shared.ts",
      })
    ).resolves.toEqual({
      kind: "disabled",
      mode: "off",
      message: "LSP is disabled by runtime mode",
    });

    expect(createSession).not.toHaveBeenCalled();
    expect(manager.getSessionCount()).toBe(0);
  });

  it("disposes active sessions immediately when switching to off", async () => {
    const stop = vi.fn(async () => {});
    const manager = new LspManager({
      requestTimeoutMs: 2000,
      idleTtlMs: 1000,
      restartLimit: 2,
      workspaceMgr: {
        get: () => ({
          id: "ws-1",
          path: process.cwd(),
          targetRuntime: "native",
          openedAt: 1,
          lastActiveAt: 1,
          uiState: { leftPanelWidth: 250, bottomPanelHeight: 200, focusMode: false },
        }),
      },
      eventBus: { emit: vi.fn() },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      lspToolMgr: { resolve: vi.fn(async () => readyToolResolution) } as never,
      createSession: vi.fn(() => ({
        start: async () => readySummary,
        stop,
        getSummary: () => readySummary,
        openDocument: async () => 1,
        changeDocument: async () => 2,
        closeDocument: async () => {},
        definition: async () => [],
        declaration: async () => [],
        typeDefinition: async () => [],
        references: async () => [],
        hover: async () => null,
        documentSymbols: async () => [],
      })),
    });

    await manager.ensureSession({
      workspaceId: "ws-1",
      path: "e2e/fixtures/lsp-workspace/shared.ts",
    });

    expect(manager.getSessionCount()).toBe(1);

    await manager.setRuntimeMode("off");

    expect(manager.getSessionCount()).toBe(0);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("does not create a session from openDocument while runtime mode is off", async () => {
    const createSession = vi.fn();
    const manager = new LspManager({
      requestTimeoutMs: 2000,
      idleTtlMs: 1000,
      restartLimit: 2,
      workspaceMgr: {
        get: () => ({
          id: "ws-1",
          path: process.cwd(),
          targetRuntime: "native",
          openedAt: 1,
          lastActiveAt: 1,
          uiState: { leftPanelWidth: 250, bottomPanelHeight: 200, focusMode: false },
        }),
      },
      eventBus: { emit: vi.fn() },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      lspToolMgr: { resolve: vi.fn(async () => readyToolResolution) } as never,
      createSession,
    });

    await manager.setRuntimeMode("off");

    await expect(
      manager.openDocument({
        workspaceId: "ws-1",
        path: "e2e/fixtures/lsp-workspace/shared.ts",
        languageId: "typescript",
        text: "export const value = 1;",
      })
    ).resolves.toBeNull();

    expect(createSession).not.toHaveBeenCalled();
    expect(manager.getSessionCount()).toBe(0);
  });

  it("returns disabled and does not keep a session when runtime mode switches off during startup", async () => {
    let resolveStart: ((summary: typeof readySummary) => void) | null = null;
    const startPromise = new Promise<typeof readySummary>((resolve) => {
      resolveStart = resolve;
    });
    const stop = vi.fn(async () => {});
    const createSession = vi.fn(() => ({
      start: vi.fn(() => startPromise),
      stop,
      getSummary: () => readySummary,
      openDocument: async () => 1,
      changeDocument: async () => 2,
      closeDocument: async () => {},
      definition: async () => [],
      declaration: async () => [],
      typeDefinition: async () => [],
      references: async () => [],
      hover: async () => null,
      documentSymbols: async () => [],
    }));
    const manager = new LspManager({
      requestTimeoutMs: 2000,
      idleTtlMs: 1000,
      restartLimit: 2,
      workspaceMgr: {
        get: () => ({
          id: "ws-1",
          path: process.cwd(),
          targetRuntime: "native",
          openedAt: 1,
          lastActiveAt: 1,
          uiState: { leftPanelWidth: 250, bottomPanelHeight: 200, focusMode: false },
        }),
      },
      eventBus: { emit: vi.fn() },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      lspToolMgr: { resolve: vi.fn(async () => readyToolResolution) } as never,
      createSession,
    });

    const readinessPromise = manager.ensureSession({
      workspaceId: "ws-1",
      path: "e2e/fixtures/lsp-workspace/shared.ts",
    });

    await vi.waitFor(() => {
      expect(createSession).toHaveBeenCalledTimes(1);
      expect(manager.getSessionCount()).toBe(1);
    });

    await manager.setRuntimeMode("off");
    resolveStart?.(readySummary);

    await expect(readinessPromise).resolves.toEqual({
      kind: "disabled",
      mode: "off",
      message: "LSP is disabled by runtime mode",
    });

    expect(manager.getSessionCount()).toBe(0);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("reuses one session per workspace and server kind", async () => {
    const stop = vi.fn(async () => {});
    const createSession = vi.fn(() => ({
      start: async () => readySummary,
      stop,
      getSummary: () => readySummary,
      openDocument: async () => 1,
      changeDocument: async () => 2,
      closeDocument: async () => {},
      definition: async () => [],
      references: async () => [],
      hover: async () => null,
      documentSymbols: async () => [],
    }));

    const manager = new LspManager({
      requestTimeoutMs: 2000,
      idleTtlMs: 1000,
      restartLimit: 2,
      workspaceMgr: {
        get: () => ({
          id: "ws-1",
          path: process.cwd(),
          targetRuntime: "native",
          openedAt: 1,
          lastActiveAt: 1,
          uiState: { leftPanelWidth: 250, bottomPanelHeight: 200, focusMode: false },
        }),
      },
      eventBus: { emit: vi.fn() },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      lspToolMgr: { resolve: vi.fn(async () => readyToolResolution) } as never,
      createSession,
    });

    const first = await manager.ensureSession({
      workspaceId: "ws-1",
      path: "e2e/fixtures/lsp-workspace/shared.ts",
    });
    const second = await manager.ensureSession({
      workspaceId: "ws-1",
      path: "e2e/fixtures/lsp-workspace/consumer.ts",
    });

    expect(first).toMatchObject({
      kind: "ready",
      summary: expect.objectContaining({ serverKind: "typescript" }),
    });
    expect(second).toMatchObject({
      kind: "ready",
      summary: expect.objectContaining({ serverKind: "typescript" }),
    });
    expect(manager.getSessionCount()).toBe(1);
    await vi.waitFor(() => {
      expect(createSession).toHaveBeenCalledTimes(1);
    });

    await manager.disposeAll();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("registers the primary LSP pid as a background root and unregisters it on dispose", async () => {
    const registry = new ManagedProcessRegistry({ now: () => 10 });
    let processCallback: ((pid: number | null) => void) | undefined;
    const stop = vi.fn(async () => {
      processCallback?.(null);
    });
    const manager = new LspManager({
      requestTimeoutMs: 2000,
      idleTtlMs: 1000,
      restartLimit: 2,
      workspaceMgr: {
        get: () => ({
          id: "ws-1",
          path: process.cwd(),
          targetRuntime: "native",
          openedAt: 1,
          lastActiveAt: 1,
          uiState: { leftPanelWidth: 250, bottomPanelHeight: 200, focusMode: false },
        }),
      },
      eventBus: { emit: vi.fn() },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      lspToolMgr: { resolve: vi.fn(async () => readyToolResolution) } as never,
      managedProcessRegistry: registry,
      createSession: vi.fn((deps) => {
        processCallback = deps.onPrimaryProcessPidChange;
        return {
          start: async () => {
            processCallback?.(4321);
            return readySummary;
          },
          stop,
          getSummary: () => readySummary,
          openDocument: async () => 1,
          changeDocument: async () => 2,
          closeDocument: async () => {},
          definition: async () => [],
          declaration: async () => [],
          typeDefinition: async () => [],
          references: async () => [],
          hover: async () => null,
          documentSymbols: async () => [],
          semanticTokens: async () => null,
        };
      }),
    });

    await expect(
      manager.ensureSession({
        workspaceId: "ws-1",
        path: "e2e/fixtures/lsp-workspace/shared.ts",
      })
    ).resolves.toMatchObject({
      kind: "ready",
      summary: expect.objectContaining({ serverKind: "typescript" }),
    });

    expect(registry.listRoots()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ownerId: "lsp:ws-1:typescript",
          rootPid: 4321,
          workspaceId: "ws-1",
        }),
      ])
    );

    await manager.disposeAll();

    expect(stop).toHaveBeenCalledTimes(1);
    expect(registry.listRoots().map((root) => root.ownerId)).not.toContain("lsp:ws-1:typescript");
  });

  it("updates the LSP background root when the primary pid changes and ignores the vue companion", async () => {
    const registry = new ManagedProcessRegistry({ now: () => 10 });
    let processCallback: ((pid: number | null) => void) | undefined;
    const vueSummary = {
      workspaceId: "ws-1",
      serverKind: "vue" as const,
      status: "ready" as const,
      capabilities: {
        definition: true,
        references: true,
        hover: true,
        documentSymbols: true,
        diagnostics: true,
      },
    };

    const manager = new LspManager({
      requestTimeoutMs: 2000,
      idleTtlMs: 1000,
      restartLimit: 2,
      workspaceMgr: {
        get: () => ({
          id: "ws-1",
          path: process.cwd(),
          targetRuntime: "native",
          openedAt: 1,
          lastActiveAt: 1,
          uiState: { leftPanelWidth: 250, bottomPanelHeight: 200, focusMode: false },
        }),
      },
      eventBus: { emit: vi.fn() },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      lspToolMgr: {
        resolve: vi.fn(async () => ({
          kind: "ready" as const,
          serverKind: "vue" as const,
          displayName: "Vue language server",
          source: "managed" as const,
          command: "/tools/vue-language-server",
          args: ["--stdio"],
        })),
      } as never,
      managedProcessRegistry: registry,
      createSession: vi.fn((deps) => {
        processCallback = deps.onPrimaryProcessPidChange;
        return {
          start: async () => {
            processCallback?.(2100);
            processCallback?.(2200);
            return vueSummary;
          },
          stop: async () => {},
          getSummary: () => vueSummary,
          openDocument: async () => 1,
          changeDocument: async () => 2,
          closeDocument: async () => {},
          definition: async () => [],
          declaration: async () => [],
          typeDefinition: async () => [],
          references: async () => [],
          hover: async () => null,
          documentSymbols: async () => [],
          semanticTokens: async () => null,
        };
      }),
    });

    await manager.ensureSession({
      workspaceId: "ws-1",
      path: "src/App.vue",
    });

    expect(registry.listRoots()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ownerId: "lsp:ws-1:vue",
          rootPid: 2200,
        }),
      ])
    );
    expect(
      registry.listRoots().filter((root) => root.ownerId.startsWith("lsp:ws-1:"))
    ).toHaveLength(1);
  });

  it("starts a vue session for vue files when the tool manager resolves ready", async () => {
    const vueSummary = {
      workspaceId: "ws-1",
      serverKind: "vue" as const,
      status: "ready" as const,
      capabilities: {
        definition: true,
        references: true,
        hover: true,
        documentSymbols: true,
        diagnostics: true,
      },
    };
    const fakeSession = {
      start: vi.fn(async () => vueSummary),
      stop: vi.fn(async () => {}),
      getSummary: () => vueSummary,
      openDocument: async () => 1,
      changeDocument: async () => 2,
      closeDocument: async () => {},
      definition: async () => [],
      declaration: async () => [],
      typeDefinition: async () => [],
      references: async () => [],
      hover: async () => null,
      documentSymbols: async () => [],
    };

    const manager = new LspManager({
      workspaceMgr: {
        get: () => ({
          id: "ws-1",
          path: process.cwd(),
          targetRuntime: "native",
          openedAt: 1,
          lastActiveAt: 1,
          uiState: { leftPanelWidth: 250, bottomPanelHeight: 200, focusMode: false },
        }),
      },
      eventBus: { emit: vi.fn() },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      requestTimeoutMs: 1000,
      idleTtlMs: 1000,
      restartLimit: 2,
      lspToolMgr: {
        resolve: vi.fn(async () => ({
          kind: "ready" as const,
          serverKind: "vue" as const,
          displayName: "Vue language server",
          source: "managed" as const,
          command: "/tools/vue-language-server",
          args: ["--stdio"],
        })),
      } as never,
      createSession: vi.fn(() => fakeSession),
    });

    await expect(
      manager.ensureSession({
        workspaceId: "ws-1",
        path: "src/App.vue",
      })
    ).resolves.toMatchObject({
      kind: "ready",
      summary: { serverKind: "vue" },
    });
  });

  it("attaches a typescript companion + tsserver bridge to vue sessions when both ends resolve", async () => {
    const vueSummary = {
      workspaceId: "ws-1",
      serverKind: "vue" as const,
      status: "ready" as const,
      capabilities: {
        definition: true,
        references: true,
        hover: true,
        documentSymbols: true,
        diagnostics: true,
      },
    };
    const sessionDeps: Array<unknown> = [];
    const createSession = vi.fn((deps) => {
      sessionDeps.push(deps);
      return {
        start: vi.fn(async () => vueSummary),
        stop: vi.fn(async () => {}),
        getSummary: () => vueSummary,
        openDocument: async () => 1,
        changeDocument: async () => 2,
        closeDocument: async () => {},
        definition: async () => [],
        declaration: async () => [],
        typeDefinition: async () => [],
        references: async () => [],
        hover: async () => null,
        documentSymbols: async () => [],
      };
    });
    const resolve = vi.fn(async (input: { serverKind: "vue" | "typescript" }) =>
      input.serverKind === "vue"
        ? {
            kind: "ready" as const,
            serverKind: "vue" as const,
            displayName: "Vue language server",
            source: "managed" as const,
            command: "/tmp/coder-studio/lsp-tools/vue/3.3.2/node_modules/.bin/vue-language-server",
            args: ["--stdio"],
          }
        : {
            kind: "ready" as const,
            serverKind: "typescript" as const,
            displayName: "TypeScript language server",
            source: "bundled" as const,
            command: "/usr/local/bin/node",
            args: ["/bundled/lib/cli.mjs", "--stdio"],
          }
    );

    const manager = new LspManager({
      workspaceMgr: {
        get: () => ({
          id: "ws-1",
          path: process.cwd(),
          targetRuntime: "native",
          openedAt: 1,
          lastActiveAt: 1,
          uiState: { leftPanelWidth: 250, bottomPanelHeight: 200, focusMode: false },
        }),
      },
      eventBus: { emit: vi.fn() },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      requestTimeoutMs: 1000,
      idleTtlMs: 1000,
      restartLimit: 2,
      lspToolMgr: { resolve } as never,
      createSession,
      vueBridgeMode: "auto",
    });

    await expect(
      manager.ensureSession({ workspaceId: "ws-1", path: "src/App.vue" })
    ).resolves.toMatchObject({ kind: "ready", summary: { serverKind: "vue" } });

    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ serverKind: "vue" }));
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ serverKind: "typescript" }));

    const created = sessionDeps[0] as { spec: { companion?: { initializationOptions?: unknown } } };
    expect(created).toMatchObject({
      spec: {
        serverKind: "vue",
        command: "/tmp/coder-studio/lsp-tools/vue/3.3.2/node_modules/.bin/vue-language-server",
        bridges: { tsserverRequest: true },
        companion: {
          command: "/usr/local/bin/node",
          args: ["/bundled/lib/cli.mjs", "--stdio"],
        },
      },
    });
    // Plugin location comes back in the host's path style; normalize for the
    // assertion so it works on both POSIX and Windows.
    const plugins = (
      created.spec.companion?.initializationOptions as {
        plugins?: Array<{ name: string; location: string; languages: string[] }>;
      }
    )?.plugins;
    expect(plugins).toHaveLength(1);
    expect(plugins?.[0]?.name).toBe("@vue/typescript-plugin");
    expect(plugins?.[0]?.languages).toEqual(["vue"]);
    expect(plugins?.[0]?.location.replace(/\\/g, "/")).toMatch(
      /tmp.coder-studio.lsp-tools.vue.3\.3\.2.node_modules.@vue.language-server$/
    );
  });

  it("omits the vue tsserver bridge when CODER_STUDIO_VUE_TSSERVER_BRIDGE is off", async () => {
    const sessionDeps: Array<unknown> = [];
    const createSession = vi.fn((deps) => {
      sessionDeps.push(deps);
      return {
        start: vi.fn(async () => ({
          workspaceId: "ws-1",
          serverKind: "vue" as const,
          status: "ready" as const,
          capabilities: {
            definition: true,
            references: true,
            hover: true,
            documentSymbols: true,
            diagnostics: true,
          },
        })),
        stop: vi.fn(async () => {}),
        getSummary: () =>
          ({
            workspaceId: "ws-1",
            serverKind: "vue",
            status: "ready",
            capabilities: {
              definition: true,
              references: true,
              hover: true,
              documentSymbols: true,
              diagnostics: true,
            },
          }) as never,
        openDocument: async () => 1,
        changeDocument: async () => 2,
        closeDocument: async () => {},
        definition: async () => [],
        declaration: async () => [],
        typeDefinition: async () => [],
        references: async () => [],
        hover: async () => null,
        documentSymbols: async () => [],
      };
    });
    const resolve = vi.fn(async () => ({
      kind: "ready" as const,
      serverKind: "vue" as const,
      displayName: "Vue language server",
      source: "managed" as const,
      command: "/install/node_modules/.bin/vue-language-server",
      args: ["--stdio"],
    }));

    const manager = new LspManager({
      workspaceMgr: {
        get: () => ({
          id: "ws-1",
          path: process.cwd(),
          targetRuntime: "native",
          openedAt: 1,
          lastActiveAt: 1,
          uiState: { leftPanelWidth: 250, bottomPanelHeight: 200, focusMode: false },
        }),
      },
      eventBus: { emit: vi.fn() },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      requestTimeoutMs: 1000,
      idleTtlMs: 1000,
      restartLimit: 2,
      lspToolMgr: { resolve } as never,
      createSession,
      vueBridgeMode: "off",
    });

    await manager.ensureSession({ workspaceId: "ws-1", path: "src/App.vue" });

    // Only the vue resolve call — no typescript companion resolution either.
    expect(resolve).toHaveBeenCalledTimes(1);

    const [created] = sessionDeps;
    expect(created).toMatchObject({
      spec: {
        serverKind: "vue",
        bridges: undefined,
        companion: undefined,
      },
    });
  });

  it("coalesces concurrent ensureSession calls for the same workspace and server kind", async () => {
    let resolveStart: ((summary: typeof readySummary) => void) | null = null;
    const startPromise = new Promise<typeof readySummary>((resolve) => {
      resolveStart = resolve;
    });

    const session = {
      start: vi.fn(() => startPromise),
      stop: vi.fn(async () => {}),
      getSummary: () => readySummary,
      openDocument: async () => 1,
      changeDocument: async () => 2,
      closeDocument: async () => {},
      definition: async () => [],
      references: async () => [],
      hover: async () => null,
      documentSymbols: async () => [],
    };

    const createSession = vi.fn(() => session);
    const manager = new LspManager({
      requestTimeoutMs: 2000,
      idleTtlMs: 1000,
      restartLimit: 2,
      workspaceMgr: {
        get: () => ({
          id: "ws-1",
          path: process.cwd(),
          targetRuntime: "native",
          openedAt: 1,
          lastActiveAt: 1,
          uiState: { leftPanelWidth: 250, bottomPanelHeight: 200, focusMode: false },
        }),
      },
      eventBus: { emit: vi.fn() },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      lspToolMgr: { resolve: vi.fn(async () => readyToolResolution) } as never,
      createSession,
    });

    const first = manager.ensureSession({
      workspaceId: "ws-1",
      path: "e2e/fixtures/lsp-workspace/shared.ts",
    });
    const second = manager.ensureSession({
      workspaceId: "ws-1",
      path: "e2e/fixtures/lsp-workspace/consumer.ts",
    });

    await vi.waitFor(() => {
      expect(createSession).toHaveBeenCalledTimes(1);
    });

    resolveStart?.(readySummary);

    await expect(Promise.all([first, second])).resolves.toEqual([
      {
        kind: "ready",
        summary: readySummary,
        displayName: "TypeScript language server",
        source: "bundled",
      },
      {
        kind: "ready",
        summary: readySummary,
        displayName: "TypeScript language server",
        source: "bundled",
      },
    ]);
  });

  it("returns unsupported_language for unsupported languages without creating a session", async () => {
    const manager = new LspManager({
      requestTimeoutMs: 2000,
      idleTtlMs: 1000,
      restartLimit: 2,
      workspaceMgr: {
        get: () => ({
          id: "ws-1",
          path: process.cwd(),
          targetRuntime: "native",
          openedAt: 1,
          lastActiveAt: 1,
          uiState: { leftPanelWidth: 250, bottomPanelHeight: 200, focusMode: false },
        }),
      },
      eventBus: { emit: vi.fn() },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      lspToolMgr: { resolve: vi.fn() } as never,
    });

    await expect(
      manager.ensureSession({
        workspaceId: "ws-1",
        path: "README.md",
      })
    ).resolves.toEqual({ kind: "unsupported_language" });

    expect(manager.getSessionCount()).toBe(0);
  });

  it("does not create a session when closing a document for an idle workspace", async () => {
    const createSession = vi.fn();
    const manager = new LspManager({
      requestTimeoutMs: 2000,
      idleTtlMs: 1000,
      restartLimit: 2,
      workspaceMgr: {
        get: () => ({
          id: "ws-1",
          path: process.cwd(),
          targetRuntime: "native",
          openedAt: 1,
          lastActiveAt: 1,
          uiState: { leftPanelWidth: 250, bottomPanelHeight: 200, focusMode: false },
        }),
      },
      eventBus: { emit: vi.fn() },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      lspToolMgr: { resolve: vi.fn(async () => readyToolResolution) } as never,
      createSession,
    });

    await manager.closeDocument({
      workspaceId: "ws-1",
      path: "e2e/fixtures/lsp-workspace/shared.ts",
    });

    expect(createSession).not.toHaveBeenCalled();
    expect(manager.getSessionCount()).toBe(0);
  });

  it("returns tool_missing when the language server runtime is unavailable", async () => {
    const manager = new LspManager({
      requestTimeoutMs: 2000,
      idleTtlMs: 1000,
      restartLimit: 2,
      workspaceMgr: {
        get: () => ({
          id: "ws-1",
          path: process.cwd(),
          targetRuntime: "native",
          openedAt: 1,
          lastActiveAt: 1,
          uiState: { leftPanelWidth: 250, bottomPanelHeight: 200, focusMode: false },
        }),
      },
      eventBus: { emit: vi.fn() },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      lspToolMgr: {
        resolve: vi.fn(async () => ({
          kind: "tool_missing",
          serverKind: "python",
          displayName: "Python language server",
          errorCode: "lsp_tool_missing",
          message: "Python language server is not installed",
          autoInstallSupported: true,
          installReadiness: "ready",
          missingCommands: ["pylsp"],
          missingPrerequisites: [],
        })),
      } as never,
    });

    await expect(
      manager.ensureSession({
        workspaceId: "ws-1",
        path: "src/main.py",
      })
    ).resolves.toMatchObject({
      kind: "tool_missing",
      serverKind: "python",
      errorCode: "lsp_tool_missing",
      autoInstallSupported: true,
    });
  });
});
