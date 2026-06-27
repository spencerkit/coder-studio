import crypto from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../bus/event-bus.js";
import { RuntimeRegistry } from "../host/runtime-registry.js";
import { SettingsRepo } from "../storage/repositories/settings-repo.js";
import { WorkspaceRepo } from "../storage/repositories/workspace-repo.js";
import { WorkspaceManager } from "../workspace/manager.js";
import type { CommandContext } from "../ws/dispatch.js";
import { dispatch } from "../ws/dispatch.js";

import "../commands/workspace.js";
import "../commands/lsp.js";

class FakeLspManager {
  mode: "auto" | "off" = "auto";

  async setRuntimeMode(mode: "auto" | "off") {
    this.mode = mode;
  }

  getRuntimeMode() {
    return this.mode;
  }

  async ensureSession() {
    return {
      kind: "ready" as const,
      displayName: "TypeScript language server",
      source: "bundled" as const,
      summary: {
        workspaceId: "ws-1",
        serverKind: "typescript" as const,
        status: "ready" as const,
        capabilities: {
          definition: true,
          references: true,
          hover: true,
          documentSymbols: true,
          semanticTokens: true,
          diagnostics: true,
        },
      },
    };
  }

  async openDocument() {
    return 1;
  }

  async changeDocument() {
    return 2;
  }

  async closeDocument() {}

  async definition() {
    return [
      {
        path: "e2e/fixtures/lsp-workspace/shared.ts",
        range: {
          startLine: 1,
          startColumn: 14,
          endLine: 1,
          endColumn: 25,
        },
      },
    ];
  }

  async references() {
    return [];
  }

  async hover() {
    return null;
  }

  async documentSymbols() {
    return [];
  }

  async semanticTokens() {
    return {
      resultId: "semantic-1",
      data: [0, 13, 11, 8, 1],
    };
  }
}

class FakeLspToolInstallManager {
  async start(input: { serverKind: "typescript" | "python" | "go" | "rust" | "vue" }) {
    return {
      jobId: "job-1",
      serverKind: input.serverKind,
      status: "queued" as const,
      currentStepId: `install-${input.serverKind}-lsp`,
      steps: [],
    };
  }

  get() {
    return {
      jobId: "job-1",
      serverKind: "python" as const,
      status: "running" as const,
      currentStepId: "install-python-lsp",
      steps: [],
    };
  }
}

describe("LSP commands", () => {
  let ctx: CommandContext;
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), "lsp-command-state-"));
    const eventBus = new EventBus();
    const settingsRepo = new SettingsRepo({
      filePath: join(stateDir, "settings.json"),
    });
    const workspaceMgr = new WorkspaceManager({
      workspaceRepo: new WorkspaceRepo({
        filePath: join(stateDir, "workspaces.json"),
      }),
      eventBus,
    });

    ctx = {
      workspaceMgr,
      eventBus,
      sessionMgr: {} as never,
      terminalMgr: {} as never,
      broadcaster: { broadcast: vi.fn(), sendToClient: vi.fn(), sendBinaryToClient: vi.fn() },
      settingsRepo,
      providerRegistry: [],
      autoFetch: {} as never,
      fencingMgr: {} as never,
      supervisorMgr: {} as never,
      activationMgr: { getLease: () => ({ wsClientId: "test-client" }) } as never,
      lspMgr: new FakeLspManager() as never,
      lspToolMgr: {
        runtimeStatus: vi.fn(async () => ({
          serverKind: "python",
          displayName: "Python language server",
          available: false,
          autoInstallSupported: true,
          installReadiness: "ready",
          missingCommands: ["pylsp"],
          missingPrerequisites: [],
        })),
      } as never,
      lspToolInstallMgr: new FakeLspToolInstallManager() as never,
    } as unknown as CommandContext;
  });

  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
  });

  it("ensures a session and forwards read-only requests through the manager", async () => {
    const dir = join(tmpdir(), `lsp-command-test-${Date.now()}`);
    await mkdir(dir);

    const openWorkspace = await dispatch(
      {
        kind: "command",
        id: crypto.randomUUID(),
        op: "workspace.open",
        args: { path: dir },
      },
      ctx
    );

    const workspaceId = (openWorkspace.data as { id: string }).id;

    const ensure = await dispatch(
      {
        kind: "command",
        id: crypto.randomUUID(),
        op: "lsp.ensureSession",
        args: {
          workspaceId,
          path: "e2e/fixtures/lsp-workspace/shared.ts",
        },
      },
      ctx
    );

    expect(ensure.ok).toBe(true);
    expect(ensure.data).toMatchObject({
      kind: "ready",
      summary: {
        serverKind: "typescript",
      },
    });

    const definition = await dispatch(
      {
        kind: "command",
        id: crypto.randomUUID(),
        op: "lsp.definition",
        args: {
          workspaceId,
          path: "e2e/fixtures/lsp-workspace/consumer.ts",
          line: 1,
          column: 12,
        },
      },
      ctx
    );

    expect(definition.ok).toBe(true);
    expect(definition.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "e2e/fixtures/lsp-workspace/shared.ts" }),
      ])
    );

    const semanticTokens = await dispatch(
      {
        kind: "command",
        id: crypto.randomUUID(),
        op: "lsp.semanticTokens",
        args: {
          workspaceId,
          path: "e2e/fixtures/lsp-workspace/shared.ts",
        },
      },
      ctx
    );

    expect(semanticTokens.ok).toBe(true);
    expect(semanticTokens.data).toEqual(
      expect.objectContaining({
        resultId: "semantic-1",
        data: [0, 13, 11, 8, 1],
      })
    );
  });

  it("exposes lsp runtime status and install commands", async () => {
    const dir = join(tmpdir(), `lsp-command-test-${Date.now()}`);
    await mkdir(dir);

    const openWorkspace = await dispatch(
      {
        kind: "command",
        id: crypto.randomUUID(),
        op: "workspace.open",
        args: { path: dir },
      },
      ctx
    );
    const workspaceId = (openWorkspace.data as { id: string }).id;

    const runtimeStatus = await dispatch(
      {
        kind: "command",
        id: crypto.randomUUID(),
        op: "lsp.runtimeStatus",
        args: { workspaceId },
      },
      ctx
    );

    expect(runtimeStatus.ok).toBe(true);
    expect(runtimeStatus.data).toMatchObject({
      tools: {
        python: {
          available: false,
          autoInstallSupported: true,
        },
      },
    });

    const start = await dispatch(
      {
        kind: "command",
        id: crypto.randomUUID(),
        op: "lsp.install.start",
        args: { workspaceId, serverKind: "python" },
      },
      ctx
    );

    expect(start.ok).toBe(true);
    expect(start.data).toMatchObject({
      jobId: "job-1",
      serverKind: "python",
    });

    const startVue = await dispatch(
      {
        kind: "command",
        id: crypto.randomUUID(),
        op: "lsp.install.start",
        args: { workspaceId, serverKind: "vue" },
      },
      ctx
    );

    expect(startVue.ok).toBe(true);
    expect(startVue.data).toMatchObject({
      jobId: "job-1",
      serverKind: "vue",
      status: "queued",
      currentStepId: "install-vue-lsp",
    });

    const get = await dispatch(
      {
        kind: "command",
        id: crypto.randomUUID(),
        op: "lsp.install.get",
        args: { jobId: "job-1", workspaceId },
      },
      ctx
    );

    expect(get.ok).toBe(true);
    expect(get.data).toMatchObject({
      jobId: "job-1",
      status: "running",
    });
  });

  it("applies lsp runtime mode through lsp.setMode", async () => {
    const runtimeRegistry = new RuntimeRegistry();
    const executeNative = vi.fn(async () => ({ mode: "off" }));
    const executeWsl = vi.fn(async () => ({ mode: "off" }));
    runtimeRegistry.register({
      id: "native-default",
      kind: "native",
      summary: { scope: "shared", targetRuntime: "native" },
      execute: executeNative,
      disposeWorkspace: vi.fn(),
      health: async () => ({ ok: true }),
    });
    runtimeRegistry.register({
      id: "wsl:ws-1",
      kind: "wsl",
      summary: {
        scope: "workspace",
        workspaceId: "ws-1",
        targetRuntime: "wsl",
        wslDistro: "Ubuntu-24.04",
      },
      execute: executeWsl,
      disposeWorkspace: vi.fn(),
      health: async () => ({ ok: true }),
    });
    ctx = {
      ...ctx,
      runtimeRegistry,
    } as CommandContext;

    const result = await dispatch(
      {
        kind: "command",
        id: crypto.randomUUID(),
        op: "lsp.setMode",
        args: { mode: "off" },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ mode: "off" });
    expect(executeNative).toHaveBeenCalledWith("lsp.applyMode", { mode: "off" });
    expect(executeWsl).toHaveBeenCalledWith("lsp.applyMode", { mode: "off" });
  });
});
