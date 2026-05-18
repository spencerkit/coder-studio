import * as monaco from "monaco-editor";
import { describe, expect, it, vi } from "vitest";
import { createLspBridge } from "./bridge";

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
    registerHoverProvider: vi.fn(),
    registerReferenceProvider: vi.fn(),
    registerDocumentSymbolProvider: vi.fn(),
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
