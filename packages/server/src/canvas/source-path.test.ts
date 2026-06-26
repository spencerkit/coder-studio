import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCanvasSourcePath, slugifyCanvasTitle } from "./source-path.js";

describe("canvas source paths", () => {
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("slugifies meaningful canvas titles into readable file names", () => {
    expect(slugifyCanvasTitle("Runtime Request Flow")).toBe("runtime-request-flow");
    expect(slugifyCanvasTitle(" Workspace Audit Summary ")).toBe("workspace-audit-summary");
  });

  it("avoids Windows-reserved file names", () => {
    expect(slugifyCanvasTitle("CON")).toBe("con-canvas");
    expect(slugifyCanvasTitle("LPT1")).toBe("lpt1-canvas");
  });

  it("truncates slugs to 80 characters and trims trailing hyphens after truncation", () => {
    expect(slugifyCanvasTitle("a".repeat(81))).toBe("a".repeat(80));
    expect(slugifyCanvasTitle(`${"a".repeat(79)} !!!`)).toBe("a".repeat(79));
  });

  it("allocates .csc file names and appends numeric suffixes on collision", () => {
    tempDir = mkdtempSync(join(tmpdir(), "canvas-source-path-"));
    mkdirSync(join(tempDir, ".coder-studio", "canvases"), { recursive: true });
    writeFileSync(join(tempDir, ".coder-studio", "canvases", "runtime-request-flow.csc"), "{}\n");

    expect(
      createCanvasSourcePath({
        workspaceRootPath: tempDir,
        title: "Runtime Request Flow",
      })
    ).toBe(".coder-studio/canvases/runtime-request-flow-2.csc");
  });

  it("throws when the title does not produce a valid slug", () => {
    tempDir = mkdtempSync(join(tmpdir(), "canvas-source-path-"));

    expect(() =>
      createCanvasSourcePath({
        workspaceRootPath: tempDir,
        title: "!!!",
      })
    ).toThrowErrorMatchingInlineSnapshot(`
      {
        "code": "invalid_canvas_title",
        "message": "Canvas title must produce a valid file name",
      }
    `);
  });
});
