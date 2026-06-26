import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Topics } from "@coder-studio/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasService } from "../canvas/service.js";
import { CanvasRepo } from "../storage/repositories/canvas-repo.js";
import type { CommandContext } from "../ws/dispatch.js";
import { dispatch } from "../ws/dispatch.js";
import "./index.js";

function command(op: string, args: unknown) {
  return {
    kind: "command" as const,
    id: `${op}-test`,
    op,
    args,
  };
}

describe("canvas commands", () => {
  let tempDir: string;
  let workspaceRoot: string;
  let broadcast: ReturnType<typeof vi.fn>;
  let ctx: CommandContext;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "canvas-command-"));
    workspaceRoot = join(tempDir, "workspace");
    mkdirSync(workspaceRoot, { recursive: true });
    broadcast = vi.fn();

    const canvasRepo = new CanvasRepo({
      rootDir: join(tempDir, "state", "canvases"),
    });
    const canvasService = new CanvasService({
      canvasRepo,
      now: () => 1000,
    });

    ctx = {
      workspaceMgr: {
        get: vi.fn((workspaceId: string) =>
          workspaceId === "ws-1" ? { id: "ws-1", path: workspaceRoot } : undefined
        ),
      },
      sessionMgr: {} as never,
      terminalMgr: {} as never,
      taskMgr: {} as never,
      eventBus: {} as never,
      broadcaster: { broadcast } as never,
      settingsRepo: {} as never,
      providerConfigRepo: {} as never,
      providerRegistry: [],
      fencingMgr: {} as never,
      supervisorMgr: {} as never,
      autoFetch: {} as never,
      activationMgr: {} as never,
      lspMgr: {} as never,
      canvasService,
    };
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates, lists, updates, and renders canvases through the command layer", async () => {
    const createResult = await dispatch(
      command("canvas.create", {
        workspaceId: "ws-1",
        kind: "architecture_canvas",
        title: "Runtime Flow",
        openInEditor: true,
        document: {
          summary: "How requests move.",
          diagram: {
            dsl: "mermaid",
            source: "flowchart LR\nWebUI[Web UI] --> Server[Runtime Server]",
          },
          annotations: [],
        },
      }),
      ctx
    );

    expect(createResult.ok).toBe(true);
    const created = createResult.data as Awaited<ReturnType<CanvasService["create"]>>;
    expect(created.record.title).toBe("Runtime Flow");
    expect(created.renderStatus).toBe("ready");
    expect(broadcast).toHaveBeenCalledWith(
      Topics.workspaceUiAction("ws-1"),
      expect.objectContaining({
        workspaceId: "ws-1",
        intent: expect.objectContaining({
          type: "canvas.open",
          workspaceId: "ws-1",
          canvasId: created.record.id,
          title: "Runtime Flow",
          artifactType: "architecture_canvas",
          sourcePath: created.record.sourcePath,
        }),
      })
    );

    const listResult = await dispatch(command("canvas.list", { workspaceId: "ws-1" }), ctx);
    expect(listResult.ok).toBe(true);
    expect(listResult.data).toEqual([created.record]);

    const updateResult = await dispatch(
      command("canvas.update", {
        workspaceId: "ws-1",
        canvasId: created.record.id,
        title: "Recovered Canvas",
        document: {
          summary: "Recovered",
          diagram: {
            dsl: "mermaid",
            source: "flowchart LR\nWebUI[Web UI] --> Server[Server]",
          },
          annotations: [],
        },
      }),
      ctx
    );

    expect(updateResult.ok).toBe(true);
    expect(updateResult.data).toMatchObject({
      record: expect.objectContaining({
        id: created.record.id,
        title: "Recovered Canvas",
        renderStatus: "ready",
      }),
      renderStatus: "ready",
      lastError: null,
    });

    const renderResult = await dispatch(
      command("canvas.render", {
        workspaceId: "ws-1",
        canvasId: created.record.id,
      }),
      ctx
    );

    expect(renderResult.ok).toBe(true);
    expect(renderResult.data).toEqual({
      canvasId: created.record.id,
      sourcePath: created.record.sourcePath,
      renderStatus: "ready",
      lastError: null,
    });
  });

  it("renders a canvas directly from sourcePath without requiring a repo record", async () => {
    mkdirSync(join(workspaceRoot, ".coder-studio", "canvases"), { recursive: true });
    const sourcePath = ".coder-studio/canvases/runtime-flow.csc";
    writeFileSync(
      join(workspaceRoot, sourcePath),
      JSON.stringify(
        {
          version: 1,
          kind: "architecture_canvas",
          title: "Runtime Flow",
          document: {
            summary: "How requests move.",
            diagram: {
              dsl: "mermaid",
              source: "flowchart LR\nWebUI[Web UI] --> Server[Runtime Server]",
            },
            annotations: [],
          },
        },
        null,
        2
      ) + "\n"
    );

    const renderResult = await dispatch(
      command("canvas.render", {
        workspaceId: "ws-1",
        sourcePath,
      }),
      ctx
    );

    expect(renderResult.ok).toBe(true);
    expect(renderResult.data).toEqual({
      sourcePath,
      renderStatus: "ready",
      lastError: null,
    });
    await expect(ctx.canvasService?.list("ws-1")).resolves.toEqual([]);
  });

  it("returns canvas_not_found when a sourcePath does not exist", async () => {
    const renderResult = await dispatch(
      command("canvas.render", {
        workspaceId: "ws-1",
        sourcePath: ".coder-studio/canvases/missing-flow.csc",
      }),
      ctx
    );

    expect(renderResult.ok).toBe(false);
    expect(renderResult.error).toMatchObject({
      code: "canvas_not_found",
    });
  });
});
