import { render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { getThemeById } from "../../../theme";
import { MonacoDiffHost } from "./monaco-diff-host";

const {
  mockCreateDiffEditor,
  mockDefineTheme,
  mockSetModel,
  mockOriginalModel,
  mockModifiedModel,
  mockSetTheme,
} = vi.hoisted(() => {
  const mockOriginalModel = {
    dispose: vi.fn(),
    getValue: vi.fn(() => "export const before = 1;\n"),
    setValue: vi.fn(),
  };
  const mockModifiedModel = {
    dispose: vi.fn(),
    getValue: vi.fn(() => "export const after = 2;\n"),
    setValue: vi.fn(),
  };
  const mockSetModel = vi.fn();
  return {
    mockCreateDiffEditor: vi.fn(() => ({
      dispose: vi.fn(),
      layout: vi.fn(),
      setModel: mockSetModel,
      updateOptions: vi.fn(),
    })),
    mockDefineTheme: vi.fn(),
    mockSetModel,
    mockOriginalModel,
    mockModifiedModel,
    mockSetTheme: vi.fn(),
  };
});

vi.mock("monaco-editor", () => ({
  editor: {
    createDiffEditor: mockCreateDiffEditor,
    createModel: vi
      .fn()
      .mockImplementationOnce(() => mockOriginalModel)
      .mockImplementationOnce(() => mockModifiedModel),
    defineTheme: mockDefineTheme,
    setTheme: mockSetTheme,
  },
}));

vi.mock("monaco-editor/esm/vs/editor/editor.worker?worker", () => ({
  default: class MockWorker {},
}));
vi.mock("monaco-editor/esm/vs/language/css/css.worker?worker", () => ({
  default: class MockWorker {},
}));
vi.mock("monaco-editor/esm/vs/language/html/html.worker?worker", () => ({
  default: class MockWorker {},
}));
vi.mock("monaco-editor/esm/vs/language/json/json.worker?worker", () => ({
  default: class MockWorker {},
}));
vi.mock("monaco-editor/esm/vs/language/typescript/ts.worker?worker", () => ({
  default: class MockWorker {},
}));

describe("MonacoDiffHost", () => {
  it("creates a Monaco diff editor with original and modified models", () => {
    render(
      <Provider store={createStore()}>
        <MonacoDiffHost
          filePath="src/app.ts"
          originalContent="export const before = 1;\n"
          modifiedContent="export const after = 2;\n"
        />
      </Provider>
    );

    expect(mockCreateDiffEditor).toHaveBeenCalled();
    expect(mockDefineTheme).toHaveBeenCalledWith(
      "coder-studio-workspace-mint-dark",
      expect.objectContaining({
        ...getThemeById("mint-dark").monaco,
        colors: expect.objectContaining({
          ...getThemeById("mint-dark").monaco.colors,
          "editor.background": "#00000000",
        }),
      })
    );
    expect(mockSetModel).toHaveBeenCalledWith({
      original: mockOriginalModel,
      modified: mockModifiedModel,
    });
    expect(screen.getByTestId("monaco-diff-host")).toBeInTheDocument();
  });
});
