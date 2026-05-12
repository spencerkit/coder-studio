import { act, render, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { themeAtom } from "../../../atoms/app-ui";
import { getThemeById } from "../../../theme";
import { MonacoHost } from "./monaco-host";

const {
  mockCreateEditor,
  mockCreateModel,
  mockDefineTheme,
  mockSetModelLanguage,
  mockSetTheme,
  mockEditorInstance,
  mockWorker,
  mockAddCommand,
  mockSetModel,
  mockRegistryGetOrCreate,
  modelState,
  workspaceModelA,
  workspaceModelB,
} = vi.hoisted(() => {
  const createMockModel = (initialValue: string, language = "typescript") => {
    let currentValue = initialValue;

    return {
      language,
      dispose: vi.fn(),
      getValue: vi.fn(() => currentValue),
      setValue: vi.fn((next: string) => {
        currentValue = next;
      }),
    };
  };

  const modelState = {
    current: null as null | ReturnType<typeof createMockModel>,
  };
  const workspaceModelA = createMockModel("export const a = 1;");
  const workspaceModelB = createMockModel("export const b = 2;");
  const mockCreateModel = vi.fn((value: string, language: string) =>
    createMockModel(value, language)
  );
  const mockAddCommand = vi.fn(() => undefined);
  const mockSetModel = vi.fn((model: ReturnType<typeof createMockModel>) => {
    modelState.current = model;
  });
  const mockEditorInstance = {
    dispose: vi.fn(),
    getModel: vi.fn(() => modelState.current),
    getValue: vi.fn(() => modelState.current?.getValue() ?? ""),
    layout: vi.fn(),
    onDidChangeModelContent: vi.fn(() => ({ dispose: vi.fn() })),
    addCommand: mockAddCommand,
    setModel: mockSetModel,
    setValue: vi.fn(),
  };
  const mockRegistryGetOrCreate = vi.fn(({ path }: { path: string }) =>
    path === "src/other.ts"
      ? {
          key: "/repo::src/other.ts",
          uri: { toString: () => "file:///repo/src/other.ts" },
          model: workspaceModelB,
          language: "typescript",
          path,
        }
      : {
          key: "/repo::src/example.ts",
          uri: { toString: () => "file:///repo/src/example.ts" },
          model: workspaceModelA,
          language: "typescript",
          path,
        }
  );

  return {
    mockCreateEditor: vi.fn(() => mockEditorInstance),
    mockCreateModel,
    mockDefineTheme: vi.fn(),
    mockSetModelLanguage: vi.fn(),
    mockSetTheme: vi.fn(),
    mockEditorInstance,
    mockWorker: class MockWorker {},
    mockAddCommand,
    mockSetModel,
    mockRegistryGetOrCreate,
    modelState,
    workspaceModelA,
    workspaceModelB,
  };
});

vi.mock("../monaco/model-registry", () => ({
  monacoModelRegistry: {
    getOrCreate: mockRegistryGetOrCreate,
    updateFromDisk: vi.fn(),
    disposeWorkspace: vi.fn(),
  },
}));

vi.mock("monaco-editor", () => ({
  KeyCode: {
    KeyS: 49,
  },
  KeyMod: {
    CtrlCmd: 2048,
  },
  editor: {
    create: mockCreateEditor,
    createModel: mockCreateModel,
    defineTheme: mockDefineTheme,
    setModelLanguage: mockSetModelLanguage,
    setTheme: mockSetTheme,
  },
}));

vi.mock("monaco-editor/esm/vs/editor/editor.worker?worker", () => ({ default: mockWorker }));
vi.mock("monaco-editor/esm/vs/language/css/css.worker?worker", () => ({ default: mockWorker }));
vi.mock("monaco-editor/esm/vs/language/html/html.worker?worker", () => ({ default: mockWorker }));
vi.mock("monaco-editor/esm/vs/language/json/json.worker?worker", () => ({ default: mockWorker }));
vi.mock("monaco-editor/esm/vs/language/typescript/ts.worker?worker", () => ({
  default: mockWorker,
}));

describe("MonacoHost", () => {
  beforeEach(() => {
    mockCreateEditor.mockClear();
    mockCreateModel.mockClear();
    mockDefineTheme.mockClear();
    mockSetModelLanguage.mockClear();
    mockSetTheme.mockClear();
    mockAddCommand.mockClear();
    mockSetModel.mockClear();
    mockRegistryGetOrCreate.mockClear();
    mockEditorInstance.dispose.mockClear();
    mockEditorInstance.getValue.mockClear();
    mockEditorInstance.layout.mockClear();
    mockEditorInstance.setValue.mockClear();
    modelState.current = null;
  });

  it("creates the editor with a named Monaco theme when ui theme is mint-light", async () => {
    const store = createStore();
    store.set(themeAtom, "mint-light");
    const theme = getThemeById("mint-light");

    render(
      <Provider store={store}>
        <MonacoHost
          workspaceId="ws-test"
          workspaceRootPath="/repo"
          filePath="src/example.ts"
          content="export const a = 1;"
        />
      </Provider>
    );

    await waitFor(() => {
      expect(mockDefineTheme).toHaveBeenCalledWith("coder-studio-mint-light", theme.monaco);
      expect(mockCreateEditor).toHaveBeenCalledWith(
        expect.any(HTMLDivElement),
        expect.objectContaining({
          theme: "coder-studio-mint-light",
        })
      );
    });
  });

  it("updates the editor theme when the ui theme changes", async () => {
    const store = createStore();

    render(
      <Provider store={store}>
        <MonacoHost
          workspaceId="ws-test"
          workspaceRootPath="/repo"
          filePath="src/example.ts"
          content="export const a = 1;"
        />
      </Provider>
    );

    await act(async () => {
      store.set(themeAtom, "graphite-light");
    });

    await waitFor(() => {
      expect(mockDefineTheme).toHaveBeenCalledWith(
        "coder-studio-graphite-light",
        getThemeById("graphite-light").monaco
      );
      expect(mockSetTheme).toHaveBeenCalledWith("coder-studio-graphite-light");
    });
  });

  it("registers a save command for Ctrl/Cmd+S", async () => {
    const onSave = vi.fn();

    render(
      <Provider store={createStore()}>
        <MonacoHost
          workspaceId="ws-test"
          workspaceRootPath="/repo"
          filePath="src/example.ts"
          content="export const a = 1;"
          onSave={onSave}
        />
      </Provider>
    );

    await waitFor(() => {
      expect(mockAddCommand).toHaveBeenCalledWith(2048 | 49, expect.any(Function));
    });
  });

  it("calls layout when an existing editor becomes visible again", async () => {
    const store = createStore();
    const { rerender } = render(
      <Provider store={store}>
        <MonacoHost
          workspaceId="ws-test"
          workspaceRootPath="/repo"
          filePath="config.json"
          content="{}"
          visible={false}
        />
      </Provider>
    );

    rerender(
      <Provider store={store}>
        <MonacoHost
          workspaceId="ws-test"
          workspaceRootPath="/repo"
          filePath="config.json"
          content="{}"
          visible
        />
      </Provider>
    );

    await waitFor(() => {
      expect(mockEditorInstance.layout).toHaveBeenCalled();
    });
  });

  it("switches Monaco models instead of recreating the editor when the workspace file changes", async () => {
    const store = createStore();
    const { rerender } = render(
      <Provider store={store}>
        <MonacoHost
          workspaceId="ws-test"
          workspaceRootPath="/repo"
          filePath="src/example.ts"
          content="export const a = 1;"
        />
      </Provider>
    );

    await waitFor(() => {
      expect(mockSetModel).toHaveBeenCalledWith(workspaceModelA);
    });

    rerender(
      <Provider store={store}>
        <MonacoHost
          workspaceId="ws-test"
          workspaceRootPath="/repo"
          filePath="src/other.ts"
          content="export const b = 2;"
        />
      </Provider>
    );

    await waitFor(() => {
      expect(mockSetModel).toHaveBeenLastCalledWith(workspaceModelB);
    });

    expect(mockCreateEditor).toHaveBeenCalledTimes(1);
    expect(mockRegistryGetOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceRootPath: "/repo",
        path: "src/other.ts",
      })
    );
  });
});
