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
import { afterEach, describe, expect, it } from "vitest";
import { CanvasRepo } from "../storage/repositories/canvas-repo.js";
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
