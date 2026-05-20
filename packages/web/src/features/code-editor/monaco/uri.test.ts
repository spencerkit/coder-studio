import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUriFile } = vi.hoisted(() => {
  class MockUri {
    scheme = "file";
    fsPath: string;
    path: string;

    constructor(path: string) {
      this.fsPath = path;
      this.path = path;
    }

    toString(): string {
      return `file://${this.path.startsWith("/") ? "" : "/"}${this.path}`;
    }
  }

  return {
    mockUriFile: vi.fn((path: string) => new MockUri(path)),
  };
});

vi.mock("monaco-editor", () => ({
  Uri: {
    file: mockUriFile,
  },
}));

import { fromWorkspaceFileUri, toWorkspaceFileUri } from "./uri";

describe("workspace file URIs", () => {
  beforeEach(() => {
    mockUriFile.mockClear();
  });

  it("builds a stable file URI from workspace root + relative path", () => {
    expect(toWorkspaceFileUri("/repo", "src/main.ts").toString()).toBe("file:///repo/src/main.ts");
    expect(mockUriFile).toHaveBeenCalledWith("/repo/src/main.ts");
  });

  it("maps a workspace file URI back to a workspace-relative path", () => {
    const uri = toWorkspaceFileUri("/repo", "src/main.ts");

    expect(fromWorkspaceFileUri(uri, "/repo")).toBe("src/main.ts");
  });

  it("returns null for file URIs outside the workspace root", () => {
    const externalUri = {
      scheme: "file",
      fsPath: "/outside/other.ts",
      path: "/outside/other.ts",
      toString: () => "file:///outside/other.ts",
    };

    expect(fromWorkspaceFileUri(externalUri, "/repo")).toBeNull();
  });
});
