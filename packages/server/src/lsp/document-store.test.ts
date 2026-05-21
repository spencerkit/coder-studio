import { describe, expect, it } from "vitest";
import { DocumentStore } from "./document-store.js";

describe("DocumentStore", () => {
  it("tracks open/change/close versions and replayable snapshots", () => {
    const store = new DocumentStore("/repo");

    expect(
      store.open({
        path: "e2e/fixtures/lsp-workspace/shared.ts",
        languageId: "typescript",
        text: "export const sharedValue = 1;\n",
      }).version
    ).toBe(1);

    expect(
      store.change("e2e/fixtures/lsp-workspace/shared.ts", "export const sharedValue = 2;\n")
        .version
    ).toBe(2);

    expect(store.listOpen()).toHaveLength(1);
    expect(store.listReplayable()).toHaveLength(1);

    store.close("e2e/fixtures/lsp-workspace/shared.ts");

    expect(store.listOpen()).toHaveLength(0);
    expect(store.listReplayable()).toHaveLength(0);
  });

  it("maps file URIs back to workspace-relative paths without a leading slash", () => {
    const store = new DocumentStore("/repo");

    expect(store.fromUri("file:///repo/e2e/fixtures/lsp-workspace/shared.ts")).toBe(
      "e2e/fixtures/lsp-workspace/shared.ts"
    );
  });

  it("encodes spaces in file URIs and decodes them back to relative paths", () => {
    const store = new DocumentStore("/repo with spaces");
    const opened = store.open({
      path: "dir/a b.ts",
      languageId: "typescript",
      text: "export const value = 1;\n",
    });

    expect(opened.uri).toBe("file:///repo%20with%20spaces/dir/a%20b.ts");
    expect(store.fromUri(opened.uri)).toBe("dir/a b.ts");
    expect(store.fromUri("untitled:buffer")).toBeNull();
  });

  it("maps Windows file URIs back to workspace-relative paths even when the drive casing differs", () => {
    const store = new DocumentStore("C:\\Repo");

    expect(store.fromUri("file:///c:/Repo/src/main.tsx")).toBe("src/main.tsx");
    expect(store.fromUri("file:///C:/Repo/node_modules/pkg/index.d.ts")).toBe(
      "node_modules/pkg/index.d.ts"
    );
  });
});
