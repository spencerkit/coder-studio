import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDiagnosticsController } from "./diagnostics";

const { mockSetModelMarkers, brokenModel } = vi.hoisted(() => ({
  mockSetModelMarkers: vi.fn(),
  brokenModel: {
    getVersionId: () => 1,
  },
}));

vi.mock("monaco-editor", () => ({
  Uri: {
    file: (path: string) => ({
      fsPath: path,
      path,
      scheme: "file",
      toString: () => `file://${path}`,
    }),
  },
  MarkerSeverity: {
    Error: 8,
    Warning: 4,
    Info: 2,
    Hint: 1,
  },
  editor: {
    getModel: vi.fn((uri: { path: string }) =>
      uri.path.endsWith("/broken.ts") ? brokenModel : null
    ),
    setModelMarkers: mockSetModelMarkers,
  },
}));

describe("createDiagnosticsController", () => {
  beforeEach(() => {
    mockSetModelMarkers.mockClear();
  });

  it("replaces markers for the same file and clears them on demand", () => {
    const controller = createDiagnosticsController();

    controller.apply("/repo", {
      path: "e2e/fixtures/lsp-workspace/broken.ts",
      diagnostics: [
        {
          message: "Cannot find name 'missingSymbol'.",
          severity: "error",
          range: {
            startLine: 1,
            startColumn: 23,
            endLine: 1,
            endColumn: 36,
          },
        },
      ],
    });

    expect(mockSetModelMarkers).toHaveBeenCalledWith(
      expect.anything(),
      "coder-studio-lsp",
      expect.arrayContaining([
        expect.objectContaining({
          message: "Cannot find name 'missingSymbol'.",
        }),
      ])
    );

    controller.clearFile("/repo", "e2e/fixtures/lsp-workspace/broken.ts");

    expect(mockSetModelMarkers).toHaveBeenLastCalledWith(expect.anything(), "coder-studio-lsp", []);
  });

  it("drops stale diagnostics updates for an older document version", () => {
    const controller = createDiagnosticsController();

    controller.apply("/repo", {
      path: "e2e/fixtures/lsp-workspace/broken.ts",
      version: 0,
      diagnostics: [
        {
          message: "old result",
          severity: "warning",
          range: {
            startLine: 1,
            startColumn: 1,
            endLine: 1,
            endColumn: 5,
          },
        },
      ],
    });

    expect(mockSetModelMarkers).not.toHaveBeenCalledWith(
      brokenModel,
      "coder-studio-lsp",
      expect.arrayContaining([expect.objectContaining({ message: "old result" })])
    );
  });
});
