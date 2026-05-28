import { describe, expect, it, vi } from "vitest";
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
