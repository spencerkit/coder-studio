import { describe, expect, it } from "vitest";
import type { OpenFile } from "../atoms";
import { orderOpenEditorPaths, resolveOpenEditorsClose } from "./open-editors-close";

function createFile(path: string): OpenFile {
  return {
    kind: "text",
    path,
    content: "",
    savedContent: "",
    baseHash: `hash:${path}`,
    isDirty: false,
  };
}

describe("orderOpenEditorPaths", () => {
  it("sorts open editor paths lexicographically", () => {
    expect(
      orderOpenEditorPaths({
        "src/z.ts": createFile("src/z.ts"),
        "src/A.ts": createFile("src/A.ts"),
        "README.md": createFile("README.md"),
        "src/a.ts": createFile("src/a.ts"),
      })
    ).toEqual(["README.md", "src/A.ts", "src/a.ts", "src/z.ts"]);
  });
});

describe("resolveOpenEditorsClose", () => {
  it("closing a non-active editor keeps the active file", () => {
    expect(
      resolveOpenEditorsClose({
        openFiles: {
          "src/a.ts": createFile("src/a.ts"),
          "src/b.ts": createFile("src/b.ts"),
          "src/c.ts": createFile("src/c.ts"),
        },
        openEditorPaths: ["src/a.ts", "src/b.ts", "src/c.ts"],
        activeFilePath: "src/b.ts",
        targetPath: "src/a.ts",
      })
    ).toEqual({
      orderedPaths: ["src/a.ts", "src/b.ts", "src/c.ts"],
      removedPaths: ["src/a.ts"],
      nextActiveFilePath: "src/b.ts",
      shouldExitEditor: false,
    });
  });

  it("closing the active file selects the previously activated editor without exiting", () => {
    expect(
      resolveOpenEditorsClose({
        openFiles: {
          "src/b.ts": createFile("src/b.ts"),
          "src/c.ts": createFile("src/c.ts"),
          "src/a.ts": createFile("src/a.ts"),
        },
        openEditorPaths: ["src/b.ts", "src/c.ts", "src/a.ts"],
        activationHistoryPaths: ["src/a.ts", "src/c.ts", "src/b.ts"],
        activeFilePath: "src/b.ts",
        targetPath: "src/b.ts",
      })
    ).toEqual({
      orderedPaths: ["src/a.ts", "src/b.ts", "src/c.ts"],
      removedPaths: ["src/b.ts"],
      nextActiveFilePath: "src/c.ts",
      shouldExitEditor: false,
    });
  });

  it("closing the active last item falls back to the previous visible tab without exiting", () => {
    expect(
      resolveOpenEditorsClose({
        openFiles: {
          "src/b.ts": createFile("src/b.ts"),
          "src/c.ts": createFile("src/c.ts"),
          "src/a.ts": createFile("src/a.ts"),
        },
        openEditorPaths: ["src/b.ts", "src/c.ts", "src/a.ts"],
        activeFilePath: "src/c.ts",
        targetPath: "src/c.ts",
      })
    ).toEqual({
      orderedPaths: ["src/a.ts", "src/b.ts", "src/c.ts"],
      removedPaths: ["src/c.ts"],
      nextActiveFilePath: "src/b.ts",
      shouldExitEditor: false,
    });
  });

  it("closing a pending active editor switches to a remaining editor without exiting", () => {
    expect(
      resolveOpenEditorsClose({
        openFiles: {
          "src/a.ts": createFile("src/a.ts"),
        },
        openEditorPaths: ["src/a.ts"],
        activationHistoryPaths: ["src/a.ts", "src/b.ts"],
        activeFilePath: "src/b.ts",
        pendingActiveFilePath: "src/b.ts",
        targetPath: "src/b.ts",
      })
    ).toEqual({
      orderedPaths: ["src/a.ts", "src/b.ts"],
      removedPaths: ["src/b.ts"],
      nextActiveFilePath: "src/a.ts",
      shouldExitEditor: false,
    });
  });

  it("closing the final remaining file clears the active file without exiting the editor view", () => {
    expect(
      resolveOpenEditorsClose({
        openFiles: {
          "src/a.ts": createFile("src/a.ts"),
        },
        openEditorPaths: ["src/a.ts"],
        activeFilePath: "src/a.ts",
        targetPath: "src/a.ts",
      })
    ).toEqual({
      orderedPaths: ["src/a.ts"],
      removedPaths: ["src/a.ts"],
      nextActiveFilePath: null,
      shouldExitEditor: false,
    });
  });

  it("closeAll clears all open files and signals editor exit", () => {
    expect(
      resolveOpenEditorsClose({
        openFiles: {
          "src/a.ts": createFile("src/a.ts"),
          "src/b.ts": createFile("src/b.ts"),
        },
        openEditorPaths: ["src/a.ts", "src/b.ts"],
        activeFilePath: "src/b.ts",
        closeAll: true,
      })
    ).toEqual({
      orderedPaths: ["src/a.ts", "src/b.ts"],
      removedPaths: ["src/a.ts", "src/b.ts"],
      nextActiveFilePath: null,
      shouldExitEditor: true,
    });
  });

  it("ignores cached panel-only files when resolving global editor closes", () => {
    expect(
      resolveOpenEditorsClose({
        openFiles: {
          "src/global.ts": createFile("src/global.ts"),
          "src/panel-only.ts": createFile("src/panel-only.ts"),
        },
        openEditorPaths: ["src/global.ts"],
        activeFilePath: "src/global.ts",
        closeAll: true,
      })
    ).toEqual({
      orderedPaths: ["src/global.ts"],
      removedPaths: ["src/global.ts"],
      nextActiveFilePath: null,
      shouldExitEditor: true,
    });
  });
});
