import { beforeEach, describe, expect, it, vi } from "vitest";

const { makeUri, mockCreateModel, mockGetModel, mockSetModelLanguage, modelStore } = vi.hoisted(
  () => {
    const modelStore = new Map<string, unknown>();

    const makeUri = (path: string) => ({
      scheme: "file",
      fsPath: path,
      path,
      toString() {
        return `file://${path.startsWith("/") ? "" : "/"}${path}`;
      },
    });

    const mockGetModel = vi.fn(
      (uri: { toString(): string }) => modelStore.get(uri.toString()) ?? null
    );

    const mockCreateModel = vi.fn(
      (
        content: string,
        language: string,
        uri: { toString(): string; path: string; fsPath: string }
      ) => {
        let currentValue = content;
        const model = {
          uri,
          language,
          dispose: vi.fn(),
          getValue: vi.fn(() => currentValue),
          setValue: vi.fn((next: string) => {
            currentValue = next;
          }),
        };
        modelStore.set(uri.toString(), model);
        return model;
      }
    );

    const mockSetModelLanguage = vi.fn((model: { language?: string }, language: string) => {
      model.language = language;
    });

    return {
      makeUri,
      mockCreateModel,
      mockGetModel,
      mockSetModelLanguage,
      modelStore,
    };
  }
);

vi.mock("monaco-editor", () => ({
  Uri: {
    file: makeUri,
  },
  editor: {
    createModel: mockCreateModel,
    getModel: mockGetModel,
    setModelLanguage: mockSetModelLanguage,
  },
}));

import { createModelRegistry } from "./model-registry";

describe("Monaco model registry", () => {
  beforeEach(() => {
    modelStore.clear();
    mockGetModel.mockClear();
    mockCreateModel.mockClear();
    mockSetModelLanguage.mockClear();
  });

  it("reuses an existing Monaco model for the same workspace file", () => {
    const registry = createModelRegistry();

    const first = registry.getOrCreate({
      workspaceRootPath: "/repo",
      path: "src/main.ts",
      language: "typescript",
      content: "export const a = 1;\n",
    });
    const second = registry.getOrCreate({
      workspaceRootPath: "/repo",
      path: "src/main.ts",
      language: "typescript",
      content: "export const a = 1;\n",
    });

    expect(second.model).toBe(first.model);
    expect(mockCreateModel).toHaveBeenCalledTimes(1);
  });

  it("updates an existing Monaco model from disk only when the content changes", () => {
    const registry = createModelRegistry();
    const handle = registry.getOrCreate({
      workspaceRootPath: "/repo",
      path: "src/main.ts",
      language: "typescript",
      content: "export const a = 1;\n",
    });

    const model = handle.model as {
      setValue: ReturnType<typeof vi.fn>;
      getValue: ReturnType<typeof vi.fn>;
    };
    model.setValue.mockClear();

    registry.updateFromDisk({
      workspaceRootPath: "/repo",
      path: "src/main.ts",
      language: "typescript",
      content: "export const a = 1;\n",
    });

    expect(model.setValue).not.toHaveBeenCalled();

    registry.updateFromDisk({
      workspaceRootPath: "/repo",
      path: "src/main.ts",
      language: "typescript",
      content: "export const a = 2;\n",
    });

    expect(model.setValue).toHaveBeenCalledWith("export const a = 2;\n");
  });

  it("disposes all models for a workspace root", () => {
    const registry = createModelRegistry();
    const handle = registry.getOrCreate({
      workspaceRootPath: "/repo",
      path: "src/main.ts",
      language: "typescript",
      content: "export const a = 1;\n",
    });

    registry.disposeWorkspace("/repo");

    expect((handle.model as { dispose: ReturnType<typeof vi.fn> }).dispose).toHaveBeenCalledTimes(
      1
    );
  });
});
