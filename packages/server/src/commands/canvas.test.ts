import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Topics } from "@coder-studio/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasService } from "../canvas/service.js";
import { CanvasAnchorCommentRepo } from "../storage/repositories/canvas-anchor-comment-repo.js";
import { CanvasOverlayRepo } from "../storage/repositories/canvas-overlay-repo.js";
import { CanvasRepo } from "../storage/repositories/canvas-repo.js";
import { CanvasSnapshotRepo } from "../storage/repositories/canvas-snapshot-repo.js";
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
    const canvasAnchorCommentRepo = new CanvasAnchorCommentRepo({
      rootDir: join(tempDir, "state", "canvas-anchor-comments"),
    });
    const canvasOverlayRepo = new CanvasOverlayRepo({
      rootDir: join(tempDir, "state", "canvas-overlays"),
    });
    const canvasSnapshotRepo = new CanvasSnapshotRepo({
      filePath: join(tempDir, "state", "canvases", "snapshots.json"),
    });
    const canvasService = new CanvasService({
      canvasRepo,
      canvasAnchorCommentRepo,
      canvasOverlayRepo,
      canvasSnapshotRepo,
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
    expect(renderResult.data).toMatchObject({
      canvasId: created.record.id,
      workspaceId: "ws-1",
      sourcePath: created.record.sourcePath,
      title: "Recovered Canvas",
      kind: "architecture_canvas",
      renderStatus: "ready",
      lastError: null,
      overlayDocument: {
        version: 1,
        objects: [],
      },
      compiledDocument: expect.objectContaining({
        kind: "architecture_canvas",
        title: "Recovered Canvas",
        summary: "Recovered",
      }),
    });
  });

  it("lists presets and creates a canvas from a preset through the command layer", async () => {
    const presetListResult = await dispatch(
      command("canvas.preset.list", { workspaceId: "ws-1" }),
      ctx
    );
    expect(presetListResult.ok).toBe(true);
    expect(presetListResult.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "token-consumption-trend",
          kind: "report_canvas",
        }),
      ])
    );

    const createFromPresetResult = await dispatch(
      command("canvas.create-from-preset", {
        workspaceId: "ws-1",
        presetId: "token-consumption-trend",
        title: "Token Consumption",
      }),
      ctx
    );

    expect(createFromPresetResult.ok).toBe(true);
    expect(createFromPresetResult.data).toMatchObject({
      record: expect.objectContaining({
        title: "Token Consumption",
        artifactType: "report_canvas",
        sourcePath: ".coder-studio/canvases/token-consumption.csc",
      }),
      renderStatus: "ready",
      lastError: null,
    });
  });

  it("creates snapshots and clones canvases through the command layer", async () => {
    const created = await dispatch(
      command("canvas.create-from-preset", {
        workspaceId: "ws-1",
        presetId: "token-consumption-trend",
        title: "Token Consumption",
      }),
      ctx
    );
    expect(created.ok).toBe(true);

    const createFromPresetData = created.data as Awaited<
      ReturnType<CanvasService["createFromPreset"]>
    >;

    const snapshotResult = await dispatch(
      command("canvas.snapshot.create", {
        workspaceId: "ws-1",
        sourcePath: createFromPresetData.record.sourcePath,
      }),
      ctx
    );

    expect(snapshotResult.ok).toBe(true);
    expect(snapshotResult.data).toMatchObject({
      kind: "report_canvas",
      title: "Token Consumption",
    });

    const cloneFromSourceResult = await dispatch(
      command("canvas.clone", {
        workspaceId: "ws-1",
        sourcePath: createFromPresetData.record.sourcePath,
        title: "Token Consumption Copy",
      }),
      ctx
    );
    expect(cloneFromSourceResult.ok).toBe(true);
    expect(cloneFromSourceResult.data).toMatchObject({
      record: expect.objectContaining({
        sourcePath: ".coder-studio/canvases/token-consumption-copy.csc",
      }),
    });

    const snapshotData = snapshotResult.data as { snapshotId: string };
    const cloneFromSnapshotResult = await dispatch(
      command("canvas.clone", {
        workspaceId: "ws-1",
        snapshotId: snapshotData.snapshotId,
        title: "Recovered Copy",
      }),
      ctx
    );
    expect(cloneFromSnapshotResult.ok).toBe(true);
    expect(cloneFromSnapshotResult.data).toMatchObject({
      record: expect.objectContaining({
        sourcePath: ".coder-studio/canvases/recovered-copy.csc",
      }),
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
    expect(renderResult.data).toMatchObject({
      workspaceId: "ws-1",
      sourcePath,
      title: "Runtime Flow",
      kind: "architecture_canvas",
      renderStatus: "ready",
      lastError: null,
      overlayDocument: {
        version: 1,
        objects: [],
      },
      compiledDocument: {
        kind: "architecture_canvas",
        title: "Runtime Flow",
        summary: "How requests move.",
        sections: expect.any(Array),
      },
    });
    await expect(ctx.canvasService?.list("ws-1")).resolves.toEqual([]);
  });

  it("returns overlay annotations in canvas.render output", async () => {
    const createResult = await dispatch(
      command("canvas.create", {
        workspaceId: "ws-1",
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
      }),
      ctx
    );

    expect(createResult.ok).toBe(true);
    const created = createResult.data as Awaited<ReturnType<CanvasService["create"]>>;

    const overlaySaveResult = await ctx.canvasService?.saveOverlay({
      workspaceId: "ws-1",
      workspaceRootPath: workspaceRoot,
      sourcePath: created.record.sourcePath,
      overlayDocument: {
        version: 1,
        objects: [
          {
            id: "rect-1",
            type: "rect",
            color: "#ff3366",
            strokeWidth: 2,
            x: 20,
            y: 28,
            width: 100,
            height: 72,
          },
        ],
      },
    });

    expect(overlaySaveResult).toMatchObject({
      objects: [expect.objectContaining({ type: "rect" })],
    });

    const renderResult = await dispatch(
      command("canvas.render", {
        workspaceId: "ws-1",
        sourcePath: created.record.sourcePath,
      }),
      ctx
    );

    expect(renderResult.ok).toBe(true);
    expect(renderResult.data).toMatchObject({
      workspaceId: "ws-1",
      sourcePath: created.record.sourcePath,
      overlayDocument: {
        objects: [expect.objectContaining({ type: "rect" })],
      },
      compiledDocument: expect.objectContaining({
        kind: "architecture_canvas",
      }),
    });
  });

  it("returns inspection data with saved anchor comments", async () => {
    const created = await dispatch(
      command("canvas.create-from-preset", {
        workspaceId: "ws-1",
        presetId: "token-consumption-trend",
        title: "Token Consumption",
      }),
      ctx
    );

    expect(created.ok).toBe(true);
    const createFromPresetData = created.data as Awaited<
      ReturnType<CanvasService["createFromPreset"]>
    >;

    const savedComments = await ctx.canvasService?.saveAnchorComments({
      workspaceId: "ws-1",
      workspaceRootPath: workspaceRoot,
      sourcePath: createFromPresetData.record.sourcePath,
      anchorCommentDocument: {
        version: 1,
        comments: [
          {
            id: "comment-1",
            elementIds: ["chart-point:prompt_tokens:10:00"],
            targets: [
              {
                id: "chart-point:prompt_tokens:10:00",
                kind: "chart-point",
                rect: { x: 112, y: 40, width: 28, height: 24 },
                label: "Prompt at 10:00",
                payload: {
                  seriesName: "Prompt",
                  category: "10:00",
                  value: 1800,
                },
              },
            ],
            selectionRect: { x: 112, y: 40, width: 28, height: 24 },
            body: "Explain this peak and switch it to warning color.",
            status: "open",
            createdAt: "2026-06-28T10:00:00.000Z",
            updatedAt: "2026-06-28T10:00:00.000Z",
          },
        ],
      },
    });

    expect(savedComments).toMatchObject({
      comments: [
        expect.objectContaining({
          id: "comment-1",
          targets: [expect.objectContaining({ id: "chart-point:prompt_tokens:10:00" })],
        }),
      ],
    });

    const inspectResult = await dispatch(
      command("canvas.inspect", {
        workspaceId: "ws-1",
        sourcePath: createFromPresetData.record.sourcePath,
      }),
      ctx
    );

    expect(inspectResult.ok).toBe(true);
    expect(inspectResult.data).toMatchObject({
      workspaceId: "ws-1",
      sourcePath: createFromPresetData.record.sourcePath,
      renderStatus: "ready",
      overlayDocument: {
        version: 1,
        objects: [],
      },
      anchorCommentDocument: {
        version: 1,
        comments: [
          expect.objectContaining({
            id: "comment-1",
            targets: [expect.objectContaining({ id: "chart-point:prompt_tokens:10:00" })],
          }),
        ],
      },
      compiledDocument: expect.objectContaining({
        kind: "report_canvas",
      }),
    });
    expect(inspectResult.data).not.toHaveProperty("sceneManifest");
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
