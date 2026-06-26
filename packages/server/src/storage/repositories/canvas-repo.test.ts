import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CanvasRepo } from "./canvas-repo.js";

describe("CanvasRepo", () => {
  let tempDir: string;
  let repo: CanvasRepo;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "canvas-repo-"));
    repo = new CanvasRepo({ rootDir: join(tempDir, "canvases") });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("lists and gets records ordered by updatedAt descending", () => {
    repo.upsert({
      id: "canvas-1",
      workspaceId: "workspace/one",
      sourcePath: ".coder-studio/canvases/canvas-1.canvas.json",
      artifactType: "architecture_canvas",
      title: "Runtime Flow",
      updatedAt: 100,
      renderStatus: "ready",
      lastError: null,
    });

    repo.upsert({
      id: "canvas-2",
      workspaceId: "workspace/one",
      sourcePath: ".coder-studio/canvases/canvas-2.canvas.json",
      artifactType: "report_canvas",
      title: "Audit",
      updatedAt: 200,
      renderStatus: "error",
      lastError: {
        category: "compile_error",
        message: "compile failed",
      },
    });

    expect(repo.get("workspace/one", "canvas-1")).toMatchObject({
      id: "canvas-1",
      title: "Runtime Flow",
    });
    expect(repo.list("workspace/one").map((record) => record.id)).toEqual(["canvas-2", "canvas-1"]);
  });

  it("upserts and deletes a single record without affecting the workspace file", () => {
    repo.upsert({
      id: "canvas-1",
      workspaceId: "ws-1",
      sourcePath: ".coder-studio/canvases/canvas-1.canvas.json",
      artifactType: "architecture_canvas",
      title: "Original",
      updatedAt: 100,
      renderStatus: "ready",
      lastError: null,
    });
    repo.upsert({
      id: "canvas-1",
      workspaceId: "ws-1",
      sourcePath: ".coder-studio/canvases/canvas-1.canvas.json",
      artifactType: "architecture_canvas",
      title: "Updated",
      updatedAt: 300,
      renderStatus: "ready",
      lastError: null,
    });
    repo.upsert({
      id: "canvas-2",
      workspaceId: "ws-1",
      sourcePath: ".coder-studio/canvases/canvas-2.canvas.json",
      artifactType: "report_canvas",
      title: "Keep",
      updatedAt: 200,
      renderStatus: "ready",
      lastError: null,
    });

    repo.delete("ws-1", "canvas-1");

    expect(repo.get("ws-1", "canvas-1")).toBeUndefined();
    expect(repo.list("ws-1")).toEqual([
      expect.objectContaining({
        id: "canvas-2",
        title: "Keep",
      }),
    ]);
  });

  it("removes the workspace metadata file", () => {
    repo.upsert({
      id: "canvas-1",
      workspaceId: "workspace/with spaces",
      sourcePath: ".coder-studio/canvases/canvas-1.canvas.json",
      artifactType: "architecture_canvas",
      title: "Runtime Flow",
      updatedAt: 100,
      renderStatus: "ready",
      lastError: null,
    });

    const filePath = join(
      tempDir,
      "canvases",
      `${encodeURIComponent("workspace/with spaces")}.json`
    );
    expect(existsSync(filePath)).toBe(true);

    repo.removeWorkspace("workspace/with spaces");

    expect(existsSync(filePath)).toBe(false);
    expect(repo.list("workspace/with spaces")).toEqual([]);
  });
});
