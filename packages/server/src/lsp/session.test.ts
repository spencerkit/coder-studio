import { join } from "node:path";
import { LSP_SEMANTIC_TOKEN_MODIFIERS, LSP_SEMANTIC_TOKEN_TYPES } from "@coder-studio/core";
import { describe, expect, it, vi } from "vitest";
import { LspSession } from "./session.js";

const FAKE_LSP = join(process.cwd(), "src/__tests__/fixtures/fake-lsp-server.js");

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

    const summary = await session.start();
    expect(summary.capabilities.semanticTokens).toBe(true);
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

    const semanticTokens = await session.semanticTokens({
      path: "e2e/fixtures/lsp-workspace/shared.ts",
    });

    expect(semanticTokens).toEqual({
      resultId: "semantic-1",
      data: [
        0,
        13,
        11,
        LSP_SEMANTIC_TOKEN_TYPES.indexOf("variable"),
        1 << LSP_SEMANTIC_TOKEN_MODIFIERS.indexOf("declaration"),
      ],
    });

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

  it("fans hover requests out to the companion and merges contents from both ends", async () => {
    // Two fake-lsp processes: primary returns one hover string, companion
    // returns another. The session should merge both into one hover payload
    // so users see Vue-specific *and* TS-semantic information together.
    const session = new LspSession({
      workspaceId: "ws-1",
      workspacePath: process.cwd(),
      spec: {
        serverKind: "vue",
        command: "node",
        args: [FAKE_LSP],
        rootPath: process.cwd(),
        companion: {
          command: "node",
          args: [FAKE_LSP],
        },
        bridges: { tsserverRequest: true },
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
      languageId: "vue",
      text: "export const sharedValue = 1;\n",
    });

    const hover = await session.hover({
      path: "e2e/fixtures/lsp-workspace/shared.ts",
      line: 1,
      column: 16,
    });

    expect(hover?.contents).toEqual([
      // Same content twice because both legs return the same fake hover.
      // The merge step preserves both entries — proof that the companion
      // result was actually consulted.
      expect.stringContaining("sharedValue"),
      expect.stringContaining("sharedValue"),
    ]);

    await session.stop();
  });

  it("fans definition requests out to the companion and deduplicates merged locations", async () => {
    const session = new LspSession({
      workspaceId: "ws-1",
      workspacePath: process.cwd(),
      spec: {
        serverKind: "vue",
        command: "node",
        args: [FAKE_LSP],
        rootPath: process.cwd(),
        companion: {
          command: "node",
          args: [FAKE_LSP],
        },
        bridges: { tsserverRequest: true },
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
      languageId: "vue",
      text: "export const sharedValue = 1;\n",
    });
    await session.openDocument({
      path: "e2e/fixtures/lsp-workspace/consumer.ts",
      languageId: "vue",
      text: 'import { sharedValue } from "./shared";\nexport const computedValue = sharedValue + 1;\n',
    });

    const definition = await session.definition({
      path: "e2e/fixtures/lsp-workspace/consumer.ts",
      line: 1,
      column: 12,
    });

    // Both fake servers return the same single location; merge+dedupe yields one.
    expect(definition).toHaveLength(1);
    expect(definition?.[0]?.path).toBe("e2e/fixtures/lsp-workspace/shared.ts");

    await session.stop();
  });

  it("kills the companion process when the primary exits", async () => {
    // If Volar crashes we must not leave the TypeScript companion alive
    // (otherwise idle-TTL cleanup leaks a process per session).
    const session = new LspSession({
      workspaceId: "ws-1",
      workspacePath: process.cwd(),
      spec: {
        serverKind: "vue",
        // Primary exits 150ms after initialize.
        command: "node",
        args: [FAKE_LSP, "--exit-after-init-ms=150"],
        rootPath: process.cwd(),
        companion: {
          // Companion stays alive normally.
          command: "node",
          args: [FAKE_LSP],
        },
        bridges: { tsserverRequest: true },
      },
      onDiagnostics: vi.fn(),
      requestTimeoutMs: 2000,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });

    // Pull the companion field via a typed accessor for inspection.
    type WithCompanion = LspSession & {
      companion: null | { child: { killed: boolean } };
    };

    await session.start();
    // Companion was spawned alongside primary.
    expect((session as WithCompanion).companion).not.toBeNull();
    const companionChild = (session as WithCompanion).companion?.child;
    expect(companionChild).toBeDefined();

    // Wait long enough for the primary to exit and the termination handler
    // to fire.
    await vi.waitFor(
      () => {
        expect((session as WithCompanion).companion).toBeNull();
      },
      { timeout: 2000 }
    );
    // The companion's process should have received SIGTERM.
    expect(companionChild?.killed).toBe(true);
    expect(session.getSummary().status).toBe("stopped");

    await session.stop();
  });

  it("stops the companion when the session is explicitly stopped", async () => {
    const session = new LspSession({
      workspaceId: "ws-1",
      workspacePath: process.cwd(),
      spec: {
        serverKind: "vue",
        command: "node",
        args: [FAKE_LSP],
        rootPath: process.cwd(),
        companion: {
          command: "node",
          args: [FAKE_LSP],
        },
        bridges: { tsserverRequest: true },
      },
      onDiagnostics: vi.fn(),
      requestTimeoutMs: 2000,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });

    type WithCompanion = LspSession & {
      companion: null | { child: { killed: boolean } };
    };

    await session.start();
    const companionChild = (session as WithCompanion).companion?.child;
    expect(companionChild).toBeDefined();

    await session.stop();
    expect(companionChild?.killed).toBe(true);
    expect((session as WithCompanion).companion).toBeNull();
  });

  it("uses initializeTimeoutMs (not requestTimeoutMs) for the LSP initialize handshake", async () => {
    // Regression test: rust-analyzer's `initialize` routinely takes 10-30s in
    // real projects, but per-request semantic queries should still fail fast.
    // The session must wait the longer ceiling for initialize and the short
    // one for hover/definition. Here we simulate a 350ms initialize and a
    // 1000ms hover; with a request timeout of 200ms the initialize must
    // still succeed and the hover must still time out.
    const previousInit = process.env.CODER_STUDIO_FAKE_LSP_INIT_DELAY_MS;
    const previousHover = process.env.CODER_STUDIO_FAKE_LSP_HOVER_DELAY_MS;
    process.env.CODER_STUDIO_FAKE_LSP_INIT_DELAY_MS = "350";
    process.env.CODER_STUDIO_FAKE_LSP_HOVER_DELAY_MS = "1000";

    try {
      const session = new LspSession({
        workspaceId: "ws-1",
        workspacePath: process.cwd(),
        spec: {
          serverKind: "rust",
          command: "node",
          args: [FAKE_LSP],
          rootPath: process.cwd(),
        },
        onDiagnostics: vi.fn(),
        requestTimeoutMs: 200,
        initializeTimeoutMs: 5_000,
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      });

      // Initialize takes 350ms but the longer timeout allows it.
      await expect(session.start()).resolves.toMatchObject({ status: "ready" });

      await session.openDocument({
        path: "e2e/fixtures/lsp-workspace/shared.ts",
        languageId: "rust",
        text: "export const sharedValue = 1;\n",
      });

      // Hover takes 1000ms which exceeds requestTimeoutMs of 200ms — must
      // still time out and recover so the next query can succeed.
      await expect(
        session.hover({
          path: "e2e/fixtures/lsp-workspace/shared.ts",
          line: 1,
          column: 16,
        })
      ).resolves.toBeNull();

      await session.stop();
    } finally {
      if (previousInit === undefined) {
        delete process.env.CODER_STUDIO_FAKE_LSP_INIT_DELAY_MS;
      } else {
        process.env.CODER_STUDIO_FAKE_LSP_INIT_DELAY_MS = previousInit;
      }
      if (previousHover === undefined) {
        delete process.env.CODER_STUDIO_FAKE_LSP_HOVER_DELAY_MS;
      } else {
        process.env.CODER_STUDIO_FAKE_LSP_HOVER_DELAY_MS = previousHover;
      }
    }
  });

  it("falls back to requestTimeoutMs * 10 for initialize when initializeTimeoutMs is omitted", async () => {
    const previousInit = process.env.CODER_STUDIO_FAKE_LSP_INIT_DELAY_MS;
    // 350ms init delay must succeed when requestTimeoutMs is 100 (so the
    // implicit init budget is 1000ms).
    process.env.CODER_STUDIO_FAKE_LSP_INIT_DELAY_MS = "350";

    try {
      const session = new LspSession({
        workspaceId: "ws-1",
        workspacePath: process.cwd(),
        spec: {
          serverKind: "rust",
          command: "node",
          args: [FAKE_LSP],
          rootPath: process.cwd(),
        },
        onDiagnostics: vi.fn(),
        requestTimeoutMs: 100,
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      });

      await expect(session.start()).resolves.toMatchObject({ status: "ready" });
      await session.stop();
    } finally {
      if (previousInit === undefined) {
        delete process.env.CODER_STUDIO_FAKE_LSP_INIT_DELAY_MS;
      } else {
        process.env.CODER_STUDIO_FAKE_LSP_INIT_DELAY_MS = previousInit;
      }
    }
  });

  it("drains child stderr output without breaking startup", async () => {
    const previous = process.env.CODER_STUDIO_FAKE_LSP_STDERR_ON_INIT;
    process.env.CODER_STUDIO_FAKE_LSP_STDERR_ON_INIT = "server boot log";

    try {
      const logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
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
        logger,
      });

      await expect(session.start()).resolves.toMatchObject({ status: "ready" });
      await vi.waitFor(() => {
        expect(logger.warn).toHaveBeenCalled();
      });

      await session.stop();
    } finally {
      if (previous === undefined) {
        delete process.env.CODER_STUDIO_FAKE_LSP_STDERR_ON_INIT;
      } else {
        process.env.CODER_STUDIO_FAKE_LSP_STDERR_ON_INIT = previous;
      }
    }
  });
});
