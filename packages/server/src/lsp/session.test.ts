import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { LspSession } from "./session.js";

describe.sequential("LspSession", () => {
  it("coalesces concurrent start calls until initialization completes", async () => {
    const session = new LspSession({
      workspaceId: "ws-1",
      workspacePath: process.cwd(),
      spec: {
        serverKind: "typescript",
        command: "node",
        args: [join(process.cwd(), "src/__tests__/fixtures/fake-lsp-server.js")],
        rootPath: process.cwd(),
      },
      onDiagnostics: vi.fn(),
      requestTimeoutMs: 2000,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });

    const [first, second] = await Promise.all([session.start(), session.start()]);

    expect(first.status).toBe("ready");
    expect(second.status).toBe("ready");
    expect(second.capabilities.definition).toBe(true);

    await session.stop();
  });

  it("initializes, syncs a document, serves read-only queries, and forwards diagnostics", async () => {
    const diagnostics = vi.fn();
    const session = new LspSession({
      workspaceId: "ws-1",
      workspacePath: process.cwd(),
      spec: {
        serverKind: "typescript",
        command: "node",
        args: [join(process.cwd(), "src/__tests__/fixtures/fake-lsp-server.js")],
        rootPath: process.cwd(),
      },
      onDiagnostics: diagnostics,
      requestTimeoutMs: 2000,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });

    await session.start();
    await session.openDocument({
      path: "e2e/fixtures/lsp-workspace/broken.ts",
      languageId: "typescript",
      text: "export const broken = missingSymbol;\n",
    });

    await session.openDocument({
      path: "e2e/fixtures/lsp-workspace/shared.ts",
      languageId: "typescript",
      text: "export const sharedValue = 1;\n",
    });

    await session.openDocument({
      path: "e2e/fixtures/lsp-workspace/consumer.ts",
      languageId: "typescript",
      text: 'import { sharedValue } from "./shared";\nexport const computedValue = sharedValue + 1;\n',
    });

    const definition = await session.definition({
      path: "e2e/fixtures/lsp-workspace/consumer.ts",
      line: 1,
      column: 12,
    });

    expect(definition?.[0]?.path).toBe("e2e/fixtures/lsp-workspace/shared.ts");

    const hover = await session.hover({
      path: "e2e/fixtures/lsp-workspace/shared.ts",
      line: 1,
      column: 16,
    });

    expect(hover?.contents[0]).toContain("sharedValue");

    const references = await session.references({
      path: "e2e/fixtures/lsp-workspace/shared.ts",
      line: 1,
      column: 16,
    });

    expect(references).toHaveLength(2);

    const symbols = await session.documentSymbols({
      path: "e2e/fixtures/lsp-workspace/shared.ts",
    });

    expect(symbols?.[0]?.name).toBe("sharedValue");

    expect(diagnostics).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        path: "e2e/fixtures/lsp-workspace/broken.ts",
      })
    );

    await session.stop();
  });

  it("normalizes single-location, location-link, and symbol-information responses", async () => {
    const session = new LspSession({
      workspaceId: "ws-1",
      workspacePath: process.cwd(),
      spec: {
        serverKind: "typescript",
        command: "node",
        args: [join(process.cwd(), "src/__tests__/fixtures/fake-lsp-server.js")],
        rootPath: process.cwd(),
      },
      onDiagnostics: vi.fn(),
      requestTimeoutMs: 2000,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });

    await session.openDocument({
      path: "e2e/fixtures/lsp-workspace/shared.ts",
      languageId: "typescript",
      text: "export const sharedValue = 1;\n",
    });
    await session.openDocument({
      path: "e2e/fixtures/lsp-workspace/single.ts",
      languageId: "typescript",
      text: 'import { sharedValue } from "./shared";\nexport const singleValue = sharedValue;\n',
    });
    await session.openDocument({
      path: "e2e/fixtures/lsp-workspace/linked.ts",
      languageId: "typescript",
      text: 'import { sharedValue } from "./shared";\nexport const linkedValue = sharedValue;\n',
    });
    await session.openDocument({
      path: "e2e/fixtures/lsp-workspace/symbols-flat.ts",
      languageId: "typescript",
      text: "export const flatSymbol = 1;\n",
    });

    const singleDefinition = await session.definition({
      path: "e2e/fixtures/lsp-workspace/single.ts",
      line: 1,
      column: 12,
    });
    const linkedDefinition = await session.definition({
      path: "e2e/fixtures/lsp-workspace/linked.ts",
      line: 1,
      column: 12,
    });
    const flatSymbols = await session.documentSymbols({
      path: "e2e/fixtures/lsp-workspace/symbols-flat.ts",
    });

    expect(singleDefinition).toEqual([
      expect.objectContaining({
        path: "e2e/fixtures/lsp-workspace/shared.ts",
      }),
    ]);
    expect(linkedDefinition).toEqual([
      expect.objectContaining({
        path: "e2e/fixtures/lsp-workspace/shared.ts",
        range: expect.objectContaining({
          startLine: 1,
          startColumn: 14,
          endLine: 1,
          endColumn: 25,
        }),
      }),
    ]);
    expect(flatSymbols).toEqual([
      expect.objectContaining({
        name: "flatSymbol",
        range: expect.objectContaining({
          startLine: 1,
          startColumn: 14,
          endLine: 1,
          endColumn: 24,
        }),
        selectionRange: expect.objectContaining({
          startLine: 1,
          startColumn: 14,
          endLine: 1,
          endColumn: 24,
        }),
      }),
    ]);

    await session.stop();
  });

  it("serves declaration and type definition location queries", async () => {
    const session = new LspSession({
      workspaceId: "ws-1",
      workspacePath: process.cwd(),
      spec: {
        serverKind: "typescript",
        command: "node",
        args: [join(process.cwd(), "src/__tests__/fixtures/fake-lsp-server.js")],
        rootPath: process.cwd(),
      },
      onDiagnostics: vi.fn(),
      requestTimeoutMs: 2000,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });

    await session.openDocument({
      path: "e2e/fixtures/lsp-workspace/shared.ts",
      languageId: "typescript",
      text: "export const sharedValue = 1;\n",
    });
    await session.openDocument({
      path: "e2e/fixtures/lsp-workspace/declaration.ts",
      languageId: "typescript",
      text: 'import { sharedValue } from "./shared";\nexport const declared = sharedValue;\n',
    });
    await session.openDocument({
      path: "e2e/fixtures/lsp-workspace/type-target.ts",
      languageId: "typescript",
      text: "type SharedValue = ExampleType;\n",
    });

    const declaration = await session.declaration({
      path: "e2e/fixtures/lsp-workspace/declaration.ts",
      line: 1,
      column: 12,
    });
    const typeDefinition = await session.typeDefinition({
      path: "e2e/fixtures/lsp-workspace/type-target.ts",
      line: 1,
      column: 20,
    });

    expect(declaration).toEqual([
      expect.objectContaining({
        path: "e2e/fixtures/lsp-workspace/shared.ts",
        range: expect.objectContaining({
          startLine: 1,
          startColumn: 14,
          endLine: 1,
          endColumn: 25,
        }),
      }),
    ]);
    expect(typeDefinition).toEqual([
      expect.objectContaining({
        path: "e2e/fixtures/lsp-workspace/types.d.ts",
        range: expect.objectContaining({
          startLine: 1,
          startColumn: 13,
          endLine: 1,
          endColumn: 22,
        }),
      }),
    ]);

    await session.stop();
  });

  it("restarts after child exit and replays open documents", async () => {
    const previous = process.env.CODER_STUDIO_FAKE_LSP_EXIT_AFTER_INIT_MS;
    process.env.CODER_STUDIO_FAKE_LSP_EXIT_AFTER_INIT_MS = "150";

    try {
      const session = new LspSession({
        workspaceId: "ws-1",
        workspacePath: process.cwd(),
        spec: {
          serverKind: "typescript",
          command: "node",
          args: [join(process.cwd(), "src/__tests__/fixtures/fake-lsp-server.js")],
          rootPath: process.cwd(),
        },
        onDiagnostics: vi.fn(),
        requestTimeoutMs: 1000,
        logger: {
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        },
      });

      await session.openDocument({
        path: "e2e/fixtures/lsp-workspace/shared.ts",
        languageId: "typescript",
        text: "export const sharedValue = 1;\n",
      });
      await session.openDocument({
        path: "e2e/fixtures/lsp-workspace/consumer.ts",
        languageId: "typescript",
        text: 'import { sharedValue } from "./shared";\nexport const computedValue = sharedValue + 1;\n',
      });

      await new Promise((resolve) => setTimeout(resolve, 250));

      expect(session.getSummary().status).toBe("stopped");

      const definition = await session.definition({
        path: "e2e/fixtures/lsp-workspace/consumer.ts",
        line: 1,
        column: 12,
      });

      expect(definition?.[0]?.path).toBe("e2e/fixtures/lsp-workspace/shared.ts");

      await session.stop();
    } finally {
      if (previous === undefined) {
        delete process.env.CODER_STUDIO_FAKE_LSP_EXIT_AFTER_INIT_MS;
      } else {
        process.env.CODER_STUDIO_FAKE_LSP_EXIT_AFTER_INIT_MS = previous;
      }
    }
  });

  it("times out one request without poisoning the whole session", async () => {
    const previous = process.env.CODER_STUDIO_FAKE_LSP_HOVER_DELAY_MS;
    process.env.CODER_STUDIO_FAKE_LSP_HOVER_DELAY_MS = "1000";

    try {
      const session = new LspSession({
        workspaceId: "ws-1",
        workspacePath: process.cwd(),
        spec: {
          serverKind: "typescript",
          command: "node",
          args: [join(process.cwd(), "src/__tests__/fixtures/fake-lsp-server.js")],
          rootPath: process.cwd(),
        },
        onDiagnostics: vi.fn(),
        requestTimeoutMs: 300,
        logger: {
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        },
      });

      await session.start();
      await session.openDocument({
        path: "e2e/fixtures/lsp-workspace/shared.ts",
        languageId: "typescript",
        text: "export const sharedValue = 1;\n",
      });
      await session.openDocument({
        path: "e2e/fixtures/lsp-workspace/consumer.ts",
        languageId: "typescript",
        text: 'import { sharedValue } from "./shared";\nexport const computedValue = sharedValue + 1;\n',
      });

      await expect(
        session.hover({
          path: "e2e/fixtures/lsp-workspace/shared.ts",
          line: 1,
          column: 16,
        })
      ).resolves.toBeNull();

      await expect(
        session.definition({
          path: "e2e/fixtures/lsp-workspace/consumer.ts",
          line: 1,
          column: 12,
        })
      ).resolves.toEqual(expect.any(Array));

      await session.stop();
    } finally {
      if (previous === undefined) {
        delete process.env.CODER_STUDIO_FAKE_LSP_HOVER_DELAY_MS;
      } else {
        process.env.CODER_STUDIO_FAKE_LSP_HOVER_DELAY_MS = previous;
      }
    }
  });
});
