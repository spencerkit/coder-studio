import crypto from "node:crypto";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../bus/event-bus.js";
import { openDatabase, runMigrations } from "../storage/db.js";
import { WorkspaceRepo } from "../storage/repositories/workspace-repo.js";
import { WorkspaceManager } from "../workspace/manager.js";
import type { CommandContext } from "../ws/dispatch.js";
import { dispatch } from "../ws/dispatch.js";

import "../commands/workspace.js";
import "../commands/lsp.js";

class FakeLspManager {
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
}

class FakeLspToolInstallManager {
  async start() {
    return {
      jobId: "job-1",
      serverKind: "python" as const,
      status: "queued" as const,
      currentStepId: "install-python-lsp",
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

  beforeEach(() => {
    const db = openDatabase(":memory:");
    runMigrations(db);
    const eventBus = new EventBus();
    const workspaceMgr = new WorkspaceManager({
      workspaceRepo: new WorkspaceRepo(db),
      eventBus,
    });

    ctx = {
      workspaceMgr,
      eventBus,
      sessionMgr: {} as never,
      terminalMgr: {} as never,
      broadcaster: { broadcast: vi.fn(), sendToClient: vi.fn(), sendBinaryToClient: vi.fn() },
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

    const get = await dispatch(
      {
        kind: "command",
        id: crypto.randomUUID(),
        op: "lsp.install.get",
        args: { jobId: "job-1" },
      },
      ctx
    );

    expect(get.ok).toBe(true);
    expect(get.data).toMatchObject({
      jobId: "job-1",
      status: "running",
    });
  });
});
