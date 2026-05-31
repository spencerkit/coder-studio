import * as monaco from "monaco-editor";
import { describe, expect, it, vi } from "vitest";
import { createLspBridge } from "./bridge";
import { createLspProviderRegistry } from "./providers";

type BridgeSendCommand = NonNullable<
  NonNullable<Parameters<typeof createLspBridge>[0]>["sendCommand"]
>;

function createMockPosition(lineNumber: number, column: number): monaco.Position {
  return { lineNumber, column } as monaco.Position;
}

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
    registerDeclarationProvider: vi.fn(),
    registerTypeDefinitionProvider: vi.fn(),
    registerHoverProvider: vi.fn(),
    registerReferenceProvider: vi.fn(),
    registerDocumentSymbolProvider: vi.fn(),
    registerDocumentSemanticTokensProvider: vi.fn(),
    registerLinkProvider: vi.fn(),
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

describe("LSP providers", () => {
  it("registers Monaco providers for vue files on the vue language", () => {
    const bridge = createLspBridge({
      sendCommand: vi.fn() as BridgeSendCommand,
      subscribe: vi.fn(() => () => {}),
    });

    const registerDefinitionProvider = vi.mocked(monaco.languages.registerDefinitionProvider);

    bridge.attachModel({
      workspaceId: "ws-1",
      workspaceRootPath: "/repo",
      path: "src/App.vue",
      monacoLanguage: "vue",
      model: createMockModel(
        "<template><AppButton /></template>\n",
        1,
        monaco.Uri.file("/repo/src/App.vue")
      ),
    });

    expect(registerDefinitionProvider).toHaveBeenCalledWith(
      "vue",
      expect.objectContaining({
        provideDefinition: expect.any(Function),
      })
    );
  });

  it("registers a link provider that resolves relative import specifiers to workspace files", async () => {
    const registerLinkProvider = vi.mocked(monaco.languages.registerLinkProvider);
    const requestDefinition = vi.fn(async () => [
      {
        path: "src/shared.ts",
        range: {
          startLine: 1,
          startColumn: 14,
          endLine: 1,
          endColumn: 25,
        },
      },
    ]);

    const registry = createLspProviderRegistry({
      lookupModelMetadata: () => ({
        workspaceId: "ws-1",
        workspaceRootPath: "/repo",
        path: "src/consumer.ts",
      }),
      requestDefinition,
      requestDeclaration: async () => [],
      requestTypeDefinition: async () => [],
      requestHover: async () => null,
      requestReferences: async () => [],
      requestDocumentSymbols: async () => [],
      requestSemanticTokens: async () => null,
    });

    registry.register("typescript");

    expect(registerLinkProvider).toHaveBeenCalledWith(
      "typescript",
      expect.objectContaining({
        provideLinks: expect.any(Function),
        resolveLink: expect.any(Function),
      })
    );

    const provider =
      registerLinkProvider.mock.calls[registerLinkProvider.mock.calls.length - 1]![1];
    const model = createMockModel(
      'import { sharedValue } from "./shared";\nexport const computedValue = sharedValue + 1;\n',
      1,
      monaco.Uri.file("/repo/src/consumer.ts")
    );

    const linksList = await provider.provideLinks(model, {
      isCancellationRequested: false,
    } as never);
    expect(linksList?.links).toEqual([
      expect.objectContaining({
        range: {
          startLineNumber: 1,
          startColumn: 29,
          endLineNumber: 1,
          endColumn: 39,
        },
      }),
    ]);

    const resolvedLink = await provider.resolveLink?.(linksList!.links[0]!, {
      isCancellationRequested: false,
    } as never);
    expect(requestDefinition).toHaveBeenCalledWith({
      meta: {
        workspaceId: "ws-1",
        workspaceRootPath: "/repo",
        path: "src/consumer.ts",
      },
      line: 1,
      column: 32,
      version: 1,
    });
    expect(resolvedLink).toEqual(
      expect.objectContaining({
        url: expect.objectContaining({
          path: "/repo/src/shared.ts",
          scheme: "file",
        }),
      })
    );
  });

  it("registers semantic token providers and converts LSP token data for Monaco", async () => {
    const registerDocumentSemanticTokensProvider = vi.mocked(
      monaco.languages.registerDocumentSemanticTokensProvider
    );
    const requestSemanticTokens = vi.fn(async () => ({
      resultId: "semantic-1",
      data: [0, 13, 11, 8, 1],
    }));

    const registry = createLspProviderRegistry({
      lookupModelMetadata: () => ({
        workspaceId: "ws-1",
        workspaceRootPath: "/repo",
        path: "src/main.go",
      }),
      requestDefinition: async () => [],
      requestDeclaration: async () => [],
      requestTypeDefinition: async () => [],
      requestHover: async () => null,
      requestReferences: async () => [],
      requestDocumentSymbols: async () => [],
      requestSemanticTokens,
    });

    registry.register("go");

    expect(registerDocumentSemanticTokensProvider).toHaveBeenCalledWith(
      "go",
      expect.objectContaining({
        getLegend: expect.any(Function),
        provideDocumentSemanticTokens: expect.any(Function),
        releaseDocumentSemanticTokens: expect.any(Function),
      })
    );

    const provider =
      registerDocumentSemanticTokensProvider.mock.calls[
        registerDocumentSemanticTokensProvider.mock.calls.length - 1
      ]![1];
    const model = createMockModel(
      "package main\n\nfunc sharedValue() {}\n",
      1,
      monaco.Uri.file("/repo/src/main.go")
    );

    expect(provider.getLegend().tokenTypes).toContain("variable");

    const tokens = await provider.provideDocumentSemanticTokens(model, null, {
      isCancellationRequested: false,
    } as never);

    expect(requestSemanticTokens).toHaveBeenCalledWith({
      meta: {
        workspaceId: "ws-1",
        workspaceRootPath: "/repo",
        path: "src/main.go",
      },
      version: 1,
    });
    expect(tokens).toEqual({
      resultId: "semantic-1",
      data: new Uint32Array([0, 13, 11, 8, 1]),
    });
  });

  it("wires Monaco semantic token requests through the LSP bridge", async () => {
    const registerDocumentSemanticTokensProvider = vi.mocked(
      monaco.languages.registerDocumentSemanticTokensProvider
    );
    const sendCommand = vi.fn(async (op) => {
      if (op === "lsp.ensureSession") {
        return {
          kind: "ready",
          displayName: "Rust language server",
          source: "managed",
          summary: {
            workspaceId: "ws-1",
            serverKind: "rust",
            status: "ready",
            capabilities: {
              definition: true,
              references: true,
              hover: true,
              documentSymbols: true,
              semanticTokens: true,
              diagnostics: true,
            },
          },
        };
      }

      if (op === "lsp.semanticTokens") {
        return {
          resultId: "semantic-rust",
          data: [0, 7, 5, 8, 0],
        };
      }

      return null;
    }) as BridgeSendCommand;
    const bridge = createLspBridge({
      sendCommand,
      subscribe: vi.fn(() => () => {}),
    });
    const model = createMockModel("fn main() {}\n", 1, monaco.Uri.file("/repo/src/main.rs"));

    bridge.attachModel({
      workspaceId: "ws-1",
      workspaceRootPath: "/repo",
      path: "src/main.rs",
      monacoLanguage: "rust",
      model,
    });

    const provider =
      registerDocumentSemanticTokensProvider.mock.calls[
        registerDocumentSemanticTokensProvider.mock.calls.length - 1
      ]![1];
    const tokens = await provider.provideDocumentSemanticTokens(model, null, {
      isCancellationRequested: false,
    } as never);

    expect(sendCommand).toHaveBeenCalledWith("lsp.semanticTokens", {
      workspaceId: "ws-1",
      path: "src/main.rs",
    });
    expect(tokens).toEqual({
      resultId: "semantic-rust",
      data: new Uint32Array([0, 7, 5, 8, 0]),
    });
  });

  it("returns same-file definitions as Monaco locations", async () => {
    const bridge = createLspBridge({
      sendCommand: vi.fn(async (op) => {
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
              path: "e2e/fixtures/lsp-workspace/shared.ts",
              range: {
                startLine: 1,
                startColumn: 14,
                endLine: 1,
                endColumn: 25,
              },
            },
          ];
        }

        return undefined;
      }) as BridgeSendCommand,
      subscribe: vi.fn(() => () => {}),
    });

    const model = createMockModel("export const sharedValue = 1;\n");
    bridge.attachModel({
      workspaceId: "ws-1",
      workspaceRootPath: "/repo",
      path: "e2e/fixtures/lsp-workspace/shared.ts",
      monacoLanguage: "typescript",
      model,
    });

    const location = await bridge.provideDefinition(model, createMockPosition(1, 16));

    expect(location).toEqual([
      expect.objectContaining({
        uri: expect.objectContaining({
          path: "/repo/e2e/fixtures/lsp-workspace/shared.ts",
          scheme: "file",
        }),
      }),
    ]);
  });

  it("returns cross-file definitions as Monaco locations for other workspace files", async () => {
    const bridge = createLspBridge({
      sendCommand: vi.fn(async (op) => {
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
              path: "e2e/fixtures/lsp-workspace/shared.ts",
              range: {
                startLine: 1,
                startColumn: 14,
                endLine: 1,
                endColumn: 25,
              },
            },
          ];
        }

        return undefined;
      }) as BridgeSendCommand,
      subscribe: vi.fn(() => () => {}),
    });

    const model = createMockModel(
      'import { sharedValue } from "./shared";\nexport const computedValue = sharedValue + 1;\n',
      1,
      monaco.Uri.file("/repo/e2e/fixtures/lsp-workspace/consumer.ts")
    );

    bridge.attachModel({
      workspaceId: "ws-1",
      workspaceRootPath: "/repo",
      path: "e2e/fixtures/lsp-workspace/consumer.ts",
      monacoLanguage: "typescript",
      model,
    });

    const location = await bridge.provideDefinition(model, createMockPosition(1, 10));

    expect(location).toEqual([
      expect.objectContaining({
        uri: expect.objectContaining({
          path: "/repo/e2e/fixtures/lsp-workspace/shared.ts",
          scheme: "file",
        }),
      }),
    ]);
  });

  it("falls back to declaration and type definition when definition is empty", async () => {
    const sendCommand = vi.fn(async (op) => {
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
        return [];
      }

      if (op === "lsp.declaration") {
        return [];
      }

      if (op === "lsp.typeDefinition") {
        return [
          {
            path: "node_modules/.pnpm/jotai@2.8.4/node_modules/jotai/esm/index.d.mts",
            range: {
              startLine: 1,
              startColumn: 1,
              endLine: 1,
              endColumn: 10,
            },
          },
        ];
      }

      return undefined;
    }) as BridgeSendCommand;

    const bridge = createLspBridge({
      sendCommand,
      subscribe: vi.fn(() => () => {}),
    });

    const model = createMockModel(
      'import { atom } from "jotai";\nexport const value = atom(1);\n',
      1,
      monaco.Uri.file("/repo/src/store.ts")
    );

    bridge.attachModel({
      workspaceId: "ws-1",
      workspaceRootPath: "/repo",
      path: "src/store.ts",
      monacoLanguage: "typescript",
      model,
    });

    const location = await bridge.provideDefinition(model, createMockPosition(1, 11));

    expect(sendCommand).toHaveBeenCalledWith("lsp.definition", {
      workspaceId: "ws-1",
      path: "src/store.ts",
      line: 1,
      column: 11,
    });
    expect(sendCommand).toHaveBeenCalledWith("lsp.declaration", {
      workspaceId: "ws-1",
      path: "src/store.ts",
      line: 1,
      column: 11,
    });
    expect(sendCommand).toHaveBeenCalledWith("lsp.typeDefinition", {
      workspaceId: "ws-1",
      path: "src/store.ts",
      line: 1,
      column: 11,
    });
    expect(location).toEqual([
      expect.objectContaining({
        uri: expect.objectContaining({
          path: "/repo/node_modules/.pnpm/jotai@2.8.4/node_modules/jotai/esm/index.d.mts",
          scheme: "file",
        }),
      }),
    ]);
  });

  it("converts hover, references, and document symbols into Monaco payloads", async () => {
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

    const bridge = createLspBridge({
      sendCommand: vi.fn(async (op) => {
        if (op === "lsp.ensureSession") {
          return readySummary;
        }

        if (op === "lsp.hover") {
          return {
            contents: ["```ts\nconst sharedValue: number\n```"],
            range: {
              startLine: 1,
              startColumn: 14,
              endLine: 1,
              endColumn: 25,
            },
            version: 1,
          };
        }

        if (op === "lsp.references") {
          return [
            {
              path: "e2e/fixtures/lsp-workspace/shared.ts",
              range: {
                startLine: 1,
                startColumn: 14,
                endLine: 1,
                endColumn: 25,
              },
            },
            {
              path: "e2e/fixtures/lsp-workspace/consumer.ts",
              range: {
                startLine: 2,
                startColumn: 30,
                endLine: 2,
                endColumn: 41,
              },
            },
          ];
        }

        if (op === "lsp.documentSymbols") {
          return [
            {
              name: "sharedValue",
              kind: 13,
              range: {
                startLine: 1,
                startColumn: 1,
                endLine: 1,
                endColumn: 29,
              },
              selectionRange: {
                startLine: 1,
                startColumn: 14,
                endLine: 1,
                endColumn: 25,
              },
            },
          ];
        }

        return null;
      }) as BridgeSendCommand,
      subscribe: vi.fn(() => () => {}),
    });

    const model = createMockModel("export const sharedValue = 1;\n");
    bridge.attachModel({
      workspaceId: "ws-1",
      workspaceRootPath: "/repo",
      path: "e2e/fixtures/lsp-workspace/shared.ts",
      monacoLanguage: "typescript",
      model,
    });

    await expect(bridge.provideHover(model, createMockPosition(1, 16))).resolves.toEqual(
      expect.objectContaining({
        contents: [{ value: "```ts\nconst sharedValue: number\n```" }],
      })
    );

    await expect(bridge.provideReferences(model, createMockPosition(1, 16))).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          uri: expect.objectContaining({
            path: "/repo/e2e/fixtures/lsp-workspace/consumer.ts",
            scheme: "file",
          }),
        }),
      ])
    );

    await expect(bridge.provideDocumentSymbols(model)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "sharedValue" })])
    );
  });

  it("drops stale hover results after the model version advances", async () => {
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

    const sendCommand = vi.fn(async (op: string) => {
      if (op === "lsp.ensureSession") {
        return readySummary;
      }

      if (op === "lsp.hover") {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {
          contents: ["```ts\nconst sharedValue: number\n```"],
          version: 1,
        };
      }

      return null;
    });

    const bridge = createLspBridge({
      sendCommand: sendCommand as BridgeSendCommand,
      subscribe: vi.fn(() => () => {}),
    });
    const model = createMockModel("export const sharedValue = 1;\n", 1);
    bridge.attachModel({
      workspaceId: "ws-1",
      workspaceRootPath: "/repo",
      path: "e2e/fixtures/lsp-workspace/shared.ts",
      monacoLanguage: "typescript",
      model,
    });

    const hoverPromise = bridge.provideHover(model, createMockPosition(1, 16));
    model.fireDidChangeContent("export const sharedValue = 2;\n", 2);

    await expect(hoverPromise).resolves.toBeNull();
  });
});
