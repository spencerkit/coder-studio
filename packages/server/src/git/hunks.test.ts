import { describe, expect, it } from "vitest";
import { buildSingleHunkPatch, parseDiffHunks } from "./hunks.js";

const SAMPLE_DIFF = [
  "diff --git a/src/app.ts b/src/app.ts",
  "index 1111111..2222222 100644",
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -1,5 +1,6 @@",
  ' import { boot } from "./boot";',
  " ",
  '-boot("old");',
  '+boot("new");',
  '+console.log("ready");',
  " export {};",
  "@@ -20,3 +21,4 @@ export function label() {",
  '   return "label";',
  " }",
  "+export const ready = true;",
  "",
].join("\n");

describe("parseDiffHunks", () => {
  it("returns stable hunk descriptors with patch text", () => {
    const hunks = parseDiffHunks({
      diff: SAMPLE_DIFF,
      path: "src/app.ts",
      staged: false,
    });

    expect(hunks).toHaveLength(2);
    expect(hunks[0]).toMatchObject({
      header: "@@ -1,5 +1,6 @@",
      oldStart: 1,
      oldLines: 5,
      newStart: 1,
      newLines: 6,
      lines: [
        ' import { boot } from "./boot";',
        " ",
        '-boot("old");',
        '+boot("new");',
        '+console.log("ready");',
        " export {};",
      ],
    });
    expect(hunks[0]!.id).toMatch(/^hunk_/);
    expect(hunks[0]!.patch).toContain("@@ -1,5 +1,6 @@");
  });

  it("builds a single-hunk patch with the file header", () => {
    const [hunk] = parseDiffHunks({ diff: SAMPLE_DIFF, path: "src/app.ts", staged: false });
    const patch = buildSingleHunkPatch(SAMPLE_DIFF, hunk!.id, {
      path: "src/app.ts",
      staged: false,
    });

    expect(patch).toContain("diff --git a/src/app.ts b/src/app.ts");
    expect(patch).toContain("--- a/src/app.ts");
    expect(patch).toContain("+++ b/src/app.ts");
    expect(patch).toContain("@@ -1,5 +1,6 @@");
    expect(patch).not.toContain("@@ -20,3 +21,4 @@");
  });

  it("returns null when the requested hunk is stale", () => {
    const patch = buildSingleHunkPatch(SAMPLE_DIFF, "hunk_missing", {
      path: "src/app.ts",
      staged: false,
    });

    expect(patch).toBeNull();
  });
});
