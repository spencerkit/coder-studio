import * as monaco from "monaco-editor";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLspBridge } from "./bridge";

type BridgeSendCommand = NonNullable<
  NonNullable<Parameters<typeof createLspBridge>[0]>["sendCommand"]
>;
type BridgeEventHandler = (topic: string, payload: unknown) => void;
type ReadyEnsureSessionResult = {
  kind: "ready";
  displayName: string;
  source: "bundled";
  summary: {
    workspaceId: string;
    serverKind: "typescript";
    status: "ready";
    capabilities: {
      definition: boolean;
      references: boolean;
      hover: boolean;
      documentSymbols: boolean;
      diagnostics: boolean;
    };
  };
};
type ResolveEnsureSession = (summary: ReadyEnsureSessionResult) => void;

const { mockRegistryGetOrCreate } = vi.hoisted(() => ({
  mockRegistryGetOrCreate: vi.fn(),
}));

vi.mock("../monaco/model-registry", () => ({
  monacoModelRegistry: {
    getOrCreate: mockRegistryGetOrCreate,
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
  languages: {
    registerDefinitionProvider: vi.fn(),
    registerHoverProvider: vi.fn(),
    registerReferenceProvider: vi.fn(),
    registerDocumentSymbolProvider: vi.fn(),
    registerDocumentSemanticTokensProvider: vi.fn(),
    SymbolKind: {
      Variable: 13,
    },
  },
  MarkerSeverity: {
    Error: 8,
    Warning: 4,
    Info: 2,
    Hint: 1,
  },
  editor: {
    getModel: vi.fn(() => null),
    setModelMarkers: vi.fn(),
  },
}));

function createMockModel(
  initialValue: string,
  version = 1,
  uri = monaco.Uri.file("/repo/e2e/fixtures/lsp-workspace/shared.ts")
) {
  let currentValue = initialValue;
  let currentVersion = version;
  let listener: (() => void) | null = null;

  return {
    uri,
    getValue: () => currentValue,
    getVersionId: () => currentVersion,
    onDidChangeContent(callback: () => void) {
      listener = callback;
      return { dispose() {} };
    },
    fireDidChangeContent(nextValue: string, nextVersion: number) {
      currentValue = nextValue;
      currentVersion = nextVersion;
      listener?.();
    },
  } as monaco.editor.ITextModel & {
    fireDidChangeContent(nextValue: string, nextVersion: number): void;
  };
}

function createMockPosition(lineNumber: number, column: number): monaco.Position {
  return { lineNumber, column } as monaco.Position;
}

describe("createLspBridge", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.mocked(monaco.editor.getModel).mockReturnValue(null);
    mockRegistryGetOrCreate.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ensures a session, opens a supported document, debounces changes, and closes on detach", async () => {
    const sendCommand = vi
      .fn()
      .mockResolvedValueOnce({
        kind: "ready",
        displayName: "TypeScript language server",
        source: "bundled",
        summary: {
          workspaceId: "ws-1",
          serverKind: "typescript",
          status: "ready",
          capabilities: {
            definition: true,
            references: true,
            hover: true,
            documentSymbols: true,
            diagnostics: true,
          },
        },
      })
      .mockResolvedValue(undefined);

    const unsubscribe = vi.fn();
    const bridge = createLspBridge({
      sendCommand: sendCommand as BridgeSendCommand,
      subscribe: vi.fn(() => unsubscribe),
    });

    const model = createMockModel("export const sharedValue = 1;\n");
    const detach = bridge.attachModel({
      workspaceId: "ws-1",
      workspaceRootPath: "/repo",
      path: "e2e/fixtures/lsp-workspace/shared.ts",
      monacoLanguage: "typescript",
      model,
    });

    await vi.waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("lsp.ensureSession", {
        workspaceId: "ws-1",
        path: "e2e/fixtures/lsp-workspace/shared.ts",
      });
      expect(sendCommand).toHaveBeenCalledWith("lsp.openDocument", {
        workspaceId: "ws-1",
        path: "e2e/fixtures/lsp-workspace/shared.ts",
        languageId: "typescript",
        text: "export const sharedValue = 1;\n",
      });
    });

    model.fireDidChangeContent("export const sharedValue = 2;\n", 2);

    await vi.advanceTimersByTimeAsync(75);

    expect(sendCommand).toHaveBeenCalledWith("lsp.changeDocument", {
      workspaceId: "ws-1",
      path: "e2e/fixtures/lsp-workspace/shared.ts",
      text: "export const sharedValue = 2;\n",
    });

    detach();

    expect(sendCommand).toHaveBeenCalledWith("lsp.closeDocument", {
      workspaceId: "ws-1",
      path: "e2e/fixtures/lsp-workspace/shared.ts",
    });
  });

  it("uses the react TypeScript language id for tsx files", async () => {
    const sendCommand = vi
      .fn()
      .mockResolvedValueOnce({
        kind: "ready",
        displayName: "TypeScript language server",
        source: "bundled",
        summary: {
          workspaceId: "ws-1",
          serverKind: "typescript",
          status: "ready",
          capabilities: {
            definition: true,
            references: true,
            hover: true,
            documentSymbols: true,
            diagnostics: true,
          },
        },
      })
      .mockResolvedValue(undefined);

    const bridge = createLspBridge({
      sendCommand: sendCommand as BridgeSendCommand,
      subscribe: vi.fn(() => () => {}),
    });

    bridge.attachModel({
      workspaceId: "ws-1",
      workspaceRootPath: "/repo",
      path: "src/app.tsx",
      monacoLanguage: "typescriptreact",
      model: createMockModel(
        "export function App() { return <div />; }\n",
        1,
        monaco.Uri.file("/repo/src/app.tsx")
      ),
    });

    await vi.waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("lsp.openDocument", {
        workspaceId: "ws-1",
        path: "src/app.tsx",
        languageId: "typescriptreact",
        text: "export function App() { return <div />; }\n",
      });
    });
  });

  it("opens vue documents through the lazy lsp bridge using the vue language id", async () => {
    const sendCommand = vi
      .fn()
      .mockResolvedValueOnce({
        kind: "ready",
        displayName: "Vue language server",
        source: "managed",
        summary: {
          workspaceId: "ws-1",
          serverKind: "vue",
          status: "ready",
          capabilities: {
            definition: true,
            references: true,
            hover: true,
            documentSymbols: true,
            diagnostics: true,
          },
        },
      })
      .mockResolvedValue(undefined);

    const bridge = createLspBridge({
      sendCommand: sendCommand as BridgeSendCommand,
      subscribe: vi.fn(() => () => {}),
    });

    bridge.attachModel({
      workspaceId: "ws-1",
      workspaceRootPath: "/repo",
      path: "src/App.vue",
      monacoLanguage: "vue",
      model: createMockModel(
        "<template><div /></template>\n",
        1,
        monaco.Uri.file("/repo/src/App.vue")
      ),
    });

    await vi.waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("lsp.openDocument", {
        workspaceId: "ws-1",
        path: "src/App.vue",
        languageId: "vue",
        text: "<template><div /></template>\n",
      });
    });
  });

  it("does not open a document when ensureSession returns disabled", async () => {
    const sendCommand = vi.fn().mockResolvedValueOnce({
      kind: "disabled",
      mode: "off",
      message: "LSP is disabled by runtime mode",
    });

    const bridge = createLspBridge({
      sendCommand: sendCommand as BridgeSendCommand,
      subscribe: vi.fn(() => () => {}),
    });

    bridge.attachModel({
      workspaceId: "ws-1",
      workspaceRootPath: "/repo",
      path: "e2e/fixtures/lsp-workspace/shared.ts",
      monacoLanguage: "typescript",
      model: createMockModel("export const sharedValue = 1;\n"),
    });

    await vi.waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("lsp.ensureSession", {
        workspaceId: "ws-1",
        path: "e2e/fixtures/lsp-workspace/shared.ts",
      });
    });

    expect(sendCommand).not.toHaveBeenCalledWith("lsp.openDocument", expect.anything());
  });

  it("registers Monaco providers for tsx files on the TypeScript language", () => {
    const bridge = createLspBridge({
      sendCommand: vi.fn() as BridgeSendCommand,
      subscribe: vi.fn(() => () => {}),
    });

    const registerDefinitionProvider = vi.mocked(monaco.languages.registerDefinitionProvider);

    bridge.attachModel({
      workspaceId: "ws-1",
      workspaceRootPath: "/repo",
      path: "src/app.tsx",
      monacoLanguage: "typescriptreact",
      model: createMockModel(
        "export function App() { return <div />; }\n",
        1,
        monaco.Uri.file("/repo/src/app.tsx")
      ),
    });

    expect(registerDefinitionProvider).toHaveBeenCalledWith(
      "typescript",
      expect.objectContaining({
        provideDefinition: expect.any(Function),
      })
    );
  });

  it("returns a no-op detach function for unsupported languages", () => {
    const sendCommand = vi.fn();
    const bridge = createLspBridge({
      sendCommand: sendCommand as BridgeSendCommand,
      subscribe: vi.fn(() => () => {}),
    });

    const detach = bridge.attachModel({
      workspaceId: "ws-1",
      workspaceRootPath: "/repo",
      path: "README.md",
      monacoLanguage: "markdown",
      model: createMockModel("# title\n", 1, monaco.Uri.file("/repo/README.md")),
    });

    detach();

    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("reuses one diagnostics subscription per workspace until the last model detaches", async () => {
    const readySummary = {
      kind: "ready" as const,
      displayName: "TypeScript language server",
      source: "bundled" as const,
      summary: {
        workspaceId: "ws-1",
        serverKind: "typescript" as const,
        status: "ready" as const,
        capabilities: {
          definition: true,
          references: true,
          hover: true,
          documentSymbols: true,
          diagnostics: true,
        },
      },
    };

    const unsubscribe = vi.fn();
    const subscribe = vi.fn(() => unsubscribe);
    const bridge = createLspBridge({
      sendCommand: vi.fn().mockResolvedValue(readySummary) as BridgeSendCommand,
      subscribe,
    });

    const firstDetach = bridge.attachModel({
      workspaceId: "ws-1",
      workspaceRootPath: "/repo",
      path: "src/a.ts",
      monacoLanguage: "typescript",
      model: createMockModel("export const a = 1;\n", 1, monaco.Uri.file("/repo/src/a.ts")),
    });
    const secondDetach = bridge.attachModel({
      workspaceId: "ws-1",
      workspaceRootPath: "/repo",
      path: "src/b.ts",
      monacoLanguage: "typescript",
      model: createMockModel("export const b = 2;\n", 1, monaco.Uri.file("/repo/src/b.ts")),
    });

    await vi.waitFor(() => {
      expect(subscribe).toHaveBeenCalledTimes(1);
    });

    firstDetach();
    expect(unsubscribe).not.toHaveBeenCalled();

    secondDetach();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("does not reopen a document after it detaches before session startup completes", async () => {
    let resolveEnsureSession: ResolveEnsureSession | null = null;

    const ensureSession = new Promise<ReadyEnsureSessionResult>((resolve) => {
      resolveEnsureSession = resolve;
    });

    const sendCommand = vi.fn((op: string) => {
      if (op === "lsp.ensureSession") {
        return ensureSession;
      }

      return Promise.resolve(undefined);
    });

    const bridge = createLspBridge({
      sendCommand: sendCommand as BridgeSendCommand,
      subscribe: vi.fn(() => () => {}),
    });

    const detach = bridge.attachModel({
      workspaceId: "ws-1",
      workspaceRootPath: "/repo",
      path: "src/a.ts",
      monacoLanguage: "typescript",
      model: createMockModel("export const a = 1;\n", 1, monaco.Uri.file("/repo/src/a.ts")),
    });

    detach();

    await vi.waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("lsp.closeDocument", {
        workspaceId: "ws-1",
        path: "src/a.ts",
      });
    });

    if (resolveEnsureSession) {
      const resolveEnsureSessionFn: ResolveEnsureSession = resolveEnsureSession;
      resolveEnsureSessionFn({
        kind: "ready",
        displayName: "TypeScript language server",
        source: "bundled",
        summary: {
          workspaceId: "ws-1",
          serverKind: "typescript",
          status: "ready",
          capabilities: {
            definition: true,
            references: true,
            hover: true,
            documentSymbols: true,
            diagnostics: true,
          },
        },
      });
    }

    await Promise.resolve();
    await Promise.resolve();

    expect(sendCommand.mock.calls.filter(([op]) => op === "lsp.openDocument")).toHaveLength(0);
  });

  it("preloads the target Monaco model before returning cross-file definitions", async () => {
    const sendCommand = vi.fn(async (op: string, args?: { path?: string }) => {
      if (op === "lsp.ensureSession") {
        return {
          kind: "ready",
          displayName: "TypeScript language server",
          source: "bundled",
          summary: {
            workspaceId: "ws-1",
            serverKind: "typescript",
            status: "ready",
            capabilities: {
              definition: true,
              references: true,
              hover: true,
              documentSymbols: true,
              diagnostics: true,
            },
          },
        };
      }

      if (op === "lsp.definition") {
        return [
          {
            path: "src/shared.ts",
            range: {
              startLine: 1,
              startColumn: 14,
              endLine: 1,
              endColumn: 25,
            },
          },
        ];
      }

      if (op === "file.read" && args?.path === "src/shared.ts") {
        return {
          kind: "text",
          content: "export const sharedValue = 1;\n",
          baseHash: "hash-shared",
          encoding: "utf-8",
        };
      }

      return undefined;
    });

    const bridge = createLspBridge({
      sendCommand: sendCommand as BridgeSendCommand,
      subscribe: vi.fn(() => () => {}),
    });
    const model = createMockModel(
      'import { sharedValue } from "./shared";\nexport const computedValue = sharedValue + 1;\n',
      1,
      monaco.Uri.file("/repo/src/consumer.ts")
    );

    bridge.attachModel({
      workspaceId: "ws-1",
      workspaceRootPath: "/repo",
      path: "src/consumer.ts",
      monacoLanguage: "typescript",
      model,
    });

    const location = await bridge.provideDefinition(model, createMockPosition(1, 10));

    expect(sendCommand).toHaveBeenCalledWith("file.read", {
      workspaceId: "ws-1",
      path: "src/shared.ts",
    });
    expect(mockRegistryGetOrCreate).toHaveBeenCalledWith({
      workspaceRootPath: "/repo",
      path: "src/shared.ts",
      language: "typescript",
      content: "export const sharedValue = 1;\n",
    });
    expect(location).toEqual([
      expect.objectContaining({
        uri: expect.objectContaining({
          path: "/repo/src/shared.ts",
          scheme: "file",
        }),
      }),
    ]);
  });

  it("applies diagnostics against the latest workspace root path for a reused workspace subscription", async () => {
    const readySummary = {
      kind: "ready" as const,
      displayName: "TypeScript language server",
      source: "bundled" as const,
      summary: {
        workspaceId: "ws-1",
        serverKind: "typescript" as const,
        status: "ready" as const,
        capabilities: {
          definition: true,
          references: true,
          hover: true,
          documentSymbols: true,
          diagnostics: true,
        },
      },
    };

    let handler: BridgeEventHandler | null = null;
    const subscribe = vi.fn(
      (_topics: string[], nextHandler: (topic: string, payload: unknown) => void) => {
        handler = nextHandler;
        return () => {};
      }
    );

    const staleModel = createMockModel(
      "export const a = 1;\n",
      1,
      monaco.Uri.file("/repo/src/a.ts")
    );
    const currentModel = createMockModel(
      "export const a = 1;\n",
      1,
      monaco.Uri.file("/repo-next/src/a.ts")
    );

    vi.mocked(monaco.editor.getModel).mockImplementation((uri) => {
      if (uri.toString() === currentModel.uri.toString()) {
        return currentModel;
      }

      if (uri.toString() === staleModel.uri.toString()) {
        return staleModel;
      }

      return null;
    });

    const bridge = createLspBridge({
      sendCommand: vi.fn().mockResolvedValue(readySummary) as BridgeSendCommand,
      subscribe,
    });

    const detachFirst = bridge.attachModel({
      workspaceId: "ws-1",
      workspaceRootPath: "/repo",
      path: "src/a.ts",
      monacoLanguage: "typescript",
      model: staleModel,
    });
    const detachSecond = bridge.attachModel({
      workspaceId: "ws-1",
      workspaceRootPath: "/repo-next",
      path: "src/a.ts",
      monacoLanguage: "typescript",
      model: currentModel,
    });

    await vi.waitFor(() => {
      expect(subscribe).toHaveBeenCalledTimes(1);
    });

    if (handler) {
      const diagnosticsHandler: BridgeEventHandler = handler;
      diagnosticsHandler("workspace:ws-1:lsp-diagnostics", {
        workspaceId: "ws-1",
        serverKind: "typescript",
        path: "src/a.ts",
        version: 1,
        diagnostics: [
          {
            message: "boom",
            severity: "error",
            range: {
              startLine: 1,
              startColumn: 1,
              endLine: 1,
              endColumn: 5,
            },
          },
        ],
      });
    }

    expect(monaco.editor.setModelMarkers).toHaveBeenCalledTimes(1);
    expect(monaco.editor.setModelMarkers).toHaveBeenCalledWith(currentModel, "coder-studio-lsp", [
      expect.objectContaining({
        message: "boom",
      }),
    ]);

    detachFirst();
    detachSecond();
  });

  it("re-subscribes workspace diagnostics when the transport subscribe function changes", async () => {
    const readySummary = {
      kind: "ready" as const,
      displayName: "TypeScript language server",
      source: "bundled" as const,
      summary: {
        workspaceId: "ws-1",
        serverKind: "typescript" as const,
        status: "ready" as const,
        capabilities: {
          definition: true,
          references: true,
          hover: true,
          documentSymbols: true,
          diagnostics: true,
        },
      },
    };

    let nextHandler: BridgeEventHandler | null = null;
    const initialUnsubscribe = vi.fn();
    const initialSubscribe = vi.fn(
      (_topics: string[], handler: (topic: string, payload: unknown) => void) => {
        nextHandler = handler;
        return initialUnsubscribe;
      }
    );

    const replacementUnsubscribe = vi.fn();
    const replacementSubscribe = vi.fn(
      (_topics: string[], handler: (topic: string, payload: unknown) => void) => {
        nextHandler = handler;
        return replacementUnsubscribe;
      }
    );

    const model = createMockModel("export const a = 1;\n", 1, monaco.Uri.file("/repo/src/a.ts"));
    vi.mocked(monaco.editor.getModel).mockImplementation((uri) =>
      uri.toString() === model.uri.toString() ? model : null
    );

    const bridge = createLspBridge({
      sendCommand: vi.fn().mockResolvedValue(readySummary) as BridgeSendCommand,
      subscribe: initialSubscribe,
    });

    const detach = bridge.attachModel({
      workspaceId: "ws-1",
      workspaceRootPath: "/repo",
      path: "src/a.ts",
      monacoLanguage: "typescript",
      model,
    });

    await vi.waitFor(() => {
      expect(initialSubscribe).toHaveBeenCalledTimes(1);
    });

    bridge.configure({
      subscribe: replacementSubscribe,
    });

    expect(initialUnsubscribe).toHaveBeenCalledTimes(1);
    expect(replacementSubscribe).toHaveBeenCalledTimes(1);

    if (nextHandler) {
      const replacementHandler: BridgeEventHandler = nextHandler;
      replacementHandler("workspace:ws-1:lsp-diagnostics", {
        workspaceId: "ws-1",
        serverKind: "typescript",
        path: "src/a.ts",
        version: 1,
        diagnostics: [
          {
            message: "reconnected",
            severity: "error",
            range: {
              startLine: 1,
              startColumn: 1,
              endLine: 1,
              endColumn: 5,
            },
          },
        ],
      });
    }

    expect(monaco.editor.setModelMarkers).toHaveBeenCalledWith(model, "coder-studio-lsp", [
      expect.objectContaining({
        message: "reconnected",
      }),
    ]);

    detach();
    expect(replacementUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it("reports tool_missing, installs, polls, and auto-opens after install succeeds", async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "lsp.ensureSession") {
        if (sendCommand.mock.calls.filter(([name]) => name === "lsp.ensureSession").length === 1) {
          return {
            kind: "tool_missing",
            serverKind: "python",
            displayName: "Python language server",
            errorCode: "lsp_tool_missing",
            message: "Python language server is not installed",
            autoInstallSupported: true,
            missingCommands: ["pylsp"],
            missingPrerequisites: [],
          };
        }

        return {
          kind: "ready",
          displayName: "Python language server",
          source: "managed",
          summary: {
            workspaceId: "ws-1",
            serverKind: "python",
            status: "ready",
            capabilities: {
              definition: true,
              references: true,
              hover: true,
              documentSymbols: true,
              diagnostics: true,
            },
          },
        };
      }

      if (op === "lsp.install.start") {
        return {
          jobId: "job-1",
          serverKind: "python",
          status: "queued",
          currentStepId: "install-python-lsp",
          steps: [
            {
              id: "install-python-lsp",
              title: "Install python-lsp-server",
              kind: "install",
              status: "pending",
              command: "python3",
              args: ["-m", "pip", "install"],
            },
          ],
        };
      }

      if (op === "lsp.install.get") {
        return {
          jobId: "job-1",
          serverKind: "python",
          status: "succeeded",
          steps: [],
        };
      }

      return undefined;
    });

    const stateChanges: Array<unknown> = [];
    const bridge = createLspBridge({
      sendCommand: sendCommand as BridgeSendCommand,
      subscribe: vi.fn(() => () => {}),
    });

    const handle = bridge.attachModel(
      {
        workspaceId: "ws-1",
        workspaceRootPath: "/repo",
        path: "src/main.py",
        monacoLanguage: "python",
        model: createMockModel("print('hi')\n", 1, monaco.Uri.file("/repo/src/main.py")),
      },
      (state) => {
        stateChanges.push(state);
      }
    );

    await vi.waitFor(() => {
      expect(stateChanges[0]).toMatchObject({
        kind: "tool_missing",
        serverKind: "python",
      });
    });

    await handle.install();
    await vi.advanceTimersByTimeAsync(1500);

    await vi.waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("lsp.install.start", {
        workspaceId: "ws-1",
        serverKind: "python",
      });
      expect(sendCommand).toHaveBeenCalledWith("lsp.install.get", {
        jobId: "job-1",
        workspaceId: "ws-1",
      });
      expect(sendCommand).toHaveBeenCalledWith("lsp.openDocument", {
        workspaceId: "ws-1",
        path: "src/main.py",
        languageId: "python",
        text: "print('hi')\n",
      });
    });
  });
});
