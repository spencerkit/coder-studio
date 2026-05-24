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

  it("closing the active file exits the editor instead of selecting the next editor", () => {
    expect(
      resolveOpenEditorsClose({
        openFiles: {
          "src/b.ts": createFile("src/b.ts"),
          "src/c.ts": createFile("src/c.ts"),
          "src/a.ts": createFile("src/a.ts"),
        },
        activeFilePath: "src/b.ts",
        targetPath: "src/b.ts",
      })
    ).toEqual({
      orderedPaths: ["src/a.ts", "src/b.ts", "src/c.ts"],
      removedPaths: ["src/b.ts"],
      nextActiveFilePath: null,
      shouldExitEditor: true,
    });
  });

  it("closing the active last item exits the editor", () => {
    expect(
      resolveOpenEditorsClose({
        openFiles: {
          "src/b.ts": createFile("src/b.ts"),
          "src/c.ts": createFile("src/c.ts"),
          "src/a.ts": createFile("src/a.ts"),
        },
        activeFilePath: "src/c.ts",
        targetPath: "src/c.ts",
      })
    ).toEqual({
      orderedPaths: ["src/a.ts", "src/b.ts", "src/c.ts"],
      removedPaths: ["src/c.ts"],
      nextActiveFilePath: null,
      shouldExitEditor: true,
    });
  });

  it("closing a pending active editor exits the editor", () => {
    expect(
      resolveOpenEditorsClose({
        openFiles: {
          "src/a.ts": createFile("src/a.ts"),
        },
        activeFilePath: "src/b.ts",
        pendingActiveFilePath: "src/b.ts",
        targetPath: "src/b.ts",
      })
    ).toEqual({
      orderedPaths: ["src/a.ts", "src/b.ts"],
      removedPaths: ["src/b.ts"],
      nextActiveFilePath: null,
      shouldExitEditor: true,
    });
  });

  it("closing the final remaining file signals editor exit", () => {
    expect(
      resolveOpenEditorsClose({
        openFiles: {
          "src/a.ts": createFile("src/a.ts"),
        },
        activeFilePath: "src/a.ts",
        targetPath: "src/a.ts",
      })
    ).toEqual({
      orderedPaths: ["src/a.ts"],
      removedPaths: ["src/a.ts"],
      nextActiveFilePath: null,
      shouldExitEditor: true,
    });
  });

  it("closeAll clears all open files and signals editor exit", () => {
    expect(
      resolveOpenEditorsClose({
        openFiles: {
          "src/a.ts": createFile("src/a.ts"),
          "src/b.ts": createFile("src/b.ts"),
        },
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
});
