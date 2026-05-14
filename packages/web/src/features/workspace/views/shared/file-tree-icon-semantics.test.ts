import { describe, expect, it } from "vitest";
import { getFileNodeSemantic } from "./file-tree-icon-semantics";

describe("getFileNodeSemantic", () => {
  it("maps folder states", () => {
    expect(getFileNodeSemantic({ name: "src", path: "src", kind: "dir" }, false)).toBe(
      "file.folder.closed"
    );
    expect(getFileNodeSemantic({ name: "src", path: "src", kind: "dir" }, true)).toBe(
      "file.folder.open"
    );
  });

  it("maps representative file extensions", () => {
    expect(getFileNodeSemantic({ name: "app.tsx", path: "app.tsx", kind: "file" }, false)).toBe(
      "file.type.code"
    );
    expect(
      getFileNodeSemantic({ name: "theme.json", path: "theme.json", kind: "file" }, false)
    ).toBe("file.type.data");
    expect(getFileNodeSemantic({ name: "README.md", path: "README.md", kind: "file" }, false)).toBe(
      "file.type.doc"
    );
  });
});
