import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { themeAtom } from "../../../atoms/app-ui";
import { wsClientAtom } from "../../../atoms/connection";
import { getThemeById } from "../../../theme";
import { activeFilePathAtomFamily } from "../../workspace/atoms";
import { pendingEditorNavigationAtomFamily } from "../atoms";
import { lspRuntimeModeAtom } from "../lsp/runtime-mode";
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
  mockSetPosition,
  mockSetSelection,
  mockRevealPositionInCenter,
  mockRevealRangeInCenter,
  mockRegistryGetOrCreate,
  mockRegisterCodeEditorOpenHandler,
  mockSetJavaScriptCompilerOptions,
  mockSetJavaScriptDiagnosticsOptions,
  mockSetJavaScriptEagerModelSync,
  mockRegisterLanguage,
  mockSetLanguageConfiguration,
  mockSetMonarchTokensProvider,
  mockSetTypeScriptCompilerOptions,
  mockSetTypeScriptDiagnosticsOptions,
  mockSetTypeScriptEagerModelSync,
  mockDetachLspBridgeModel,
  modelState,
  modelChangeListenerState,
  openHandlerState,
  workspaceModelA,
  workspaceModelB,
  mockConfigureLspBridge,
  mockAttachLspBridgeModel,
} = vi.hoisted(() => {
  const createUri = (path: string) => ({
    fsPath: path,
    path,
    scheme: "file",
    toString: () => `file://${path}`,
  });

  const createMockModel = (
    initialValue: string,
    language = "typescript",
    uri = createUri("/repo/src/example.ts")
  ) => {
    let currentValue = initialValue;

    return {
      language,
      uri,
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
  const openHandlerState = {
    current: null as null | ((input: unknown, source: unknown) => unknown),
  };
  const modelChangeListenerState = {
    current: null as null | (() => void),
  };
  const workspaceModelA = createMockModel(
    "export const a = 1;",
    "typescript",
    createUri("/repo/src/example.ts")
  );
  const workspaceModelB = createMockModel(
    "export const b = 2;",
    "typescript",
    createUri("/repo/src/other.ts")
  );
  const mockCreateModel = vi.fn((value: string, language: string) =>
    createMockModel(value, language)
  );
  const mockAddCommand = vi.fn(() => undefined);
  const mockSetModel = vi.fn((model: ReturnType<typeof createMockModel>) => {
    modelState.current = model;
  });
  const mockSetPosition = vi.fn();
  const mockSetSelection = vi.fn();
  const mockRevealPositionInCenter = vi.fn();
  const mockRevealRangeInCenter = vi.fn();
  const mockEditorInstance = {
    dispose: vi.fn(),
    getModel: vi.fn(() => modelState.current),
    getValue: vi.fn(() => modelState.current?.getValue() ?? ""),
    layout: vi.fn(),
    onDidChangeModel: vi.fn((listener: () => void) => {
      modelChangeListenerState.current = listener;
      return { dispose: vi.fn() };
    }),
    onDidChangeModelContent: vi.fn(() => ({ dispose: vi.fn() })),
    addCommand: mockAddCommand,
    revealPositionInCenter: mockRevealPositionInCenter,
    revealRangeInCenter: mockRevealRangeInCenter,
    setModel: mockSetModel,
    setPosition: mockSetPosition,
    setSelection: mockSetSelection,
    updateOptions: vi.fn(),
    setValue: vi.fn(),
  };
  const mockRegistryGetOrCreate = vi.fn(({ path }: { path: string }) =>
    path === "src/other.ts"
      ? {
          key: "/repo::src/other.ts",
          uri: workspaceModelB.uri,
          model: workspaceModelB,
          language: "typescript",
          path,
        }
      : {
          key: "/repo::src/example.ts",
          uri: workspaceModelA.uri,
          model: workspaceModelA,
          language: "typescript",
          path,
        }
  );
  const mockRegisterCodeEditorOpenHandler = vi.fn(
    (handler: (input: unknown, source: unknown) => unknown) => {
      openHandlerState.current = handler;
      return { dispose: vi.fn() };
    }
  );
  const mockRegisterLanguage = vi.fn();
  const mockSetLanguageConfiguration = vi.fn();
  const mockSetMonarchTokensProvider = vi.fn();
  const mockSetTypeScriptCompilerOptions = vi.fn();
  const mockSetJavaScriptCompilerOptions = vi.fn();
  const mockSetTypeScriptDiagnosticsOptions = vi.fn();
  const mockSetJavaScriptDiagnosticsOptions = vi.fn();
  const mockSetTypeScriptEagerModelSync = vi.fn();
  const mockSetJavaScriptEagerModelSync = vi.fn();
  const mockConfigureLspBridge = vi.fn();
  const mockDetachLspBridgeModel = vi.fn();
  const mockAttachLspBridgeModel = vi.fn((_input, onStateChange?: (state: unknown) => void) => {
    const handle = Object.assign(mockDetachLspBridgeModel, {
      install: vi.fn(async () => {}),
      retry: vi.fn(async () => {}),
    });
    if (onStateChange) {
      onStateChange({ kind: "ready" });
    }
    return handle;
  });

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
    mockSetPosition,
    mockSetSelection,
    mockRevealPositionInCenter,
    mockRevealRangeInCenter,
    mockRegistryGetOrCreate,
    mockRegisterCodeEditorOpenHandler,
    mockRegisterLanguage,
    mockSetLanguageConfiguration,
    mockSetMonarchTokensProvider,
    mockSetJavaScriptCompilerOptions,
    mockSetJavaScriptDiagnosticsOptions,
    mockSetJavaScriptEagerModelSync,
    mockSetTypeScriptCompilerOptions,
    mockSetTypeScriptDiagnosticsOptions,
    mockSetTypeScriptEagerModelSync,
    mockDetachLspBridgeModel,
    modelState,
    modelChangeListenerState,
    openHandlerState,
    workspaceModelA,
    workspaceModelB,
    mockConfigureLspBridge,
    mockAttachLspBridgeModel,
  };
});

vi.mock("../monaco/model-registry", () => ({
  monacoModelRegistry: {
    getOrCreate: mockRegistryGetOrCreate,
    updateFromDisk: vi.fn(),
    disposeWorkspace: vi.fn(),
  },
}));

vi.mock("../lsp/bridge", () => ({
  globalLspBridge: {
    configure: mockConfigureLspBridge,
    attachModel: mockAttachLspBridgeModel,
  },
}));

vi.mock("monaco-editor", () => ({
  KeyCode: {
    KeyS: 49,
  },
  KeyMod: {
    CtrlCmd: 2048,
  },
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
    typescript: {
      JsxEmit: {
        ReactJSX: 4,
      },
      ModuleKind: {
        ESNext: 99,
      },
      ModuleResolutionKind: {
        NodeJs: 2,
      },
      ScriptTarget: {
        ESNext: 99,
      },
      javascriptDefaults: {
        setCompilerOptions: mockSetJavaScriptCompilerOptions,
        setDiagnosticsOptions: mockSetJavaScriptDiagnosticsOptions,
        setEagerModelSync: mockSetJavaScriptEagerModelSync,
      },
      typescriptDefaults: {
        setCompilerOptions: mockSetTypeScriptCompilerOptions,
        setDiagnosticsOptions: mockSetTypeScriptDiagnosticsOptions,
        setEagerModelSync: mockSetTypeScriptEagerModelSync,
      },
    },
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
vi.mock("monaco-editor/esm/vs/editor/standalone/browser/standaloneServices.js", () => ({
  StandaloneServices: {
    get: vi.fn(() => ({
      registerCodeEditorOpenHandler: mockRegisterCodeEditorOpenHandler,
    })),
  },
}));
vi.mock("monaco-editor/esm/vs/editor/browser/services/codeEditorService.js", () => ({
  ICodeEditorService: "codeEditorService",
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
    mockSetPosition.mockClear();
    mockSetSelection.mockClear();
    mockRevealPositionInCenter.mockClear();
    mockRevealRangeInCenter.mockClear();
    mockRegistryGetOrCreate.mockClear();
    mockRegisterCodeEditorOpenHandler.mockClear();
    mockRegisterLanguage.mockClear();
    mockSetLanguageConfiguration.mockClear();
    mockSetMonarchTokensProvider.mockClear();
    mockEditorInstance.dispose.mockClear();
    mockEditorInstance.getValue.mockClear();
    mockEditorInstance.layout.mockClear();
    mockEditorInstance.setValue.mockClear();
    mockEditorInstance.updateOptions.mockClear();
    mockConfigureLspBridge.mockClear();
    mockAttachLspBridgeModel.mockClear();
    mockDetachLspBridgeModel.mockClear();
    modelState.current = null;
    modelChangeListenerState.current = null;
    openHandlerState.current = null;
  });

  it("configures Monaco JS/TS defaults for JSX syntax and eager model sync", () => {
    expect(mockSetTypeScriptCompilerOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        allowJs: true,
        allowNonTsExtensions: true,
        jsx: 4,
        module: 99,
        moduleResolution: 2,
        target: 99,
      })
    );
    expect(mockSetJavaScriptCompilerOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        allowJs: true,
        allowNonTsExtensions: true,
        jsx: 4,
      })
    );
    expect(mockSetTypeScriptEagerModelSync).toHaveBeenCalledWith(true);
    expect(mockSetJavaScriptEagerModelSync).toHaveBeenCalledWith(true);
    expect(mockSetTypeScriptDiagnosticsOptions).toHaveBeenCalledWith({
      noSemanticValidation: true,
      noSyntaxValidation: true,
    });
    expect(mockSetJavaScriptDiagnosticsOptions).toHaveBeenCalledWith({
      noSemanticValidation: true,
      noSyntaxValidation: true,
    });
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
      expect(mockDefineTheme).toHaveBeenCalledWith(
        "coder-studio-workspace-mint-light",
        expect.objectContaining({
          ...theme.monaco,
          colors: expect.objectContaining({
            ...theme.monaco.colors,
            "editor.background": "#00000000",
          }),
        })
      );
      expect(mockCreateEditor).toHaveBeenCalledWith(
        expect.any(HTMLDivElement),
        expect.objectContaining({
          readOnly: false,
          "semanticHighlighting.enabled": true,
          theme: "coder-studio-workspace-mint-light",
        })
      );
    });
  });

  it("keeps standalone Monaco themes opaque for non-workspace editors", async () => {
    const store = createStore();
    store.set(themeAtom, "mint-light");
    const theme = getThemeById("mint-light");

    render(
      <Provider store={store}>
        <MonacoHost filePath="settings.json" content='{"theme":"mint-light"}' standalone />
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

  it("passes explicit readOnly mode through to Monaco", async () => {
    render(
      <Provider store={createStore()}>
        <MonacoHost
          workspaceId="ws-test"
          workspaceRootPath="/repo"
          filePath="src/example.ts"
          content="export const a = 1;"
          readOnly
        />
      </Provider>
    );

    await waitFor(() => {
      expect(mockCreateEditor).toHaveBeenCalledWith(
        expect.any(HTMLDivElement),
        expect.objectContaining({
          readOnly: true,
        })
      );
      expect(mockEditorInstance.updateOptions).toHaveBeenCalledWith({ readOnly: true });
    });
  });

  it("does not recreate the editor when readOnly changes", async () => {
    const store = createStore();
    const { rerender } = render(
      <Provider store={store}>
        <MonacoHost
          workspaceId="ws-test"
          workspaceRootPath="/repo"
          filePath="src/example.ts"
          content="export const a = 1;"
          readOnly={false}
        />
      </Provider>
    );

    await waitFor(() => {
      expect(mockCreateEditor).toHaveBeenCalledTimes(1);
      expect(mockSetModel).toHaveBeenCalledWith(workspaceModelA);
      expect(mockEditorInstance.updateOptions).toHaveBeenCalledWith({ readOnly: false });
    });

    rerender(
      <Provider store={store}>
        <MonacoHost
          workspaceId="ws-test"
          workspaceRootPath="/repo"
          filePath="src/example.ts"
          content="export const a = 1;"
          readOnly
        />
      </Provider>
    );

    await waitFor(() => {
      expect(mockCreateEditor).toHaveBeenCalledTimes(1);
      expect(mockEditorInstance.updateOptions).toHaveBeenCalledWith({ readOnly: true });
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
        "coder-studio-workspace-graphite-light",
        expect.objectContaining({
          ...getThemeById("graphite-light").monaco,
          colors: expect.objectContaining({
            ...getThemeById("graphite-light").monaco.colors,
            "editor.background": "#00000000",
          }),
        })
      );
      expect(mockSetTheme).toHaveBeenCalledWith("coder-studio-workspace-graphite-light");
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

    expect(mockCreateEditor.mock.calls.length).toBeLessThanOrEqual(2);
    expect(mockRegistryGetOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceRootPath: "/repo",
        path: "src/other.ts",
      })
    );
  });

  it("configures the global lsp bridge and attaches workspace-backed models", async () => {
    render(
      <Provider store={createStore()}>
        <MonacoHost
          workspaceId="ws-test"
          workspaceRootPath="/repo"
          filePath="src/example.ts"
          content="export const a = 1;"
        />
      </Provider>
    );

    await waitFor(() => {
      expect(mockConfigureLspBridge).toHaveBeenCalledWith(
        expect.objectContaining({
          sendCommand: expect.any(Function),
        })
      );
      expect(mockAttachLspBridgeModel).toHaveBeenCalledWith(
        {
          workspaceId: "ws-test",
          workspaceRootPath: "/repo",
          path: "src/example.ts",
          monacoLanguage: "typescript",
          model: workspaceModelA,
        },
        expect.any(Function)
      );
    });
  });

  it("attaches tsx workspace-backed models with the react TypeScript language id", async () => {
    render(
      <Provider store={createStore()}>
        <MonacoHost
          workspaceId="ws-test"
          workspaceRootPath="/repo"
          filePath="src/app.tsx"
          content="export function App() { return <div />; }"
        />
      </Provider>
    );

    await waitFor(() => {
      expect(mockAttachLspBridgeModel).toHaveBeenCalledWith(
        {
          workspaceId: "ws-test",
          workspaceRootPath: "/repo",
          path: "src/app.tsx",
          monacoLanguage: "typescriptreact",
          model: workspaceModelA,
        },
        expect.any(Function)
      );
    });
  });

  it("attaches vue workspace-backed models with the vue language id", async () => {
    render(
      <Provider store={createStore()}>
        <MonacoHost
          workspaceId="ws-test"
          workspaceRootPath="/repo"
          filePath="src/App.vue"
          content={'<script setup lang="ts">const count = 1;</script>'}
        />
      </Provider>
    );

    await waitFor(() => {
      expect(mockRegistryGetOrCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceRootPath: "/repo",
          path: "src/App.vue",
          language: "vue",
        })
      );
      expect(mockAttachLspBridgeModel).toHaveBeenCalledWith(
        {
          workspaceId: "ws-test",
          workspaceRootPath: "/repo",
          path: "src/App.vue",
          monacoLanguage: "vue",
          model: workspaceModelA,
        },
        expect.any(Function)
      );
    });
  });

  it("does not attach the lsp bridge when runtime mode is off", async () => {
    const store = createStore();
    store.set(lspRuntimeModeAtom, "off");

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
      expect(mockSetModel).toHaveBeenCalledWith(workspaceModelA);
    });

    expect(mockAttachLspBridgeModel).not.toHaveBeenCalled();
  });

  it("detaches the existing lsp bridge handle when runtime mode switches off", async () => {
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
      expect(mockAttachLspBridgeModel).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      store.set(lspRuntimeModeAtom, "off");
    });

    rerender(
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
      expect(mockDetachLspBridgeModel).toHaveBeenCalledTimes(1);
    });
  });

  it("wires websocket subscriptions into the lsp bridge for workspace-backed editors", async () => {
    const store = createStore();
    const subscribe = vi.fn(() => () => {});
    store.set(wsClientAtom, { sendCommand: vi.fn(), subscribe } as never);

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
      expect(mockConfigureLspBridge).toHaveBeenCalledWith(
        expect.objectContaining({
          sendCommand: expect.any(Function),
          subscribe: expect.any(Function),
        })
      );
    });
  });

  it("renders an LSP notice and wires the install action", async () => {
    const install = vi.fn(async () => {});
    mockAttachLspBridgeModel.mockImplementationOnce(
      (_input, onStateChange?: (state: unknown) => void) => {
        const handle = Object.assign(vi.fn(), {
          install,
          retry: vi.fn(async () => {}),
        });
        onStateChange?.({
          kind: "tool_missing",
          serverKind: "python",
          displayName: "Python language server",
          errorCode: "lsp_tool_missing",
          message: "Python language server is not installed",
          autoInstallSupported: true,
          missingCommands: ["pylsp"],
          missingPrerequisites: [],
        });
        return handle;
      }
    );

    render(
      <Provider store={createStore()}>
        <MonacoHost
          workspaceId="ws-test"
          workspaceRootPath="/repo"
          filePath="src/main.py"
          content="print('hi')"
        />
      </Provider>
    );

    expect(await screen.findByText("Python language server unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Install" }));

    await waitFor(() => {
      expect(install).toHaveBeenCalledTimes(1);
    });
  });

  it("routes cross-file Monaco opens through workspace navigation", async () => {
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

    await waitFor(() => {
      expect(mockRegisterCodeEditorOpenHandler).toHaveBeenCalled();
      expect(openHandlerState.current).toBeTypeOf("function");
    });

    let openPromise: Promise<unknown> | null = null;
    await act(async () => {
      openPromise = Promise.resolve(
        openHandlerState.current?.(
          {
            resource: workspaceModelB.uri,
            options: {
              selection: {
                startLineNumber: 7,
                startColumn: 3,
                endLineNumber: 7,
                endColumn: 12,
              },
            },
          },
          mockEditorInstance
        )
      );
    });

    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe("src/other.ts");
    expect(store.get(pendingEditorNavigationAtomFamily("ws-test"))).toMatchObject({
      workspaceId: "ws-test",
      path: "src/other.ts",
      line: 7,
      column: 3,
      endLine: 7,
      endColumn: 12,
      source: "lsp",
    });

    act(() => {
      mockSetModel(workspaceModelB);
      modelChangeListenerState.current?.();
    });

    await expect(openPromise).resolves.toBe(mockEditorInstance);
  });

  it("applies pending editor navigation to the active workspace-backed model", async () => {
    const store = createStore();
    store.set(pendingEditorNavigationAtomFamily("ws-test"), {
      workspaceId: "ws-test",
      path: "src/example.ts",
      line: 12,
      column: 5,
      endLine: 14,
      endColumn: 3,
      source: "lsp",
    });

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
      expect(mockSetSelection).toHaveBeenCalledWith({
        startLineNumber: 12,
        startColumn: 5,
        endLineNumber: 14,
        endColumn: 3,
      });
      expect(mockRevealRangeInCenter).toHaveBeenCalledWith({
        startLineNumber: 12,
        startColumn: 5,
        endLineNumber: 14,
        endColumn: 3,
      });
    });

    expect(store.get(pendingEditorNavigationAtomFamily("ws-test"))).toBeNull();
    expect(mockSetPosition).not.toHaveBeenCalled();
    expect(mockRevealPositionInCenter).not.toHaveBeenCalled();
  });
});
