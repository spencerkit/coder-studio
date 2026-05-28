import { describe, expect, it } from "vitest";
import {
  applyDirectoryRefresh,
  applyRootTreeRefresh,
  collectRefreshTargets,
  pruneExpandedDirsToKnownTree,
} from "./file-tree-refresh";

describe("file-tree-refresh", () => {
  it("preserves loaded descendants that still exist after a root refresh", () => {
    const previousTree = new Map([
      [
        ".",
        [
          { path: "src", name: "src", kind: "dir" as const },
          { path: "docs", name: "docs", kind: "dir" as const },
        ],
      ],
      [
        "src",
        [
          { path: "src/index.ts", name: "index.ts", kind: "file" as const },
          { path: "src/nested", name: "nested", kind: "dir" as const },
        ],
      ],
      ["src/nested", [{ path: "src/nested/deep.ts", name: "deep.ts", kind: "file" as const }]],
      ["docs", [{ path: "docs/guide.md", name: "guide.md", kind: "file" as const }]],
    ]);

    const result = applyRootTreeRefresh({
      previousTree,
      previousLoadedDirs: new Set(["src", "src/nested", "docs"]),
      previousExpandedDirs: new Set(["src", "src/nested"]),
      rootChildren: [{ path: "src", name: "src", kind: "dir" as const }],
    });

    expect(result.tree.get(".")).toEqual([{ path: "src", name: "src", kind: "dir" }]);
    expect(result.tree.get("src")).toEqual([
      { path: "src/index.ts", name: "index.ts", kind: "file" },
      { path: "src/nested", name: "nested", kind: "dir" },
    ]);
    expect(result.tree.get("src/nested")).toEqual([
      { path: "src/nested/deep.ts", name: "deep.ts", kind: "file" },
    ]);
    expect(result.tree.has("docs")).toBe(false);
    expect(Array.from(result.loadedDirs)).toEqual(["src", "src/nested"]);
    expect(Array.from(result.prunedExpandedDirs)).toEqual(["src", "src/nested"]);
  });

  it("keeps nested expanded descendants under surviving root directories", () => {
    const result = pruneExpandedDirsToKnownTree(new Set(["src", "src/nested", "docs"]), [
      { path: "src", name: "src", kind: "dir" as const },
    ]);

    expect(Array.from(result)).toEqual(["src", "src/nested"]);
  });

  it("prunes removed descendants after refreshing a directory", () => {
    const previousTree = new Map([
      [".", [{ path: "src", name: "src", kind: "dir" as const }]],
      [
        "src",
        [
          { path: "src/keep", name: "keep", kind: "dir" as const },
          { path: "src/remove", name: "remove", kind: "dir" as const },
        ],
      ],
      ["src/keep", [{ path: "src/keep/index.ts", name: "index.ts", kind: "file" as const }]],
      ["src/remove", [{ path: "src/remove/old.ts", name: "old.ts", kind: "file" as const }]],
    ]);

    const result = applyDirectoryRefresh({
      previousTree,
      previousLoadedDirs: new Set(["src", "src/keep", "src/remove"]),
      previousExpandedDirs: new Set(["src", "src/keep", "src/remove"]),
      dirPath: "src",
      children: [{ path: "src/keep", name: "keep", kind: "dir" as const }],
    });

    expect(result.tree.get("src")).toEqual([{ path: "src/keep", name: "keep", kind: "dir" }]);
    expect(result.tree.get("src/keep")).toEqual([
      { path: "src/keep/index.ts", name: "index.ts", kind: "file" },
    ]);
    expect(result.tree.has("src/remove")).toBe(false);
    expect(Array.from(result.loadedDirs)).toEqual(["src", "src/keep"]);
    expect(Array.from(result.prunedExpandedDirs)).toEqual(["src", "src/keep"]);
  });

  it("sorts refresh targets by depth so parents refresh before descendants", () => {
    expect(collectRefreshTargets(new Set(["src/nested", "src", "docs"]))).toEqual([
      "docs",
      "src",
      "src/nested",
    ]);
  });
});
