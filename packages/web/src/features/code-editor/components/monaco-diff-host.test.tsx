import { render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getThemeById } from "../../../theme";
import { MonacoDiffHost } from "./monaco-diff-host";

const {
  mockCreateDiffEditor,
  mockRegisterLanguage,
  mockSetLanguageConfiguration,
  mockSetMonarchTokensProvider,
  mockDefineTheme,
  mockCreateModel,
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
  const mockCreateModel = vi
    .fn()
    .mockImplementationOnce(() => mockOriginalModel)
    .mockImplementationOnce(() => mockModifiedModel);
  return {
    mockCreateDiffEditor: vi.fn(() => ({
      dispose: vi.fn(),
      layout: vi.fn(),
      setModel: mockSetModel,
      updateOptions: vi.fn(),
    })),
    mockCreateModel,
    mockDefineTheme: vi.fn(),
    mockSetModel,
    mockOriginalModel,
    mockModifiedModel,
    mockRegisterLanguage: vi.fn(),
    mockSetLanguageConfiguration: vi.fn(),
    mockSetMonarchTokensProvider: vi.fn(),
    mockSetTheme: vi.fn(),
  };
});

vi.mock("monaco-editor", () => ({
  languages: {
    register: mockRegisterLanguage,
    setLanguageConfiguration: mockSetLanguageConfiguration,
    setMonarchTokensProvider: mockSetMonarchTokensProvider,
    IndentAction: {
      None: 0,
      Indent: 1,
      IndentOutdent: 2,
      Outdent: 3,
    },
  },
  editor: {
    createDiffEditor: mockCreateDiffEditor,
    createModel: mockCreateModel,
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
  beforeEach(() => {
    mockCreateDiffEditor.mockClear();
    mockDefineTheme.mockClear();
    mockSetModel.mockClear();
    mockSetTheme.mockClear();
    mockOriginalModel.dispose.mockClear();
    mockModifiedModel.dispose.mockClear();
    mockCreateModel
      .mockReset()
      .mockImplementationOnce(() => mockOriginalModel)
      .mockImplementationOnce(() => mockModifiedModel);
  });

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

  it("creates vue diff models with the vue language id", () => {
    render(
      <Provider store={createStore()}>
        <MonacoDiffHost
          filePath="src/App.vue"
          originalContent="<template><div>{{ before }}</div></template>\n"
          modifiedContent="<template><div>{{ after }}</div></template>\n"
        />
      </Provider>
    );

    expect(mockCreateModel).toHaveBeenNthCalledWith(1, expect.stringContaining("before"), "vue");
    expect(mockCreateModel).toHaveBeenNthCalledWith(2, expect.stringContaining("after"), "vue");
  });
});
