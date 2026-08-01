import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as fileIo from "../fs/file-io.js";
import { CanvasAnchorCommentRepo } from "../storage/repositories/canvas-anchor-comment-repo.js";
import { CanvasOverlayRepo } from "../storage/repositories/canvas-overlay-repo.js";
import { CanvasRepo } from "../storage/repositories/canvas-repo.js";
import { CanvasSnapshotRepo } from "../storage/repositories/canvas-snapshot-repo.js";
import { CanvasService } from "./service.js";

describe("CanvasService", () => {
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("creates a canvas source file, stores metadata, and lists it", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "canvas-service-"));
    const workspaceRoot = join(tempDir, "workspace");
    mkdirSync(workspaceRoot, { recursive: true });
    const repo = new CanvasRepo({ rootDir: join(tempDir, "state", "canvases") });
    const service = new CanvasService({ canvasRepo: repo, now: () => 1000 });

    const result = await service.create({
      workspaceId: "ws-1",
      workspaceRootPath: workspaceRoot,
      title: "Runtime Flow",
      kind: "architecture_canvas",
      document: {
        summary: "How requests move.",
        diagram: {
          dsl: "mermaid",
          source: "flowchart LR\nWebUI[Web UI] --> Server[Runtime Server]",
        },
        annotations: [],
      },
    });

    expect(result.record.title).toBe("Runtime Flow");
    expect(result.record.sourcePath).toBe(".coder-studio/canvases/runtime-flow.csc");
    expect(result.renderStatus).toBe("ready");
    expect(result.lastError).toBeNull();
    expect(readFileSync(join(workspaceRoot, result.record.sourcePath), "utf8")).toContain(
      '"kind": "architecture_canvas"'
    );
    expect(await service.list("ws-1")).toEqual([result.record]);
  });

  it("lists built-in report canvas presets", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "canvas-service-"));
    const repo = new CanvasRepo({ rootDir: join(tempDir, "state", "canvases") });
    const service = new CanvasService({ canvasRepo: repo, now: () => 1000 });

    await expect(service.listPresets()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "token-consumption-trend",
          kind: "report_canvas",
        }),
      ])
    );
  });

  it("creates a report canvas from a preset", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "canvas-service-"));
    const workspaceRoot = join(tempDir, "workspace");
    mkdirSync(workspaceRoot, { recursive: true });
    const repo = new CanvasRepo({ rootDir: join(tempDir, "state", "canvases") });
    const service = new CanvasService({ canvasRepo: repo, now: () => 1000 });

    const result = await service.createFromPreset({
      workspaceId: "ws-1",
      workspaceRootPath: workspaceRoot,
      presetId: "token-consumption-trend",
      title: "Token Consumption",
    });

    expect(result.record.sourcePath).toBe(".coder-studio/canvases/token-consumption.csc");
    expect(result.source.kind).toBe("report_canvas");
  });

  it("creates an immutable snapshot from a canvas source path", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "canvas-service-"));
    const workspaceRoot = join(tempDir, "workspace");
    mkdirSync(workspaceRoot, { recursive: true });
    const repo = new CanvasRepo({ rootDir: join(tempDir, "state", "canvases") });
    const snapshotRepo = new CanvasSnapshotRepo({
      filePath: join(tempDir, "state", "canvases", "snapshots.json"),
    });
    const service = new CanvasService({
      canvasRepo: repo,
      canvasSnapshotRepo: snapshotRepo,
      now: () => 1000,
    });

    const created = await service.createFromPreset({
      workspaceId: "ws-1",
      workspaceRootPath: workspaceRoot,
      presetId: "token-consumption-trend",
      title: "Token Consumption",
    });

    const snapshot = await service.createSnapshot({
      workspaceId: "ws-1",
      workspaceRootPath: workspaceRoot,
      sourcePath: created.record.sourcePath,
    });

    expect(snapshot.snapshotId).toMatch(/^snapshot_/);
    expect(snapshot.kind).toBe("report_canvas");
    expect(snapshot.compiledDocument.kind).toBe("report_canvas");
  });

  it("saves overlay annotations and returns them in canvas data", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "canvas-service-"));
    const workspaceRoot = join(tempDir, "workspace");
    mkdirSync(workspaceRoot, { recursive: true });
    const repo = new CanvasRepo({ rootDir: join(tempDir, "state", "canvases") });
    const overlayRepo = new CanvasOverlayRepo({
      rootDir: join(tempDir, "state", "canvas-overlays"),
    });
    const service = new CanvasService({
      canvasRepo: repo,
      canvasOverlayRepo: overlayRepo,
      now: () => 1000,
    });

    const created = await service.create({
      workspaceId: "ws-1",
      workspaceRootPath: workspaceRoot,
      title: "Runtime Flow",
      kind: "architecture_canvas",
      document: {
        summary: "How requests move.",
        diagram: {
          dsl: "mermaid",
          source: "flowchart LR\nWebUI[Web UI] --> Server[Runtime Server]",
        },
        annotations: [],
      },
    });

    const overlay = await service.saveOverlay({
      workspaceId: "ws-1",
      workspaceRootPath: workspaceRoot,
      sourcePath: created.record.sourcePath,
      overlayDocument: {
        version: 1,
        objects: [
          {
            id: "text-1",
            type: "text",
            color: "#0f172a",
            fontSize: 16,
            x: 48,
            y: 64,
            text: "Call out server ownership",
          },
        ],
      },
    });

    expect(overlay).toMatchObject({
      objects: [expect.objectContaining({ type: "text" })],
    });

    const data = await service.getCanvasData({
      workspaceId: "ws-1",
      workspaceRootPath: workspaceRoot,
      sourcePath: created.record.sourcePath,
    });

    expect(data).toMatchObject({
      sourcePath: created.record.sourcePath,
      overlayDocument: {
        objects: [expect.objectContaining({ text: "Call out server ownership" })],
      },
    });
  });

  it("saves anchor comments for an existing canvas source", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "canvas-service-"));
    const workspaceRoot = join(tempDir, "workspace");
    mkdirSync(workspaceRoot, { recursive: true });
    const repo = new CanvasRepo({ rootDir: join(tempDir, "state", "canvases") });
    const anchorCommentRepo = new CanvasAnchorCommentRepo({
      rootDir: join(tempDir, "state", "canvas-anchor-comments"),
    });
    const service = new CanvasService({
      canvasRepo: repo,
      canvasAnchorCommentRepo: anchorCommentRepo,
      now: () => 1000,
    });

    const created = await service.createFromPreset({
      workspaceId: "ws-1",
      workspaceRootPath: workspaceRoot,
      presetId: "token-consumption-trend",
      title: "Token Consumption",
    });

    const anchorComments = await service.saveAnchorComments({
      workspaceId: "ws-1",
      workspaceRootPath: workspaceRoot,
      sourcePath: created.record.sourcePath,
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

    expect(anchorComments).toMatchObject({
      comments: [
        expect.objectContaining({
          id: "comment-1",
          status: "open",
          targets: [expect.objectContaining({ id: "chart-point:prompt_tokens:10:00" })],
        }),
      ],
    });
  });

  it("returns saved anchor comments in inspection data", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "canvas-service-"));
    const workspaceRoot = join(tempDir, "workspace");
    mkdirSync(workspaceRoot, { recursive: true });
    const repo = new CanvasRepo({ rootDir: join(tempDir, "state", "canvases") });
    const anchorCommentRepo = new CanvasAnchorCommentRepo({
      rootDir: join(tempDir, "state", "canvas-anchor-comments"),
    });
    const service = new CanvasService({
      canvasRepo: repo,
      canvasAnchorCommentRepo: anchorCommentRepo,
      now: () => 1000,
    });

    const created = await service.createFromPreset({
      workspaceId: "ws-1",
      workspaceRootPath: workspaceRoot,
      presetId: "token-consumption-trend",
      title: "Token Consumption",
    });

    await service.saveAnchorComments({
      workspaceId: "ws-1",
      workspaceRootPath: workspaceRoot,
      sourcePath: created.record.sourcePath,
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

    const inspectionData = await service.getCanvasInspectionData({
      workspaceId: "ws-1",
      workspaceRootPath: workspaceRoot,
      sourcePath: created.record.sourcePath,
    });

    expect(inspectionData).toMatchObject({
      sourcePath: created.record.sourcePath,
      anchorCommentDocument: {
        comments: [
          expect.objectContaining({
            id: "comment-1",
            targets: [expect.objectContaining({ id: "chart-point:prompt_tokens:10:00" })],
          }),
        ],
      },
    });
  });

  it("falls back to an empty anchor comment document when no comments are saved", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "canvas-service-"));
    const workspaceRoot = join(tempDir, "workspace");
    mkdirSync(workspaceRoot, { recursive: true });
    const repo = new CanvasRepo({ rootDir: join(tempDir, "state", "canvases") });
    const anchorCommentRepo = new CanvasAnchorCommentRepo({
      rootDir: join(tempDir, "state", "canvas-anchor-comments"),
    });
    const service = new CanvasService({
      canvasRepo: repo,
      canvasAnchorCommentRepo: anchorCommentRepo,
      now: () => 1000,
    });

    const created = await service.createFromPreset({
      workspaceId: "ws-1",
      workspaceRootPath: workspaceRoot,
      presetId: "token-consumption-trend",
      title: "Token Consumption",
    });

    const inspectionData = await service.getCanvasInspectionData({
      workspaceId: "ws-1",
      workspaceRootPath: workspaceRoot,
      sourcePath: created.record.sourcePath,
    });

    expect(inspectionData.anchorCommentDocument).toEqual({
      version: 1,
      comments: [],
    });
  });

  it("creates snapshots from a single consistent source read", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "canvas-service-"));
    const workspaceRoot = join(tempDir, "workspace");
    mkdirSync(workspaceRoot, { recursive: true });
    const repo = new CanvasRepo({ rootDir: join(tempDir, "state", "canvases") });
    const snapshotRepo = new CanvasSnapshotRepo({
      filePath: join(tempDir, "state", "canvases", "snapshots.json"),
    });
    const service = new CanvasService({
      canvasRepo: repo,
      canvasSnapshotRepo: snapshotRepo,
      now: () => 1000,
    });

    const created = await service.createFromPreset({
      workspaceId: "ws-1",
      workspaceRootPath: workspaceRoot,
      presetId: "token-consumption-trend",
      title: "Token Consumption",
    });

    const originalReadFile = fileIo.readFile;
    const firstSourceContent =
      "{\n" +
      '  "version": 1,\n' +
      '  "kind": "report_canvas",\n' +
      '  "title": "Original Snapshot",\n' +
      '  "document": {\n' +
      '    "summary": "First version",\n' +
      '    "stats": [],\n' +
      '    "sections": [\n' +
      "      {\n" +
      '        "title": "Trend",\n' +
      '        "blocks": [\n' +
      "          {\n" +
      '            "type": "chart",\n' +
      '            "kind": "line",\n' +
      '            "title": "Tokens",\n' +
      '            "categories": ["Mon", "Tue"],\n' +
      '            "series": [{ "name": "Claude", "values": [10, 20] }]\n' +
      "          }\n" +
      "        ]\n" +
      "      }\n" +
      "    ]\n" +
      "  }\n" +
      "}\n";
    const secondSourceContent =
      "{\n" +
      '  "version": 1,\n' +
      '  "kind": "report_canvas",\n' +
      '  "title": "Mutated Snapshot",\n' +
      '  "document": {\n' +
      '    "summary": "Second version",\n' +
      '    "stats": [],\n' +
      '    "sections": [\n' +
      "      {\n" +
      '        "title": "Trend",\n' +
      '        "blocks": [\n' +
      "          {\n" +
      '            "type": "chart",\n' +
      '            "kind": "line",\n' +
      '            "title": "Tokens",\n' +
      '            "categories": ["Mon", "Tue"],\n' +
      '            "series": [{ "name": "Claude", "values": [30, 40] }]\n' +
      "          }\n" +
      "        ]\n" +
      "      }\n" +
      "    ]\n" +
      "  }\n" +
      "}\n";

    const readSpy = vi.spyOn(fileIo, "readFile");
    let snapshotReadCount = 0;
    readSpy.mockImplementation(async (workspaceId, rootPath, relPath) => {
      if (relPath !== created.record.sourcePath) {
        return originalReadFile(workspaceId, rootPath, relPath);
      }

      snapshotReadCount += 1;
      if (snapshotReadCount === 1) {
        return {
          kind: "text",
          content: firstSourceContent,
          baseHash: "hash-original",
          encoding: "utf-8",
        };
      }

      return {
        kind: "text",
        content: secondSourceContent,
        baseHash: "hash-mutated",
        encoding: "utf-8",
      };
    });

    const snapshot = await service.createSnapshot({
      workspaceId: "ws-1",
      workspaceRootPath: workspaceRoot,
      sourcePath: created.record.sourcePath,
    });

    expect(snapshot.sourceHash).toBe("hash-original");
    expect(snapshot.compiledDocument.title).toBe("Original Snapshot");
    expect(snapshotRepo.get(snapshot.snapshotId)).toMatchObject({
      sourceHash: "hash-original",
      source: {
        title: "Original Snapshot",
      },
      compiledDocument: {
        title: "Original Snapshot",
      },
    });
    expect(snapshotReadCount).toBe(1);
  });

  it("duplicates an existing canvas into a new editable source file", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "canvas-service-"));
    const workspaceRoot = join(tempDir, "workspace");
    mkdirSync(workspaceRoot, { recursive: true });
    const repo = new CanvasRepo({ rootDir: join(tempDir, "state", "canvases") });
    const service = new CanvasService({ canvasRepo: repo, now: () => 1000 });

    const created = await service.createFromPreset({
      workspaceId: "ws-1",
      workspaceRootPath: workspaceRoot,
      presetId: "token-consumption-trend",
      title: "Token Consumption",
    });

    const clone = await service.cloneCanvas({
      workspaceId: "ws-1",
      workspaceRootPath: workspaceRoot,
      sourcePath: created.record.sourcePath,
      title: "Token Consumption Copy",
    });

    expect(clone.record.sourcePath).toBe(".coder-studio/canvases/token-consumption-copy.csc");
    expect(clone.source.title).toBe("Token Consumption Copy");
  });

  it("duplicates a snapshot into a new editable source file", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "canvas-service-"));
    const workspaceRoot = join(tempDir, "workspace");
    mkdirSync(workspaceRoot, { recursive: true });
    const repo = new CanvasRepo({ rootDir: join(tempDir, "state", "canvases") });
    const snapshotRepo = new CanvasSnapshotRepo({
      filePath: join(tempDir, "state", "canvases", "snapshots.json"),
    });
    const service = new CanvasService({
      canvasRepo: repo,
      canvasSnapshotRepo: snapshotRepo,
      now: () => 1000,
    });

    const created = await service.createFromPreset({
      workspaceId: "ws-1",
      workspaceRootPath: workspaceRoot,
      presetId: "token-consumption-trend",
      title: "Token Consumption",
    });

    const snapshot = await service.createSnapshot({
      workspaceId: "ws-1",
      workspaceRootPath: workspaceRoot,
      sourcePath: created.record.sourcePath,
    });

    const clone = await service.cloneCanvas({
      workspaceId: "ws-1",
      workspaceRootPath: workspaceRoot,
      snapshotId: snapshot.snapshotId,
      title: "Recovered Copy",
    });

    expect(clone.source.title).toBe("Recovered Copy");
    expect(clone.record.sourcePath).toBe(".coder-studio/canvases/recovered-copy.csc");
  });

  it("returns compiled canvas data for a persisted source file", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "canvas-service-"));
    const workspaceRoot = join(tempDir, "workspace");
    mkdirSync(workspaceRoot, { recursive: true });
    const repo = new CanvasRepo({ rootDir: join(tempDir, "state", "canvases") });
    const service = new CanvasService({ canvasRepo: repo, now: () => 1000 });

    const created = await service.create({
      workspaceId: "ws-1",
      workspaceRootPath: workspaceRoot,
      title: "Runtime Flow",
      kind: "architecture_canvas",
      document: {
        summary: "How requests move.",
        diagram: {
          dsl: "mermaid",
          source: "flowchart LR\nWebUI[Web UI] -->|dispatch| Server[Server]",
        },
        annotations: [{ title: "Boundary", body: "Server owns execution." }],
      },
    });

    const result = await service.getCanvasData({
      workspaceId: "ws-1",
      workspaceRootPath: workspaceRoot,
      canvasId: created.record.id,
    });

    expect(result).toMatchObject({
      canvasId: created.record.id,
      workspaceId: "ws-1",
      title: "Runtime Flow",
      kind: "architecture_canvas",
      renderStatus: "ready",
      lastError: null,
      compiledDocument: {
        kind: "architecture_canvas",
        title: "Runtime Flow",
        summary: "How requests move.",
      },
    });
    expect(result.compiledDocument?.sections[0]).toMatchObject({
      type: "diagram",
      direction: "LR",
      nodes: [
        { id: "WebUI", label: "Web UI" },
        { id: "Server", label: "Server" },
      ],
      edges: [{ from: "WebUI", to: "Server", label: "dispatch" }],
    });
  });

  it("prefers sourcePath identity over a mismatched canvasId when rendering", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "canvas-service-"));
    const workspaceRoot = join(tempDir, "workspace");
    mkdirSync(join(workspaceRoot, ".coder-studio", "canvases"), { recursive: true });
    const repo = new CanvasRepo({ rootDir: join(tempDir, "state", "canvases") });
    const service = new CanvasService({ canvasRepo: repo, now: () => 1000 });

    repo.upsert({
      id: "canvas-1",
      workspaceId: "ws-1",
      sourcePath: ".coder-studio/canvases/other-flow.csc",
      artifactType: "report_canvas",
      title: "Other Canvas",
      updatedAt: 999,
      renderStatus: "ready",
      lastError: null,
    });

    writeFileSync(
      join(workspaceRoot, ".coder-studio/canvases/runtime-flow.csc"),
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

    const result = await service.getCanvasData({
      workspaceId: "ws-1",
      workspaceRootPath: workspaceRoot,
      canvasId: "canvas-1",
      sourcePath: ".coder-studio/canvases/runtime-flow.csc",
    });

    expect(result).toMatchObject({
      workspaceId: "ws-1",
      sourcePath: ".coder-studio/canvases/runtime-flow.csc",
      title: "Runtime Flow",
      kind: "architecture_canvas",
      renderStatus: "ready",
      lastError: null,
    });
    expect(result.canvasId).toBeUndefined();
    expect(repo.get("ws-1", "canvas-1")).toMatchObject({
      id: "canvas-1",
      sourcePath: ".coder-studio/canvases/other-flow.csc",
      title: "Other Canvas",
      artifactType: "report_canvas",
    });
  });

  it("creates unique readable source files for concurrent canvases with the same title", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "canvas-service-"));
    const workspaceRoot = join(tempDir, "workspace");
    mkdirSync(workspaceRoot, { recursive: true });
    const repo = new CanvasRepo({ rootDir: join(tempDir, "state", "canvases") });
    const service = new CanvasService({ canvasRepo: repo, now: () => 1000 });

    const [first, second] = await Promise.all([
      service.create({
        workspaceId: "ws-1",
        workspaceRootPath: workspaceRoot,
        title: "Runtime Flow",
        kind: "architecture_canvas",
        document: {
          summary: "First flow.",
          diagram: {
            dsl: "mermaid",
            source: "flowchart LR\nClient[Client] --> Server[Server]",
          },
          annotations: [],
        },
      }),
      service.create({
        workspaceId: "ws-1",
        workspaceRootPath: workspaceRoot,
        title: "Runtime Flow",
        kind: "architecture_canvas",
        document: {
          summary: "Second flow.",
          diagram: {
            dsl: "mermaid",
            source: "flowchart LR\nWorker[Worker] --> Queue[Queue]",
          },
          annotations: [],
        },
      }),
    ]);

    const sourcePaths = [first.record.sourcePath, second.record.sourcePath].sort();
    expect(sourcePaths).toEqual([
      ".coder-studio/canvases/runtime-flow-2.csc",
      ".coder-studio/canvases/runtime-flow.csc",
    ]);
    expect(new Set(sourcePaths).size).toBe(2);

    const sourceContents = [
      readFileSync(join(workspaceRoot, first.record.sourcePath), "utf8"),
      readFileSync(join(workspaceRoot, second.record.sourcePath), "utf8"),
    ].join("\n");
    expect(sourceContents).toContain('"summary": "First flow."');
    expect(sourceContents).toContain('"summary": "Second flow."');
    expect(await service.list("ws-1")).toHaveLength(2);
  });

  it("rejects canvas creation when the canvas directory escapes through a symlink", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "canvas-service-"));
    const workspaceRoot = join(tempDir, "workspace");
    const outsideRoot = join(tempDir, "outside-canvases");
    mkdirSync(join(workspaceRoot, ".coder-studio"), { recursive: true });
    mkdirSync(outsideRoot, { recursive: true });
    symlinkSync(
      outsideRoot,
      join(workspaceRoot, ".coder-studio", "canvases"),
      process.platform === "win32" ? "junction" : "dir"
    );

    const repo = new CanvasRepo({ rootDir: join(tempDir, "state", "canvases") });
    const service = new CanvasService({ canvasRepo: repo, now: () => 1000 });

    await expect(
      service.create({
        workspaceId: "ws-1",
        workspaceRootPath: workspaceRoot,
        title: "Runtime Flow",
        kind: "architecture_canvas",
        document: {
          summary: "How requests move.",
          diagram: {
            dsl: "mermaid",
            source: "flowchart LR\nWebUI[Web UI] --> Server[Runtime Server]",
          },
          annotations: [],
        },
      })
    ).rejects.toMatchObject({
      code: "path_escape",
    });

    expect(existsSync(join(outsideRoot, "runtime-flow.csc"))).toBe(false);
    expect(repo.list("ws-1")).toEqual([]);
  });

  it("returns an error response for invalid source content", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "canvas-service-"));
    const workspaceRoot = join(tempDir, "workspace");
    mkdirSync(join(workspaceRoot, ".coder-studio", "canvases"), { recursive: true });
    const repo = new CanvasRepo({ rootDir: join(tempDir, "state", "canvases") });
    const service = new CanvasService({ canvasRepo: repo, now: () => 1000 });

    repo.upsert({
      id: "canvas-1",
      workspaceId: "ws-1",
      sourcePath: ".coder-studio/canvases/canvas-1.canvas.json",
      artifactType: "architecture_canvas",
      title: "Broken Canvas",
      updatedAt: 999,
      renderStatus: "ready",
      lastError: null,
    });

    writeFileSync(
      join(workspaceRoot, ".coder-studio/canvases/canvas-1.canvas.json"),
      JSON.stringify({
        version: 1,
        kind: "architecture_canvas",
        title: "Broken Canvas",
        document: {
          summary: "Missing diagram payload.",
          annotations: [],
        },
      })
    );

    const result = await service.getCanvasData({
      workspaceId: "ws-1",
      workspaceRootPath: workspaceRoot,
      canvasId: "canvas-1",
    });

    expect(result.canvasId).toBe("canvas-1");
    expect(result.renderStatus).toBe("error");
    expect(result.compiledDocument).toBeUndefined();
    expect(result.lastError).toMatchObject({
      category: "validation_error",
    });
    expect(repo.get("ws-1", "canvas-1")).toMatchObject({
      renderStatus: "error",
    });
  });

  it("returns a compile error response when graph compilation fails", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "canvas-service-"));
    const workspaceRoot = join(tempDir, "workspace");
    mkdirSync(join(workspaceRoot, ".coder-studio", "canvases"), { recursive: true });
    const repo = new CanvasRepo({ rootDir: join(tempDir, "state", "canvases") });
    const service = new CanvasService({ canvasRepo: repo, now: () => 1000 });

    repo.upsert({
      id: "canvas-1",
      workspaceId: "ws-1",
      sourcePath: ".coder-studio/canvases/canvas-1.canvas.json",
      artifactType: "architecture_canvas",
      title: "Broken Canvas",
      updatedAt: 999,
      renderStatus: "rendering",
      lastError: null,
    });

    writeFileSync(
      join(workspaceRoot, ".coder-studio/canvases/canvas-1.canvas.json"),
      JSON.stringify({
        version: 1,
        kind: "architecture_canvas",
        title: "Broken Canvas",
        document: {
          summary: "Broken graph.",
          diagram: {
            dsl: "mermaid",
            source: "flowchart LR\ninvalid syntax here!!!",
          },
          annotations: [],
        },
      })
    );

    const result = await service.getCanvasData({
      workspaceId: "ws-1",
      workspaceRootPath: workspaceRoot,
      canvasId: "canvas-1",
    });

    expect(result.renderStatus).toBe("error");
    expect(result.compiledDocument).toBeUndefined();
    expect(result.lastError).toMatchObject({
      category: "compile_error",
    });
    expect(repo.get("ws-1", "canvas-1")).toMatchObject({
      renderStatus: "error",
    });
  });

  it("updates an existing canvas source file and record", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "canvas-service-"));
    const workspaceRoot = join(tempDir, "workspace");
    mkdirSync(workspaceRoot, { recursive: true });
    const repo = new CanvasRepo({ rootDir: join(tempDir, "state", "canvases") });
    const service = new CanvasService({ canvasRepo: repo, now: () => 1000 });

    const created = await service.create({
      workspaceId: "ws-1",
      workspaceRootPath: workspaceRoot,
      title: "Runtime Flow",
      kind: "architecture_canvas",
      document: {
        summary: "How requests move.",
        diagram: {
          dsl: "mermaid",
          source: "flowchart LR\nWebUI[Web UI] --> Server[Runtime Server]",
        },
        annotations: [],
      },
    });

    const result = await service.update({
      workspaceId: "ws-1",
      workspaceRootPath: workspaceRoot,
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
    });

    expect(result.record).toMatchObject({
      id: created.record.id,
      title: "Recovered Canvas",
      artifactType: "architecture_canvas",
      renderStatus: "ready",
      lastError: null,
    });
    expect(result.renderStatus).toBe("ready");
    expect(readFileSync(join(workspaceRoot, created.record.sourcePath), "utf8")).toContain(
      '"title": "Recovered Canvas"'
    );
  });

  it("allows updating an invalid source file with a valid document", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "canvas-service-"));
    const workspaceRoot = join(tempDir, "workspace");
    mkdirSync(join(workspaceRoot, ".coder-studio", "canvases"), { recursive: true });
    const repo = new CanvasRepo({ rootDir: join(tempDir, "state", "canvases") });
    const service = new CanvasService({ canvasRepo: repo, now: () => 1000 });

    repo.upsert({
      id: "canvas-1",
      workspaceId: "ws-1",
      sourcePath: ".coder-studio/canvases/canvas-1.canvas.json",
      artifactType: "architecture_canvas",
      title: "Broken Canvas",
      updatedAt: 999,
      renderStatus: "error",
      lastError: {
        category: "validation_error",
        message: "Invalid canvas source",
      },
    });

    writeFileSync(
      join(workspaceRoot, ".coder-studio/canvases/canvas-1.canvas.json"),
      JSON.stringify({
        version: 1,
        kind: "architecture_canvas",
        title: "Broken Canvas",
        document: {
          summary: "Missing diagram payload.",
          annotations: [],
        },
      })
    );

    const result = await service.update({
      workspaceId: "ws-1",
      workspaceRootPath: workspaceRoot,
      canvasId: "canvas-1",
      title: "Recovered Canvas",
      document: {
        summary: "Recovered",
        diagram: {
          dsl: "mermaid",
          source: "flowchart LR\nWebUI[Web UI] --> Server[Runtime Server]",
        },
        annotations: [],
      },
    });

    expect(result.record).toMatchObject({
      id: "canvas-1",
      title: "Recovered Canvas",
      renderStatus: "ready",
      lastError: null,
    });
    expect(result.renderStatus).toBe("ready");
    expect(result.lastError).toBeNull();
  });

  it("renders canvas data from a persisted source path", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "canvas-service-"));
    const workspaceRoot = join(tempDir, "workspace");
    mkdirSync(join(workspaceRoot, ".coder-studio", "canvases"), { recursive: true });
    const repo = new CanvasRepo({ rootDir: join(tempDir, "state", "canvases") });
    const service = new CanvasService({ canvasRepo: repo, now: () => 1000 });

    repo.upsert({
      id: "canvas-1",
      workspaceId: "ws-1",
      sourcePath: ".coder-studio/canvases/canvas-1.canvas.json",
      artifactType: "architecture_canvas",
      title: "Runtime Flow",
      updatedAt: 999,
      renderStatus: "rendering",
      lastError: null,
    });

    writeFileSync(
      join(workspaceRoot, ".coder-studio/canvases/canvas-1.canvas.json"),
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

    const result = await service.renderFromSourcePath({
      workspaceId: "ws-1",
      workspaceRootPath: workspaceRoot,
      sourcePath: ".coder-studio/canvases/canvas-1.canvas.json",
    });

    expect(result).toMatchObject({
      canvasId: "canvas-1",
      workspaceId: "ws-1",
      title: "Runtime Flow",
      kind: "architecture_canvas",
      renderStatus: "ready",
      lastError: null,
      compiledDocument: {
        kind: "architecture_canvas",
        title: "Runtime Flow",
      },
    });
  });
});
