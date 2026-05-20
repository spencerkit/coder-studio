# Multi-Language LSP Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a generic, server-managed LSP foundation for the Monaco editor that supports definition, references, hover, diagnostics, and document symbols across multiple languages without breaking ordinary file editing.

**Architecture:** Keep all language-server process lifecycle and JSON-RPC protocol state on the server in a new `packages/server/src/lsp/*` subsystem. Keep the web side thin: a Monaco bridge attaches to workspace-backed text models, forwards `open/change/close` plus read-only requests through existing websocket commands, reuses the current `openLocation` landing path for cross-file navigation, and applies diagnostics as Monaco markers.

**Tech Stack:** TypeScript, Monaco Editor, React, Jotai, websocket command transport, `vscode-jsonrpc`, `vscode-languageserver-protocol`, Vitest, Playwright

---

## File Structure

- Create: `packages/core/src/domain/lsp.ts`
  - Shared editor-facing LSP DTOs used by both server and web layers.
- Modify: `packages/core/src/domain/events.ts`
  - Add the diagnostics event shape used for websocket fanout.
- Modify: `packages/core/src/protocol/topics.ts`
  - Add `workspaceLspDiagnostics(workspaceId)` topic helper.
- Modify: `packages/core/src/index.ts`
  - Re-export shared LSP DTOs.
- Create: `packages/core/src/domain/lsp.test.ts`
  - Assert the shared topic and DTO surface.

- Modify: `packages/server/package.json`
  - Add `vscode-jsonrpc` and `vscode-languageserver-protocol`.
- Create: `packages/server/src/lsp/server-factory.ts`
  - Language-family to server process mapping plus env override support for tests/e2e.
- Create: `packages/server/src/lsp/server-factory.test.ts`
  - Cover extension mapping, env overrides, and WSL wrapping.
- Create: `packages/server/src/__tests__/fixtures/fake-lsp-server.js`
  - Deterministic stdio JSON-RPC test server for unit/e2e coverage.

- Create: `packages/server/src/lsp/document-store.ts`
  - Track open documents, versions, URIs, and replayable snapshots.
- Create: `packages/server/src/lsp/document-store.test.ts`
  - Cover open/change/close/version/replay behavior.
- Create: `packages/server/src/lsp/session.ts`
  - Own one live LSP connection, initialize, requests, diagnostics intake, and restart replay hooks.
- Create: `packages/server/src/lsp/session.test.ts`
  - Cover initialize, definition/hover/references/symbols, diagnostics forwarding, and timeout isolation.
- Create: `packages/server/src/lsp/manager.ts`
  - Reuse one session per `workspaceId + serverKind`, idle reap, restart, and workspace teardown.
- Create: `packages/server/src/lsp/manager.test.ts`
  - Cover reuse, idle reap, restart replay, and unsupported-language no-op behavior.

- Create: `packages/server/src/commands/lsp.ts`
  - Register `lsp.ensureSession`, `lsp.openDocument`, `lsp.changeDocument`, `lsp.closeDocument`, `lsp.definition`, `lsp.references`, `lsp.hover`, `lsp.documentSymbols`.
- Create: `packages/server/src/__tests__/lsp-commands.test.ts`
  - Command-level coverage for the new websocket API.
- Modify: `packages/server/src/commands/index.ts`
  - Import the new LSP command module.
- Modify: `packages/server/src/ws/dispatch.ts`
  - Extend `CommandContext` with `lspMgr`.
- Modify: `packages/server/src/ws/hub.ts`
  - Broadcast `lsp.diagnostics.updated` domain events on the new topic.
- Modify: `packages/server/src/server.ts`
  - Instantiate and inject `LspManager`, add teardown hooks, and dispose it on shutdown.

- Create: `packages/web/src/features/code-editor/lsp/language-map.ts`
  - Map file path + Monaco language to supported LSP server kinds.
- Create: `packages/web/src/features/code-editor/lsp/providers.ts`
  - Register Monaco providers for definition, references, hover, and document symbols.
- Create: `packages/web/src/features/code-editor/lsp/diagnostics.ts`
  - Convert shared diagnostics into Monaco markers and clear them safely.
- Create: `packages/web/src/features/code-editor/lsp/bridge.ts`
  - Attach/detach workspace-backed Monaco models, ensure sessions, debounce change sync, and manage diagnostics subscriptions.
- Create: `packages/web/src/features/code-editor/lsp/bridge.test.tsx`
  - Cover ensure/open/change/close, unsupported-language no-op, and subscription reference counting.
- Create: `packages/web/src/features/code-editor/lsp/providers.test.ts`
  - Cover same-file definition, cross-file definition, hover, references, symbols, and stale-result discard.
- Create: `packages/web/src/features/code-editor/lsp/diagnostics.test.ts`
  - Cover marker set/replace/clear behavior.
- Modify: `packages/web/src/features/code-editor/components/monaco-host.tsx`
  - Attach the bridge to workspace-backed text models and keep existing `openLocation` behavior.
- Modify: `packages/web/src/features/code-editor/components/monaco-host.test.tsx`
  - Verify host-level LSP bridge integration.

- Create: `e2e/specs/workspace/lsp-editor.spec.ts`
  - Acceptance coverage for definition, hover, references, and diagnostics.
- Create: `e2e/fixtures/lsp-workspace/shared.ts`
  - Shared symbol definition fixture used by fake LSP responses.
- Create: `e2e/fixtures/lsp-workspace/consumer.ts`
  - Cross-file reference/definition fixture.
- Create: `e2e/fixtures/lsp-workspace/broken.ts`
  - Diagnostics fixture.
- Modify: `e2e/playwright.config.ts`
  - Point the TypeScript-family LSP command override at the fake server fixture during Playwright runs.

## Task 1: Add Shared LSP DTOs And Diagnostics Topic

**Files:**
- Create: `packages/core/src/domain/lsp.ts`
- Create: `packages/core/src/domain/lsp.test.ts`
- Modify: `packages/core/src/domain/events.ts`
- Modify: `packages/core/src/protocol/topics.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing core test for the shared diagnostics topic and DTO surface**

```ts
import { describe, expect, expectTypeOf, it } from "vitest";
import { Topics } from "../protocol/topics";
import type {
  LspDiagnostic,
  LspDiagnosticsEvent,
  LspDocumentSymbol,
  LspLocation,
  LspSessionSummary,
} from "./lsp";

describe("LSP shared surface", () => {
  it("builds the workspace diagnostics topic", () => {
    expect(Topics.workspaceLspDiagnostics("ws-1")).toBe("workspace.ws-1.lsp.diagnostics");
  });

  it("keeps the editor-facing range and payload shapes stable", () => {
    expectTypeOf<LspLocation>().toMatchTypeOf<{
      path: string;
      range: {
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
      };
    }>();

    expectTypeOf<LspDiagnostic>().toMatchTypeOf<{
      message: string;
      severity: "error" | "warning" | "info" | "hint";
      range: {
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
      };
    }>();

    expectTypeOf<LspDocumentSymbol>().toMatchTypeOf<{
      name: string;
      kind: number;
      range: unknown;
      selectionRange: unknown;
      children?: unknown[];
    }>();

    expectTypeOf<LspDiagnosticsEvent>().toMatchTypeOf<{
      workspaceId: string;
      serverKind: string;
      path: string;
      diagnostics: LspDiagnostic[];
    }>();

    expectTypeOf<LspSessionSummary>().toMatchTypeOf<{
      workspaceId: string;
      serverKind: string;
      status: "unsupported" | "starting" | "ready" | "degraded" | "stopped";
      capabilities: {
        definition: boolean;
        references: boolean;
        hover: boolean;
        documentSymbols: boolean;
        diagnostics: boolean;
      };
    }>();
  });
});
```

- [ ] **Step 2: Run the core test to verify it fails**

Run: `pnpm exec vitest run packages/core/src/domain/lsp.test.ts`

Expected: FAIL because `domain/lsp.ts` and `Topics.workspaceLspDiagnostics` do not exist yet

- [ ] **Step 3: Add the shared LSP DTOs, diagnostics event, and topic helper**

```ts
// packages/core/src/domain/lsp.ts
export type LspServerKind = "typescript" | "python" | "go" | "rust";

export interface LspRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface LspLocation {
  path: string;
  range: LspRange;
}

export interface LspDiagnostic {
  message: string;
  severity: "error" | "warning" | "info" | "hint";
  code?: string;
  source?: string;
  range: LspRange;
}

export interface LspHoverResult {
  contents: string[];
  range?: LspRange;
  version?: number;
}

export interface LspDocumentSymbol {
  name: string;
  kind: number;
  range: LspRange;
  selectionRange: LspRange;
  children?: LspDocumentSymbol[];
}

export interface LspSessionSummary {
  workspaceId: string;
  serverKind: LspServerKind;
  status: "unsupported" | "starting" | "ready" | "degraded" | "stopped";
  capabilities: {
    definition: boolean;
    references: boolean;
    hover: boolean;
    documentSymbols: boolean;
    diagnostics: boolean;
  };
}

export interface LspDiagnosticsEvent {
  workspaceId: string;
  serverKind: LspServerKind;
  path: string;
  version?: number;
  diagnostics: LspDiagnostic[];
}
```

```ts
// packages/core/src/domain/events.ts
import type { SessionState, Workspace } from "./types";
import type { LspDiagnosticsEvent } from "./lsp";

export type DomainEvent =
  | {
      type: "session.state.changed";
      sessionId: string;
      workspaceId?: string;
      from: SessionState;
      to: SessionState;
      session?: import("./types").Session;
    }
  | {
      type: "session.lifecycle";
      sessionId: string;
      workspaceId?: string;
      event: "started" | "turn_completed" | "stopped" | "removed";
    }
  | { type: "workspace.meta.changed"; workspaceId: string; patch: Partial<Workspace> }
  | {
      type: "git.state.changed";
      workspaceId: string;
      treeChanged?: boolean;
      branchChanged?: boolean;
      worktreeChanged?: boolean;
    }
  | { type: "fs.dirty"; workspaceId: string; reason: string }
  | {
      type: "terminal.created";
      workspaceId: string;
      terminalId: string;
      kind: "agent" | "shell";
      title: string;
      cwd: string;
    }
  | {
      type: "terminal.output";
      workspaceId: string;
      terminalId: string;
      chunk: Buffer;
      seq: number;
    }
  | {
      type: "terminal.exited";
      workspaceId: string;
      terminalId: string;
      exitCode: number;
    }
  | ({
      type: "lsp.diagnostics.updated";
    } & LspDiagnosticsEvent);
```

```ts
// packages/core/src/protocol/topics.ts
export const Topics = {
  connectionStatus: "connection.status",
  connectionReady: "connection.ready",
  workspaceMeta: (id: string) => `workspace.${id}.meta`,
  workspaceFsDirty: (id: string) => `workspace.${id}.fs.dirty`,
  workspaceGitState: (id: string) => `workspace.${id}.git.state`,
  workspaceAll: (id: string) => `workspace.${id}.*`,
  sessionState: (workspaceId: string, sessionId: string) =>
    `workspace.${workspaceId}.session.${sessionId}.state`,
  sessionLifecycle: (workspaceId: string, sessionId: string) =>
    `workspace.${workspaceId}.session.${sessionId}.lifecycle`,
  sessionProgress: (workspaceId: string, sessionId: string) =>
    `workspace.${workspaceId}.session.${sessionId}.progress`,
  sessionsAll: (workspaceId: string) => `workspace.${workspaceId}.session.*`,
  terminalCreated: (workspaceId: string, terminalId: string) =>
    `workspace.${workspaceId}.terminal.${terminalId}.created`,
  terminalOutput: (workspaceId: string, terminalId: string) =>
    `workspace.${workspaceId}.terminal.${terminalId}.output`,
  terminalExit: (workspaceId: string, terminalId: string) =>
    `workspace.${workspaceId}.terminal.${terminalId}.exit`,
  terminalsAll: (workspaceId: string) => `workspace.${workspaceId}.terminal.*`,
  notificationToast: "notification.toast",
  supervisorState: (workspaceId: string, sessionId: string) =>
    `workspace.${workspaceId}.session.${sessionId}.supervisor.state`,
  supervisorCycle: (workspaceId: string, sessionId: string) =>
    `workspace.${workspaceId}.session.${sessionId}.supervisor.cycle`,
  workspaceLspDiagnostics: (workspaceId: string) => `workspace.${workspaceId}.lsp.diagnostics`,
} as const;
```

```ts
// packages/core/src/index.ts
export * from "./domain/lsp";
```

- [ ] **Step 4: Run the core tests to verify the shared surface passes**

Run: `pnpm exec vitest run packages/core/src/domain/lsp.test.ts packages/core/src/domain/types.test.ts packages/core/src/index.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add \
  packages/core/src/domain/lsp.ts \
  packages/core/src/domain/lsp.test.ts \
  packages/core/src/domain/events.ts \
  packages/core/src/protocol/topics.ts \
  packages/core/src/index.ts
git commit -m "feat(core): add shared lsp types and topics"
```

## Task 2: Add Server Factory And Fake LSP Fixture

**Files:**
- Modify: `packages/server/package.json`
- Create: `packages/server/src/lsp/server-factory.ts`
- Create: `packages/server/src/lsp/server-factory.test.ts`
- Create: `packages/server/src/__tests__/fixtures/fake-lsp-server.js`

- [ ] **Step 1: Write the failing server-factory test for language mapping, env override, and WSL wrapping**

```ts
import { describe, expect, it } from "vitest";
import { resolveLspServerSpec } from "./server-factory";

const workspace = {
  id: "ws-1",
  path: "/repo",
  targetRuntime: "native" as const,
  openedAt: 1,
  lastActiveAt: 1,
  uiState: {
    leftPanelWidth: 250,
    bottomPanelHeight: 200,
    focusMode: false,
  },
};

describe("resolveLspServerSpec", () => {
  it("maps ts/js/jsx/tsx files to the typescript server kind", () => {
    expect(resolveLspServerSpec({ workspace, path: "src/a.tsx" })?.serverKind).toBe("typescript");
    expect(resolveLspServerSpec({ workspace, path: "src/a.jsx" })?.serverKind).toBe("typescript");
  });

  it("returns null for unsupported languages", () => {
    expect(resolveLspServerSpec({ workspace, path: "assets/logo.svg" })).toBeNull();
  });

  it("supports command overrides for deterministic tests", () => {
    const spec = resolveLspServerSpec({
      workspace,
      path: "src/a.ts",
      env: {
        CODER_STUDIO_LSP_TYPESCRIPT_COMMAND: "node",
        CODER_STUDIO_LSP_TYPESCRIPT_ARGS_JSON:
          '[\"packages/server/src/__tests__/fixtures/fake-lsp-server.js\"]',
      },
    });

    expect(spec).toMatchObject({
      serverKind: "typescript",
      command: "node",
      args: ["packages/server/src/__tests__/fixtures/fake-lsp-server.js"],
    });
  });

  it("wraps the command in wsl when the workspace targets WSL", () => {
    const spec = resolveLspServerSpec({
      workspace: {
        ...workspace,
        targetRuntime: "wsl",
        wslDistro: "Ubuntu",
      },
      path: "src/a.ts",
      env: {
        CODER_STUDIO_LSP_TYPESCRIPT_COMMAND: "node",
        CODER_STUDIO_LSP_TYPESCRIPT_ARGS_JSON:
          '[\"packages/server/src/__tests__/fixtures/fake-lsp-server.js\"]',
      },
    });

    expect(spec).toMatchObject({
      command: "wsl",
      args: [
        "-d",
        "Ubuntu",
        "--",
        "node",
        "packages/server/src/__tests__/fixtures/fake-lsp-server.js",
      ],
    });
  });
});
```

- [ ] **Step 2: Run the server-factory test to verify it fails**

Run: `pnpm exec vitest run packages/server/src/lsp/server-factory.test.ts`

Expected: FAIL because `resolveLspServerSpec` and the fake fixture do not exist yet

- [ ] **Step 3: Add the server-factory mapping, env overrides, dependencies, and fake fixture**

```json
// packages/server/package.json
{
  "dependencies": {
    "vscode-jsonrpc": "^8.2.1",
    "vscode-languageserver-protocol": "^3.17.5"
  }
}
```

```ts
// packages/server/src/lsp/server-factory.ts
import type { LspServerKind, Workspace } from "@coder-studio/core";

export interface LspServerSpec {
  serverKind: LspServerKind;
  command: string;
  args: string[];
  rootPath: string;
}

const TYPESCRIPT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"]);
const PYTHON_EXTENSIONS = new Set([".py"]);
const GO_EXTENSIONS = new Set([".go"]);
const RUST_EXTENSIONS = new Set([".rs"]);

export function resolveLspServerSpec(args: {
  workspace: Workspace;
  path: string;
  env?: NodeJS.ProcessEnv;
}): LspServerSpec | null {
  const env = args.env ?? process.env;
  const extension = args.path.slice(args.path.lastIndexOf(".")).toLowerCase();

  const base =
    TYPESCRIPT_EXTENSIONS.has(extension)
      ? overrideable("typescript", args.workspace.path, env, "typescript-language-server", [
          "--stdio",
        ])
      : PYTHON_EXTENSIONS.has(extension)
        ? overrideable("python", args.workspace.path, env, "pylsp", [])
        : GO_EXTENSIONS.has(extension)
          ? overrideable("go", args.workspace.path, env, "gopls", [])
          : RUST_EXTENSIONS.has(extension)
            ? overrideable("rust", args.workspace.path, env, "rust-analyzer", [])
            : null;

  if (!base) {
    return null;
  }

  if (args.workspace.targetRuntime !== "wsl") {
    return base;
  }

  const wslArgs = [
    ...(args.workspace.wslDistro ? ["-d", args.workspace.wslDistro] : []),
    "--",
    base.command,
    ...base.args,
  ];

  return {
    ...base,
    command: "wsl",
    args: wslArgs,
  };
}

function overrideable(
  serverKind: LspServerKind,
  rootPath: string,
  env: NodeJS.ProcessEnv,
  defaultCommand: string,
  defaultArgs: string[]
): LspServerSpec {
  const prefix = `CODER_STUDIO_LSP_${serverKind.toUpperCase()}`;
  const command = env[`${prefix}_COMMAND`] ?? defaultCommand;
  const args = env[`${prefix}_ARGS_JSON`]
    ? (JSON.parse(env[`${prefix}_ARGS_JSON`]!) as string[])
    : defaultArgs;

  return {
    serverKind,
    command,
    args,
    rootPath,
  };
}
```

```js
// packages/server/src/__tests__/fixtures/fake-lsp-server.js
import { readFileSync } from "node:fs";
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from "vscode-jsonrpc/node.js";

const connection = createMessageConnection(
  new StreamMessageReader(process.stdin),
  new StreamMessageWriter(process.stdout)
);

const docs = new Map();

connection.onRequest("initialize", () => ({
  capabilities: {
    definitionProvider: true,
    referencesProvider: true,
    hoverProvider: true,
    documentSymbolProvider: true,
    textDocumentSync: 1,
  },
}));

connection.onNotification("textDocument/didOpen", ({ textDocument }) => {
  docs.set(textDocument.uri, textDocument.text);
  publishDiagnostics(textDocument.uri);
});

connection.onNotification("textDocument/didChange", ({ textDocument, contentChanges }) => {
  docs.set(textDocument.uri, contentChanges.at(-1)?.text ?? "");
  publishDiagnostics(textDocument.uri);
});

connection.onNotification("textDocument/didClose", ({ textDocument }) => {
  docs.delete(textDocument.uri);
  connection.sendNotification("textDocument/publishDiagnostics", {
    uri: textDocument.uri,
    diagnostics: [],
  });
});

connection.onRequest("textDocument/definition", ({ textDocument }) => {
  if (!textDocument.uri.endsWith("/consumer.ts")) {
    return [];
  }

  return [
    {
      uri: textDocument.uri.replace("/consumer.ts", "/shared.ts"),
      range: {
        start: { line: 0, character: 13 },
        end: { line: 0, character: 24 },
      },
    },
  ];
});

connection.onRequest("textDocument/references", ({ textDocument }) => {
  if (!textDocument.uri.endsWith("/shared.ts")) {
    return [];
  }

  return [
    {
      uri: textDocument.uri,
      range: {
        start: { line: 0, character: 13 },
        end: { line: 0, character: 24 },
      },
    },
    {
      uri: textDocument.uri.replace("/shared.ts", "/consumer.ts"),
      range: {
        start: { line: 0, character: 9 },
        end: { line: 0, character: 20 },
      },
    },
  ];
});

connection.onRequest("textDocument/hover", ({ textDocument }) => {
  if (!textDocument.uri.endsWith("/shared.ts")) {
    return null;
  }

  return {
    contents: {
      kind: "markdown",
      value: "```ts\\nconst sharedValue: number\\n```",
    },
  };
});

connection.onRequest("textDocument/documentSymbol", ({ textDocument }) => {
  if (!textDocument.uri.endsWith("/shared.ts")) {
    return [];
  }

  return [
    {
      name: "sharedValue",
      kind: 13,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 29 },
      },
      selectionRange: {
        start: { line: 0, character: 13 },
        end: { line: 0, character: 24 },
      },
    },
  ];
});

function publishDiagnostics(uri) {
  const text = docs.get(uri) ?? readFileSync(new URL(uri), "utf8");
  const diagnostics = text.includes("missingSymbol")
    ? [
        {
          severity: 1,
          message: "Cannot find name 'missingSymbol'.",
          range: {
            start: { line: 0, character: 22 },
            end: { line: 0, character: 35 },
          },
          source: "fake-lsp",
        },
      ]
    : [];

  connection.sendNotification("textDocument/publishDiagnostics", {
    uri,
    diagnostics,
  });
}

connection.listen();
```

- [ ] **Step 4: Run the targeted tests and install the new server dependency lock entries**

Run: `pnpm install`

Expected: `pnpm-lock.yaml` updates with `vscode-jsonrpc` and `vscode-languageserver-protocol`

Run: `pnpm exec vitest run packages/server/src/lsp/server-factory.test.ts packages/server/src/__tests__/provider-runtime/command-runner.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add \
  packages/server/package.json \
  pnpm-lock.yaml \
  packages/server/src/lsp/server-factory.ts \
  packages/server/src/lsp/server-factory.test.ts \
  packages/server/src/__tests__/fixtures/fake-lsp-server.js
git commit -m "feat(server): add lsp server factory and fake fixture"
```

## Task 3: Implement Document Store And Single LSP Session

**Files:**
- Create: `packages/server/src/lsp/document-store.ts`
- Create: `packages/server/src/lsp/document-store.test.ts`
- Create: `packages/server/src/lsp/session.ts`
- Create: `packages/server/src/lsp/session.test.ts`

- [ ] **Step 1: Write the failing tests for document versioning, replay, diagnostics, and read-only requests**

```ts
// packages/server/src/lsp/document-store.test.ts
import { describe, expect, it } from "vitest";
import { DocumentStore } from "./document-store";

describe("DocumentStore", () => {
  it("tracks open/change/close versions and replayable snapshots", () => {
    const store = new DocumentStore("/repo");

    expect(
      store.open({
        path: "e2e/fixtures/lsp-workspace/shared.ts",
        languageId: "typescript",
        text: "export const sharedValue = 1;\n",
      }).version
    ).toBe(1);

    expect(
      store.change("e2e/fixtures/lsp-workspace/shared.ts", "export const sharedValue = 2;\n").version
    ).toBe(2);

    expect(store.listOpen()).toHaveLength(1);
    expect(store.listReplayable()).toHaveLength(1);

    store.close("e2e/fixtures/lsp-workspace/shared.ts");

    expect(store.listOpen()).toHaveLength(0);
    expect(store.listReplayable()).toHaveLength(0);
  });
});
```

```ts
// packages/server/src/lsp/session.test.ts
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { LspSession } from "./session";

describe("LspSession", () => {
  it("initializes, syncs a document, serves read-only queries, and forwards diagnostics", async () => {
    const diagnostics = vi.fn();
    const session = new LspSession({
      workspaceId: "ws-1",
      workspacePath: process.cwd(),
      spec: {
        serverKind: "typescript",
        command: "node",
        args: [join(process.cwd(), "packages/server/src/__tests__/fixtures/fake-lsp-server.js")],
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
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `pnpm exec vitest run packages/server/src/lsp/document-store.test.ts packages/server/src/lsp/session.test.ts`

Expected: FAIL because `DocumentStore` and `LspSession` do not exist yet

- [ ] **Step 3: Implement the document store**

```ts
// packages/server/src/lsp/document-store.ts
import path from "node:path";

interface DocumentRecord {
  path: string;
  uri: string;
  languageId: string;
  text: string;
  version: number;
  open: boolean;
}

export class DocumentStore {
  private readonly docs = new Map<string, DocumentRecord>();

  constructor(private readonly workspacePath: string) {}

  open(input: { path: string; languageId: string; text: string }): DocumentRecord {
    const next: DocumentRecord = {
      path: input.path,
      uri: toFileUri(this.workspacePath, input.path),
      languageId: input.languageId,
      text: input.text,
      version: 1,
      open: true,
    };
    this.docs.set(input.path, next);
    return next;
  }

  change(filePath: string, text: string): DocumentRecord {
    const current = this.getOrThrow(filePath);
    const next = {
      ...current,
      text,
      version: current.version + 1,
      open: true,
    };
    this.docs.set(filePath, next);
    return next;
  }

  close(filePath: string): void {
    const current = this.getOrThrow(filePath);
    this.docs.delete(filePath);
    if (current.open) {
      this.docs.set(filePath, { ...current, open: false });
      this.docs.delete(filePath);
    }
  }

  get(filePath: string): DocumentRecord | undefined {
    return this.docs.get(filePath);
  }

  listOpen(): DocumentRecord[] {
    return Array.from(this.docs.values()).filter((doc) => doc.open);
  }

  listReplayable(): DocumentRecord[] {
    return this.listOpen();
  }

  fromUri(uri: string): string | null {
    const prefix = toFileUri(this.workspacePath, "");
    return uri.startsWith(prefix) ? decodeURIComponent(uri.slice(prefix.length)) : null;
  }

  private getOrThrow(filePath: string): DocumentRecord {
    const current = this.docs.get(filePath);
    if (!current) {
      throw new Error(`LSP document not open: ${filePath}`);
    }
    return current;
  }
}

function toFileUri(workspacePath: string, relativePath: string): string {
  const absolute = path.join(workspacePath, relativePath).replace(/\\/g, "/");
  return `file://${absolute}`;
}
```

- [ ] **Step 4: Implement the single-session JSON-RPC bridge**

```ts
// packages/server/src/lsp/session.ts
import { spawn, type ChildProcess } from "node:child_process";
import type {
  LspDiagnostic,
  LspDiagnosticsEvent,
  LspDocumentSymbol,
  LspHoverResult,
  LspLocation,
  LspRange,
  LspServerKind,
  LspSessionSummary,
} from "@coder-studio/core";
import {
  type MessageConnection,
  createMessageConnection,
  NotificationType,
  RequestType,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node";
import { DocumentStore } from "./document-store";

const PublishDiagnosticsNotification = new NotificationType<any>("textDocument/publishDiagnostics");
const DefinitionRequest = new RequestType<any, any, void>("textDocument/definition");
const ReferencesRequest = new RequestType<any, any, void>("textDocument/references");
const HoverRequest = new RequestType<any, any, void>("textDocument/hover");
const DocumentSymbolsRequest = new RequestType<any, any, void>("textDocument/documentSymbol");

export class LspSession {
  private readonly documents: DocumentStore;
  private child: ChildProcess | null = null;
  private connection: MessageConnection | null = null;
  private summary: LspSessionSummary;

  constructor(
    private readonly deps: {
      workspaceId: string;
      workspacePath: string;
      spec: {
        serverKind: LspServerKind;
        command: string;
        args: string[];
        rootPath: string;
      };
      onDiagnostics: (event: LspDiagnosticsEvent) => void;
      requestTimeoutMs: number;
      logger: {
        info: (...args: unknown[]) => void;
        warn: (...args: unknown[]) => void;
        error: (...args: unknown[]) => void;
      };
    }
  ) {
    this.documents = new DocumentStore(deps.workspacePath);
    this.summary = {
      workspaceId: deps.workspaceId,
      serverKind: deps.spec.serverKind,
      status: "starting",
      capabilities: {
        definition: false,
        references: false,
        hover: false,
        documentSymbols: false,
        diagnostics: true,
      },
    };
  }

  async start(): Promise<LspSessionSummary> {
    if (this.connection) {
      return this.summary;
    }

    this.child = spawn(this.deps.spec.command, this.deps.spec.args, {
      cwd: this.deps.spec.rootPath,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.connection = createMessageConnection(
      new StreamMessageReader(this.child.stdout!),
      new StreamMessageWriter(this.child.stdin!)
    );

    this.connection.onNotification(PublishDiagnosticsNotification, (params) => {
      const path = this.documents.fromUri(params.uri);
      if (!path) {
        return;
      }

      this.deps.onDiagnostics({
        workspaceId: this.deps.workspaceId,
        serverKind: this.deps.spec.serverKind,
        path,
        diagnostics: params.diagnostics.map(toSharedDiagnostic),
      });
    });

    this.connection.listen();

    const initializeResult = await this.withTimeout(
      this.connection.sendRequest("initialize", {
        processId: process.pid,
        rootUri: `file://${this.deps.spec.rootPath.replace(/\\/g, "/")}`,
        capabilities: {},
      })
    );

    this.connection.sendNotification("initialized", {});

    this.summary = {
      ...this.summary,
      status: "ready",
      capabilities: {
        definition: Boolean(initializeResult.capabilities?.definitionProvider),
        references: Boolean(initializeResult.capabilities?.referencesProvider),
        hover: Boolean(initializeResult.capabilities?.hoverProvider),
        documentSymbols: Boolean(initializeResult.capabilities?.documentSymbolProvider),
        diagnostics: true,
      },
    };

    return this.summary;
  }

  async openDocument(input: { path: string; languageId: string; text: string }): Promise<number> {
    await this.start();
    const doc = this.documents.open(input);
    this.connection!.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri: doc.uri,
        languageId: doc.languageId,
        version: doc.version,
        text: doc.text,
      },
    });
    return doc.version;
  }

  async changeDocument(path: string, text: string): Promise<number> {
    const doc = this.documents.change(path, text);
    this.connection!.sendNotification("textDocument/didChange", {
      textDocument: {
        uri: doc.uri,
        version: doc.version,
      },
      contentChanges: [{ text: doc.text }],
    });
    return doc.version;
  }

  async closeDocument(path: string): Promise<void> {
    const doc = this.documents.get(path);
    if (!doc || !this.connection) {
      return;
    }
    this.connection.sendNotification("textDocument/didClose", {
      textDocument: { uri: doc.uri },
    });
    this.documents.close(path);
  }

  async definition(input: { path: string; line: number; column: number }): Promise<LspLocation[] | null> {
    return this.requestLocations(DefinitionRequest, input);
  }

  async references(input: { path: string; line: number; column: number }): Promise<LspLocation[] | null> {
    return this.requestLocations(ReferencesRequest, input);
  }

  async hover(input: { path: string; line: number; column: number }): Promise<LspHoverResult | null> {
    const doc = this.documents.get(input.path);
    if (!doc || !this.connection) {
      return null;
    }

    const result = await this.withTimeout(
      this.connection.sendRequest(HoverRequest, {
        textDocument: { uri: doc.uri },
        position: { line: input.line - 1, character: input.column - 1 },
      })
    );

    if (!result) {
      return null;
    }

    return {
      contents: toHoverContents(result.contents),
      range: result.range ? toSharedRange(result.range) : undefined,
      version: doc.version,
    };
  }

  async documentSymbols(input: { path: string }): Promise<LspDocumentSymbol[] | null> {
    const doc = this.documents.get(input.path);
    if (!doc || !this.connection) {
      return null;
    }

    const result = await this.withTimeout(
      this.connection.sendRequest(DocumentSymbolsRequest, {
        textDocument: { uri: doc.uri },
      })
    );

    return Array.isArray(result) ? result.map(toSharedSymbol) : null;
  }

  async stop(): Promise<void> {
    this.connection?.dispose();
    this.connection = null;
    this.child?.kill("SIGTERM");
    this.child = null;
    this.summary = { ...this.summary, status: "stopped" };
  }

  getSummary(): LspSessionSummary {
    return this.summary;
  }

  listReplayableDocuments() {
    return this.documents.listReplayable();
  }

  private async requestLocations(
    type: RequestType<any, any, void>,
    input: { path: string; line: number; column: number }
  ): Promise<LspLocation[] | null> {
    const doc = this.documents.get(input.path);
    if (!doc || !this.connection) {
      return null;
    }

    const result = await this.withTimeout(
      this.connection.sendRequest(type, {
        textDocument: { uri: doc.uri },
        position: { line: input.line - 1, character: input.column - 1 },
      })
    );

    return Array.isArray(result)
      ? result
          .map((location) => {
            const path = this.documents.fromUri(location.uri);
            return path ? { path, range: toSharedRange(location.range) } : null;
          })
          .filter((value): value is LspLocation => Boolean(value))
      : null;
  }

  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("LSP request timed out")), this.deps.requestTimeoutMs)
      ),
    ]);
  }
}

function toSharedRange(range: {
  start: { line: number; character: number };
  end: { line: number; character: number };
}): LspRange {
  return {
    startLine: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLine: range.end.line + 1,
    endColumn: range.end.character + 1,
  };
}

function toSharedDiagnostic(input: {
  message: string;
  severity?: number;
  code?: string | number;
  source?: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}): LspDiagnostic {
  return {
    message: input.message,
    severity:
      input.severity === 1
        ? "error"
        : input.severity === 2
          ? "warning"
          : input.severity === 3
            ? "info"
            : "hint",
    code: input.code === undefined ? undefined : String(input.code),
    source: input.source,
    range: toSharedRange(input.range),
  };
}

function toHoverContents(contents: unknown): string[] {
  if (!contents) return [];
  if (Array.isArray(contents)) {
    return contents.flatMap(toHoverContents);
  }
  if (typeof contents === "string") {
    return [contents];
  }
  if (typeof contents === "object" && contents !== null && "value" in contents) {
    const value = (contents as { value?: unknown }).value;
    return typeof value === "string" ? [value] : [];
  }
  return [];
}

function toSharedSymbol(input: any): LspDocumentSymbol {
  return {
    name: input.name,
    kind: input.kind,
    range: toSharedRange(input.range),
    selectionRange: toSharedRange(input.selectionRange),
    children: Array.isArray(input.children) ? input.children.map(toSharedSymbol) : undefined,
  };
}
```

- [ ] **Step 5: Run the server LSP unit tests**

Run: `pnpm exec vitest run packages/server/src/lsp/document-store.test.ts packages/server/src/lsp/session.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add \
  packages/server/src/lsp/document-store.ts \
  packages/server/src/lsp/document-store.test.ts \
  packages/server/src/lsp/session.ts \
  packages/server/src/lsp/session.test.ts
git commit -m "feat(server): add lsp document store and session"
```

## Task 4: Add Session Manager, Commands, And Server Wiring

**Files:**
- Create: `packages/server/src/lsp/manager.ts`
- Create: `packages/server/src/lsp/manager.test.ts`
- Create: `packages/server/src/commands/lsp.ts`
- Create: `packages/server/src/__tests__/lsp-commands.test.ts`
- Modify: `packages/server/src/commands/index.ts`
- Modify: `packages/server/src/ws/dispatch.ts`
- Modify: `packages/server/src/ws/hub.ts`
- Modify: `packages/server/src/server.ts`

- [ ] **Step 1: Write the failing tests for session reuse, command routing, and diagnostics broadcast**

```ts
// packages/server/src/lsp/manager.test.ts
import { describe, expect, it, vi } from "vitest";
import { LspManager } from "./manager";

describe("LspManager", () => {
  it("reuses one session per workspace and server kind", async () => {
    const manager = new LspManager({
      requestTimeoutMs: 2000,
      idleTtlMs: 1000,
      restartLimit: 2,
      workspaceMgr: {
        get: () => ({
          id: "ws-1",
          path: process.cwd(),
          targetRuntime: "native",
          openedAt: 1,
          lastActiveAt: 1,
          uiState: { leftPanelWidth: 250, bottomPanelHeight: 200, focusMode: false },
        }),
      },
      eventBus: { emit: vi.fn() },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    const first = await manager.ensureSession({
      workspaceId: "ws-1",
      path: "e2e/fixtures/lsp-workspace/shared.ts",
    });
    const second = await manager.ensureSession({
      workspaceId: "ws-1",
      path: "e2e/fixtures/lsp-workspace/consumer.ts",
    });

    expect(first?.serverKind).toBe("typescript");
    expect(second?.serverKind).toBe("typescript");
    expect(manager.getSessionCount()).toBe(1);
  });
});
```

```ts
// packages/server/src/__tests__/lsp-commands.test.ts
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../bus/event-bus.js";
import { openDatabase, runMigrations } from "../storage/db.js";
import { WorkspaceManager } from "../workspace/manager.js";
import type { CommandContext } from "../ws/dispatch.js";
import { dispatch } from "../ws/dispatch.js";

import "../commands/workspace.js";
import "../commands/lsp.js";

class FakeLspManager {
  async ensureSession() {
    return {
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
    };
  }

  async openDocument() {
    return 1;
  }

  async changeDocument() {
    return 2;
  }

  async closeDocument() {}

  async definition() {
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

  async references() {
    return [];
  }

  async hover() {
    return null;
  }

  async documentSymbols() {
    return [];
  }
}

describe("LSP commands", () => {
  let ctx: CommandContext;

  beforeEach(() => {
    const db = openDatabase(":memory:");
    runMigrations(db);
    const eventBus = new EventBus();
    const workspaceMgr = new WorkspaceManager({ db, eventBus });

    ctx = {
      db,
      workspaceMgr,
      eventBus,
      sessionMgr: {} as never,
      terminalMgr: {} as never,
      broadcaster: { broadcast: vi.fn(), sendToClient: vi.fn(), sendBinaryToClient: vi.fn() },
      providerRegistry: [],
      autoFetch: {} as never,
      fencingMgr: {} as never,
      supervisorMgr: {} as never,
      activationMgr: { getLease: () => ({ wsClientId: "test-client" }) } as never,
      lspMgr: new FakeLspManager(),
    } as unknown as CommandContext;
  });

  it("ensures a session and forwards read-only requests through the manager", async () => {
    const dir = join(tmpdir(), `lsp-command-test-${Date.now()}`);
    await mkdir(dir);

    const openWorkspace = await dispatch(
      {
        kind: "command",
        id: crypto.randomUUID(),
        op: "workspace.open",
        args: { path: dir },
      },
      ctx
    );

    const workspaceId = (openWorkspace.data as { id: string }).id;

    const ensure = await dispatch(
      {
        kind: "command",
        id: crypto.randomUUID(),
        op: "lsp.ensureSession",
        args: {
          workspaceId,
          path: "e2e/fixtures/lsp-workspace/shared.ts",
        },
      },
      ctx
    );

    expect(ensure.ok).toBe(true);

    const definition = await dispatch(
      {
        kind: "command",
        id: crypto.randomUUID(),
        op: "lsp.definition",
        args: {
          workspaceId,
          path: "e2e/fixtures/lsp-workspace/consumer.ts",
          line: 1,
          column: 12,
        },
      },
      ctx
    );

    expect(definition.ok).toBe(true);
    expect(definition.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "e2e/fixtures/lsp-workspace/shared.ts" })])
    );
  });
});
```

- [ ] **Step 2: Run the failing server integration tests**

Run: `pnpm exec vitest run packages/server/src/lsp/manager.test.ts packages/server/src/__tests__/lsp-commands.test.ts`

Expected: FAIL because `LspManager` and the `lsp.*` commands do not exist yet

- [ ] **Step 3: Implement the manager, commands, and diagnostics fanout**

```ts
// packages/server/src/lsp/manager.ts
import type { DomainEvent, LspLocation, LspSessionSummary, Workspace } from "@coder-studio/core";
import { resolveLspServerSpec } from "./server-factory";
import { LspSession } from "./session";

export class LspManager {
  private readonly sessions = new Map<string, { session: LspSession; idleTimer: NodeJS.Timeout | null }>();

  constructor(
    private readonly deps: {
      workspaceMgr: { get: (workspaceId: string) => Workspace | undefined };
      eventBus: { emit: (event: DomainEvent) => void };
      logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
      requestTimeoutMs: number;
      idleTtlMs: number;
      restartLimit: number;
    }
  ) {}

  async ensureSession(input: { workspaceId: string; path: string }): Promise<LspSessionSummary | null> {
    const workspace = this.deps.workspaceMgr.get(input.workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${input.workspaceId}`);
    }

    const spec = resolveLspServerSpec({ workspace, path: input.path });
    if (!spec) {
      return null;
    }

    const key = `${input.workspaceId}::${spec.serverKind}`;
    const existing = this.sessions.get(key);
    if (existing) {
      this.bumpActivity(key);
      return existing.session.getSummary();
    }

    const session = new LspSession({
      workspaceId: input.workspaceId,
      workspacePath: workspace.path,
      spec,
      requestTimeoutMs: this.deps.requestTimeoutMs,
      logger: this.deps.logger,
      onDiagnostics: (payload) =>
        this.deps.eventBus.emit({
          type: "lsp.diagnostics.updated",
          ...payload,
        }),
    });

    await session.start();
    this.sessions.set(key, { session, idleTimer: null });
    this.bumpActivity(key);
    return session.getSummary();
  }

  async openDocument(input: {
    workspaceId: string;
    path: string;
    languageId: string;
    text: string;
  }): Promise<number | null> {
    const session = await this.getSessionForPath(input.workspaceId, input.path);
    return session ? await session.openDocument(input) : null;
  }

  async changeDocument(input: { workspaceId: string; path: string; text: string }): Promise<number | null> {
    const session = await this.getSessionForPath(input.workspaceId, input.path);
    return session ? await session.changeDocument(input.path, input.text) : null;
  }

  async closeDocument(input: { workspaceId: string; path: string }): Promise<void> {
    const session = await this.getSessionForPath(input.workspaceId, input.path);
    if (!session) return;
    await session.closeDocument(input.path);
    this.bumpActivityBySession(input.workspaceId, session.getSummary().serverKind);
  }

  async definition(input: {
    workspaceId: string;
    path: string;
    line: number;
    column: number;
  }): Promise<LspLocation[] | null> {
    const session = await this.getSessionForPath(input.workspaceId, input.path);
    return session ? await session.definition(input) : null;
  }

  async references(input: {
    workspaceId: string;
    path: string;
    line: number;
    column: number;
  }): Promise<LspLocation[] | null> {
    const session = await this.getSessionForPath(input.workspaceId, input.path);
    return session ? await session.references(input) : null;
  }

  async hover(input: {
    workspaceId: string;
    path: string;
    line: number;
    column: number;
  }) {
    const session = await this.getSessionForPath(input.workspaceId, input.path);
    return session ? await session.hover(input) : null;
  }

  async documentSymbols(input: { workspaceId: string; path: string }) {
    const session = await this.getSessionForPath(input.workspaceId, input.path);
    return session ? await session.documentSymbols(input) : null;
  }

  async disposeWorkspace(workspaceId: string): Promise<void> {
    const keys = Array.from(this.sessions.keys()).filter((key) => key.startsWith(`${workspaceId}::`));
    for (const key of keys) {
      const entry = this.sessions.get(key);
      if (!entry) continue;
      clearTimeout(entry.idleTimer ?? undefined);
      await entry.session.stop();
      this.sessions.delete(key);
    }
  }

  async disposeAll(): Promise<void> {
    for (const key of Array.from(this.sessions.keys())) {
      const entry = this.sessions.get(key);
      if (!entry) continue;
      clearTimeout(entry.idleTimer ?? undefined);
      await entry.session.stop();
      this.sessions.delete(key);
    }
  }

  getSessionCount(): number {
    return this.sessions.size;
  }

  private async getSessionForPath(workspaceId: string, path: string): Promise<LspSession | null> {
    const summary = await this.ensureSession({ workspaceId, path });
    if (!summary) {
      return null;
    }
    const key = `${workspaceId}::${summary.serverKind}`;
    this.bumpActivity(key);
    return this.sessions.get(key)?.session ?? null;
  }

  private bumpActivity(key: string): void {
    const entry = this.sessions.get(key);
    if (!entry) return;
    clearTimeout(entry.idleTimer ?? undefined);
    entry.idleTimer = setTimeout(async () => {
      const current = this.sessions.get(key);
      if (!current) return;
      await current.session.stop();
      this.sessions.delete(key);
    }, this.deps.idleTtlMs);
  }

  private bumpActivityBySession(workspaceId: string, serverKind: string): void {
    this.bumpActivity(`${workspaceId}::${serverKind}`);
  }
}
```

```ts
// packages/server/src/commands/lsp.ts
import { z } from "zod";
import { registerCommand } from "../ws/dispatch.js";

registerCommand(
  "lsp.ensureSession",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
  }),
  async (args, ctx) => ctx.lspMgr.ensureSession(args)
);

registerCommand(
  "lsp.openDocument",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
    languageId: z.string(),
    text: z.string(),
  }),
  async (args, ctx) => ctx.lspMgr.openDocument(args)
);

registerCommand(
  "lsp.changeDocument",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
    text: z.string(),
  }),
  async (args, ctx) => ctx.lspMgr.changeDocument(args)
);

registerCommand(
  "lsp.closeDocument",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
  }),
  async (args, ctx) => ctx.lspMgr.closeDocument(args)
);

registerCommand(
  "lsp.definition",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
    line: z.number().int().positive(),
    column: z.number().int().positive(),
  }),
  async (args, ctx) => ctx.lspMgr.definition(args)
);

registerCommand(
  "lsp.references",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
    line: z.number().int().positive(),
    column: z.number().int().positive(),
  }),
  async (args, ctx) => ctx.lspMgr.references(args)
);

registerCommand(
  "lsp.hover",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
    line: z.number().int().positive(),
    column: z.number().int().positive(),
  }),
  async (args, ctx) => ctx.lspMgr.hover(args)
);

registerCommand(
  "lsp.documentSymbols",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
  }),
  async (args, ctx) => ctx.lspMgr.documentSymbols(args)
);
```

```ts
// packages/server/src/ws/dispatch.ts
import type { LspManager } from "../lsp/manager.js";

export interface CommandContext {
  workspaceMgr: WorkspaceManager;
  sessionMgr: SessionManager;
  terminalMgr: TerminalManager;
  eventBus: EventBus;
  broadcaster: Broadcaster;
  db: Database;
  providerRegistry: ProviderDefinition[];
  fencingMgr: FencingManager;
  supervisorMgr: SupervisorManager;
  autoFetch: AutoFetchRuntime;
  providerRuntimeDeps?: RuntimeStatusDeps;
  providerInstallMgr?: ProviderInstallManager;
  activationMgr: ActivationManager;
  lspMgr: LspManager;
}
```

```ts
// packages/server/src/commands/index.ts
import "./activation.js";
import "./connection.js";
import "./session.js";
import "./terminal.js";
import "./file.js";
import "./git.js";
import "./settings.js";
import "./provider.js";
import "./supervisor.js";
import "./workspace.js";
import "./workspace-activity.js";
import "./worktree.js";
import "./fencing.js";
import "./lsp.js";
```

```ts
// packages/server/src/ws/hub.ts
const eventTypes: DomainEvent["type"][] = [
  "session.state.changed",
  "session.lifecycle",
  "workspace.meta.changed",
  "git.state.changed",
  "fs.dirty",
  "terminal.created",
  "terminal.output",
  "terminal.exited",
  "lsp.diagnostics.updated",
];

case "lsp.diagnostics.updated":
  topic = Topics.workspaceLspDiagnostics(event.workspaceId);
  data = {
    workspaceId: event.workspaceId,
    serverKind: event.serverKind,
    path: event.path,
    version: event.version,
    diagnostics: event.diagnostics,
  };
  break;
```

```ts
// packages/server/src/server.ts
import { LspManager } from "./lsp/manager.js";

let lspMgr: LspManager | null = null;

wsHub.setLogger(app.log);

lspMgr = new LspManager({
  workspaceMgr,
  eventBus,
  logger: app.log,
  requestTimeoutMs: 2000,
  idleTtlMs: 60_000,
  restartLimit: 2,
});

workspaceMgr = new WorkspaceManager({
  teardown: async (workspaceId) => {
    await lspMgr?.disposeWorkspace(workspaceId);
    await supervisorMgr?.deleteForWorkspace(workspaceId);
    await sessionMgr.stopForWorkspace(workspaceId);
    await terminalMgr.closeForWorkspace(workspaceId);
    sessionMgr.deleteEndedForWorkspace(workspaceId);
  },
});

commandContext = {
  workspaceMgr,
  sessionMgr,
  terminalMgr,
  eventBus,
  broadcaster: wsHub,
  db,
  providerRegistry,
  fencingMgr,
  supervisorMgr,
  autoFetch,
  providerRuntimeDeps,
  providerInstallMgr,
  activationMgr,
  lspMgr,
};

const stopServer = async () => {
  if (stopped) return;
  stopped = true;

  clearTimeout(gcTimer);
  clearInterval(wsKeepaliveTimer);
  await app.close();
  await lspMgr?.disposeAll();
  autoFetch.stop();
  supervisorMgr.stop();
  terminalMgr.shutdown();
  wsHub.destroy();
  eventBus.clear();
  deleteRuntimeConfig();
  db.close();
};
```

- [ ] **Step 4: Run the server manager and command tests**

Run: `pnpm exec vitest run packages/server/src/lsp/manager.test.ts packages/server/src/__tests__/lsp-commands.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add \
  packages/server/src/lsp/manager.ts \
  packages/server/src/lsp/manager.test.ts \
  packages/server/src/commands/lsp.ts \
  packages/server/src/__tests__/lsp-commands.test.ts \
  packages/server/src/commands/index.ts \
  packages/server/src/ws/dispatch.ts \
  packages/server/src/ws/hub.ts \
  packages/server/src/server.ts
git commit -m "feat(server): wire generic lsp manager and commands"
```

## Task 5: Attach The Monaco LSP Bridge And Definition Provider

**Files:**
- Create: `packages/web/src/features/code-editor/lsp/language-map.ts`
- Create: `packages/web/src/features/code-editor/lsp/bridge.ts`
- Create: `packages/web/src/features/code-editor/lsp/providers.ts`
- Create: `packages/web/src/features/code-editor/lsp/bridge.test.tsx`
- Create: `packages/web/src/features/code-editor/lsp/providers.test.ts`
- Modify: `packages/web/src/features/code-editor/components/monaco-host.tsx`
- Modify: `packages/web/src/features/code-editor/components/monaco-host.test.tsx`

- [ ] **Step 1: Write the failing frontend tests for session ensure/open/change/close and definition provider behavior**

```ts
// packages/web/src/features/code-editor/lsp/bridge.test.tsx
import * as monaco from "monaco-editor";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLspBridge } from "./bridge";

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

describe("createLspBridge", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ensures a session, opens a supported document, debounces changes, and closes on detach", async () => {
    const sendCommand = vi
      .fn()
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValue(undefined);

    const unsubscribe = vi.fn();
    const bridge = createLspBridge({
      sendCommand,
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
});
```

```ts
// packages/web/src/features/code-editor/lsp/providers.test.ts
import * as monaco from "monaco-editor";
import { describe, expect, it, vi } from "vitest";
import { createLspBridge } from "./bridge";

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
  },
}));

function createMockModel(
  initialValue: string,
  version = 1,
  uri = monaco.Uri.file("/repo/e2e/fixtures/lsp-workspace/shared.ts")
) {
  let currentValue = initialValue;
  let currentVersion = version;

  return {
    uri,
    getValue: () => currentValue,
    getVersionId: () => currentVersion,
    onDidChangeContent: () => ({ dispose() {} }),
    fireDidChangeContent(nextValue: string, nextVersion: number) {
      currentValue = nextValue;
      currentVersion = nextVersion;
    },
  } as monaco.editor.ITextModel;
}

describe("LSP providers", () => {
  it("returns same-file definitions as Monaco locations", async () => {
    const bridge = createLspBridge({
      sendCommand: vi.fn(async (op) => {
        if (op === "lsp.ensureSession") {
          return {
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
      }),
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

    const location = await bridge.provideDefinition(model, { lineNumber: 1, column: 16 });

    expect(location).toEqual([
      expect.objectContaining({
        uri: monaco.Uri.file("/repo/e2e/fixtures/lsp-workspace/shared.ts"),
      }),
    ]);
  });

  it("returns cross-file definitions as Monaco locations for other workspace files", async () => {
    const bridge = createLspBridge({
      sendCommand: vi.fn(async (op) => {
        if (op === "lsp.ensureSession") {
          return {
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
      }),
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

    const location = await bridge.provideDefinition(model, { lineNumber: 1, column: 10 });

    expect(location).toEqual([
      expect.objectContaining({
        uri: monaco.Uri.file("/repo/e2e/fixtures/lsp-workspace/shared.ts"),
      }),
    ]);
  });
});
```

Insert into the top-level `const { ... } = vi.hoisted(() => { ... })` destructuring immediately after `workspaceModelB,`:

```ts
  mockConfigureLspBridge,
  mockAttachLspBridgeModel,
```

Insert before the `return {` inside the same `vi.hoisted(() => { ... })` block:

```ts
  const mockConfigureLspBridge = vi.fn();
  const mockAttachLspBridgeModel = vi.fn(() => vi.fn());
```

Insert into the returned object immediately after `workspaceModelB,`:

```ts
    mockConfigureLspBridge,
    mockAttachLspBridgeModel,
```

Add this mock after the existing `vi.mock("../monaco/model-registry", ...)` block:

```ts
vi.mock("../lsp/bridge", () => ({
  globalLspBridge: {
    configure: mockConfigureLspBridge,
    attachModel: mockAttachLspBridgeModel,
  },
}));
```

Add these reset lines inside the existing `beforeEach(() => { ... })` block after `mockEditorInstance.setValue.mockClear();`:

```ts
    mockConfigureLspBridge.mockClear();
    mockAttachLspBridgeModel.mockClear();
```

Add this test inside `describe("MonacoHost", () => { ... })`:

```ts
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
    expect(mockAttachLspBridgeModel).toHaveBeenCalledWith({
      workspaceId: "ws-test",
      workspaceRootPath: "/repo",
      path: "src/example.ts",
      monacoLanguage: "typescript",
      model: workspaceModelA,
    });
  });
});
```

- [ ] **Step 2: Run the failing bridge/provider tests**

Run: `pnpm exec vitest run packages/web/src/features/code-editor/lsp/bridge.test.tsx packages/web/src/features/code-editor/lsp/providers.test.ts packages/web/src/features/code-editor/components/monaco-host.test.tsx`

Expected: FAIL because the bridge, language map, and provider helpers do not exist yet

- [ ] **Step 3: Implement the language map, bridge, provider registration, and `MonacoHost` integration**

```ts
// packages/web/src/features/code-editor/lsp/language-map.ts
import type { LspServerKind } from "@coder-studio/core";

const TYPESCRIPT_EXTENSIONS = new Set(["ts", "tsx", "js", "jsx", "mts", "cts", "mjs", "cjs"]);
const PYTHON_EXTENSIONS = new Set(["py"]);
const GO_EXTENSIONS = new Set(["go"]);
const RUST_EXTENSIONS = new Set(["rs"]);

export function resolveLspServerKind(
  filePath: string,
  monacoLanguage: string
): LspServerKind | null {
  const extension = filePath.split(".").pop()?.toLowerCase() ?? "";

  if (TYPESCRIPT_EXTENSIONS.has(extension) || monacoLanguage === "typescript") {
    return "typescript";
  }
  if (PYTHON_EXTENSIONS.has(extension) || monacoLanguage === "python") {
    return "python";
  }
  if (GO_EXTENSIONS.has(extension) || monacoLanguage === "go") {
    return "go";
  }
  if (RUST_EXTENSIONS.has(extension) || monacoLanguage === "rust") {
    return "rust";
  }

  return null;
}
```

```ts
// packages/web/src/features/code-editor/lsp/providers.ts
import type { LspLocation } from "@coder-studio/core";
import * as monaco from "monaco-editor";
import { toWorkspaceFileUri } from "../monaco/uri";

export interface LspModelMetadata {
  workspaceId: string;
  workspaceRootPath: string;
  path: string;
}

export interface LspProviderRegistryDeps {
  lookupModelMetadata: (model: monaco.editor.ITextModel) => LspModelMetadata | undefined;
  requestDefinition: (input: {
    meta: LspModelMetadata;
    line: number;
    column: number;
    version: number;
  }) => Promise<LspLocation[] | null>;
}

export function createLspProviderRegistry(deps: LspProviderRegistryDeps) {
  const registeredLanguages = new Set<string>();

  function register(languageId: string): void {
    if (registeredLanguages.has(languageId)) {
      return;
    }

    registeredLanguages.add(languageId);

    monaco.languages.registerDefinitionProvider(languageId, {
      provideDefinition,
    });
  }

  async function provideDefinition(
    model: monaco.editor.ITextModel,
    position: monaco.Position
  ): Promise<monaco.languages.Location[]> {
    const meta = deps.lookupModelMetadata(model);
    if (!meta) {
      return [];
    }

    const requestVersion = model.getVersionId();
    const result = await deps.requestDefinition({
      meta,
      line: position.lineNumber,
      column: position.column,
      version: requestVersion,
    });

    if (!result || model.getVersionId() !== requestVersion) {
      return [];
    }

    return result.map((location) => ({
      uri: toWorkspaceFileUri(meta.workspaceRootPath, location.path),
      range: toMonacoRange(location.range),
    }));
  }

  return {
    register,
    provideDefinition,
  };
}

function toMonacoRange(range: {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}): monaco.IRange {
  return {
    startLineNumber: range.startLine,
    startColumn: range.startColumn,
    endLineNumber: range.endLine,
    endColumn: range.endColumn,
  };
}
```

```ts
// packages/web/src/features/code-editor/lsp/bridge.ts
import type { LspLocation, LspSessionSummary } from "@coder-studio/core";
import * as monaco from "monaco-editor";
import { resolveLspServerKind } from "./language-map";
import { createLspProviderRegistry } from "./providers";

type LspBridgeTransport = {
  sendCommand: <T = unknown>(op: string, args: unknown) => Promise<T>;
  subscribe: (topics: string[], handler: (topic: string, payload: unknown) => void) => () => void;
};

type AttachedModel = {
  workspaceId: string;
  workspaceRootPath: string;
  path: string;
  monacoLanguage: string;
  model: monaco.editor.ITextModel;
};

const noopTransport: LspBridgeTransport = {
  sendCommand: async () => null,
  subscribe: () => () => {},
};

export function createLspBridge(initialTransport: Partial<LspBridgeTransport> = {}) {
  let transport: LspBridgeTransport = {
    ...noopTransport,
    ...initialTransport,
  };
  const models = new Map<string, AttachedModel>();
  const changeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const providers = createLspProviderRegistry({
    lookupModelMetadata: (model) => {
      const meta = models.get(model.uri.toString());
      if (!meta) {
        return undefined;
      }

      return {
        workspaceId: meta.workspaceId,
        workspaceRootPath: meta.workspaceRootPath,
        path: meta.path,
      };
    },
    requestDefinition: async ({ meta, line, column }) =>
      await transport.sendCommand<LspLocation[] | null>("lsp.definition", {
        workspaceId: meta.workspaceId,
        path: meta.path,
        line,
        column,
      }),
  });

  function configure(nextTransport: Partial<LspBridgeTransport>): void {
    transport = {
      ...transport,
      ...nextTransport,
    };
  }

  function attachModel(input: AttachedModel): () => void {
    const serverKind = resolveLspServerKind(input.path, input.monacoLanguage);
    if (!serverKind) {
      return () => {};
    }

    const key = input.model.uri.toString();
    models.set(key, input);
    providers.register(input.monacoLanguage);

    void transport
      .sendCommand<LspSessionSummary | null>("lsp.ensureSession", {
        workspaceId: input.workspaceId,
        path: input.path,
      })
      .then((summary) => {
        if (!summary || summary.status !== "ready") {
          return null;
        }

        return transport.sendCommand("lsp.openDocument", {
          workspaceId: input.workspaceId,
          path: input.path,
          languageId: input.monacoLanguage,
          text: input.model.getValue(),
        });
      })
      .catch(() => null);

    const changeDisposable = input.model.onDidChangeContent(() => {
      clearTimeout(changeTimers.get(key));
      changeTimers.set(
        key,
        setTimeout(() => {
          void transport
            .sendCommand("lsp.changeDocument", {
              workspaceId: input.workspaceId,
              path: input.path,
              text: input.model.getValue(),
            })
            .catch(() => null);
        }, 75)
      );
    });

    return () => {
      clearTimeout(changeTimers.get(key));
      changeTimers.delete(key);
      models.delete(key);
      changeDisposable.dispose();

      void transport
        .sendCommand("lsp.closeDocument", {
          workspaceId: input.workspaceId,
          path: input.path,
        })
        .catch(() => null);
    };
  }

  return {
    configure,
    attachModel,
    provideDefinition: providers.provideDefinition,
  };
}

export const globalLspBridge = createLspBridge();
```

```ts
// packages/web/src/features/code-editor/components/monaco-host.tsx
import { useAtomValue, useSetAtom } from "jotai";
import { dispatchCommandAtom } from "../../../atoms/connection";
import { globalLspBridge } from "../lsp/bridge";

const dispatchCommand = useAtomValue(dispatchCommandAtom);

useEffect(() => {
  globalLspBridge.configure({
    sendCommand: async (op, args) => {
      const result = await dispatchCommand(op, args);
      return result.ok ? (result.data as unknown) : null;
    },
  });
}, [dispatchCommand]);

useEffect(() => {
  const model = editorRef.current?.getModel();
  if (!model || !isWorkspaceBacked || !workspaceId || !workspaceRootPath) {
    return;
  }

  return globalLspBridge.attachModel({
    workspaceId,
    workspaceRootPath,
    path: filePath,
    monacoLanguage: language,
    model,
  });
}, [filePath, isWorkspaceBacked, language, workspaceId, workspaceRootPath]);
```

- [ ] **Step 4: Run the bridge, provider, and host tests**

Run: `pnpm exec vitest run packages/web/src/features/code-editor/lsp/bridge.test.tsx packages/web/src/features/code-editor/lsp/providers.test.ts packages/web/src/features/code-editor/components/monaco-host.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add \
  packages/web/src/features/code-editor/lsp/language-map.ts \
  packages/web/src/features/code-editor/lsp/bridge.ts \
  packages/web/src/features/code-editor/lsp/providers.ts \
  packages/web/src/features/code-editor/lsp/bridge.test.tsx \
  packages/web/src/features/code-editor/lsp/providers.test.ts \
  packages/web/src/features/code-editor/components/monaco-host.tsx \
  packages/web/src/features/code-editor/components/monaco-host.test.tsx
git commit -m "feat(web): add monaco lsp bridge and definition support"
```

## Task 6: Add Hover, References, Symbols, Diagnostics, And Stale-Result Guards

**Files:**
- Modify: `packages/web/src/features/code-editor/lsp/bridge.test.tsx`
- Create: `packages/web/src/features/code-editor/lsp/diagnostics.ts`
- Create: `packages/web/src/features/code-editor/lsp/diagnostics.test.ts`
- Modify: `packages/web/src/features/code-editor/lsp/bridge.ts`
- Modify: `packages/web/src/features/code-editor/lsp/providers.ts`
- Modify: `packages/web/src/features/code-editor/lsp/providers.test.ts`
- Modify: `packages/web/src/features/code-editor/components/monaco-host.tsx`
- Modify: `packages/web/src/features/code-editor/components/monaco-host.test.tsx`
- Modify: `packages/server/src/lsp/session.test.ts`
- Modify: `packages/server/src/lsp/manager.test.ts`

- [ ] **Step 1: Write the failing tests for hover/references/symbols, diagnostics marker replacement, diagnostics subscription reference counting, timeout isolation, and stale-version discard**

```ts
// packages/web/src/features/code-editor/lsp/bridge.test.tsx
import * as monaco from "monaco-editor";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLspBridge } from "./bridge";

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

describe("createLspBridge", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a no-op detach function for unsupported languages", () => {
    const sendCommand = vi.fn();
    const bridge = createLspBridge({
      sendCommand,
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
    };

    const unsubscribe = vi.fn();
    const subscribe = vi.fn(() => unsubscribe);
    const bridge = createLspBridge({
      sendCommand: vi.fn().mockResolvedValue(readySummary),
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
});
```

```ts
// packages/web/src/features/code-editor/lsp/diagnostics.test.ts
import { describe, expect, it, vi } from "vitest";
import * as monaco from "monaco-editor";
import { createDiagnosticsController } from "./diagnostics";

const mockSetModelMarkers = vi.fn();
const brokenModel = {
  getVersionId: () => 1,
};

vi.mock("monaco-editor", () => ({
  Uri: {
    file: (path: string) => ({
      fsPath: path,
      path,
      scheme: "file",
      toString: () => `file://${path}`,
    }),
  },
  MarkerSeverity: {
    Error: 8,
    Warning: 4,
    Info: 2,
    Hint: 1,
  },
  editor: {
    getModel: vi.fn((uri: { path: string }) =>
      uri.path.endsWith("/broken.ts") ? brokenModel : null
    ),
    setModelMarkers: mockSetModelMarkers,
  },
}));

describe("createDiagnosticsController", () => {
  it("replaces markers for the same file and clears them on demand", () => {
    const controller = createDiagnosticsController();

    controller.apply("/repo", {
      path: "e2e/fixtures/lsp-workspace/broken.ts",
      diagnostics: [
        {
          message: "Cannot find name 'missingSymbol'.",
          severity: "error",
          range: {
            startLine: 1,
            startColumn: 23,
            endLine: 1,
            endColumn: 36,
          },
        },
      ],
    });

    expect(mockSetModelMarkers).toHaveBeenCalledWith(
      expect.anything(),
      "coder-studio-lsp",
      expect.arrayContaining([expect.objectContaining({ message: "Cannot find name 'missingSymbol'." })])
    );

    controller.clearFile("/repo", "e2e/fixtures/lsp-workspace/broken.ts");

    expect(mockSetModelMarkers).toHaveBeenLastCalledWith(expect.anything(), "coder-studio-lsp", []);
  });

  it("drops stale diagnostics updates for an older document version", () => {
    const controller = createDiagnosticsController();

    controller.apply("/repo", {
      path: "e2e/fixtures/lsp-workspace/broken.ts",
      version: 0,
      diagnostics: [
        {
          message: "old result",
          severity: "warning",
          range: {
            startLine: 1,
            startColumn: 1,
            endLine: 1,
            endColumn: 5,
          },
        },
      ],
    });

    expect(mockSetModelMarkers).not.toHaveBeenCalledWith(
      brokenModel,
      "coder-studio-lsp",
      expect.arrayContaining([expect.objectContaining({ message: "old result" })])
    );
  });
});
```

```ts
// packages/web/src/features/code-editor/lsp/providers.test.ts
import * as monaco from "monaco-editor";
import { describe, expect, it, vi } from "vitest";
import { createLspBridge } from "./bridge";

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

  return {
    uri,
    getValue: () => currentValue,
    getVersionId: () => currentVersion,
    onDidChangeContent: () => ({ dispose() {} }),
    fireDidChangeContent(nextValue: string, nextVersion: number) {
      currentValue = nextValue;
      currentVersion = nextVersion;
    },
  } as monaco.editor.ITextModel & {
    fireDidChangeContent(nextValue: string, nextVersion: number): void;
  };
}

describe("LSP providers", () => {
  it("converts hover, references, and document symbols into Monaco payloads", async () => {
    const readySummary = {
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
    };

    const bridge = createLspBridge({
      sendCommand: vi.fn(async (op) => {
        if (op === "lsp.ensureSession") {
          return readySummary;
        }

        if (op === "lsp.hover") {
          return {
            contents: ["```ts\\nconst sharedValue: number\\n```"],
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
      }),
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

    await expect(bridge.provideHover(model, { lineNumber: 1, column: 16 })).resolves.toEqual(
      expect.objectContaining({
        contents: [{ value: "```ts\nconst sharedValue: number\n```" }],
      })
    );

    await expect(bridge.provideReferences(model, { lineNumber: 1, column: 16 })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          uri: monaco.Uri.file("/repo/e2e/fixtures/lsp-workspace/consumer.ts"),
        }),
      ])
    );

    await expect(bridge.provideDocumentSymbols(model)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "sharedValue" })])
    );
  });

  it("drops stale hover results after the model version advances", async () => {
    const readySummary = {
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
    };

    const sendCommand = vi.fn(async (op: string) => {
      if (op === "lsp.ensureSession") {
        return readySummary;
      }

      if (op === "lsp.hover") {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {
          contents: ["```ts\\nconst sharedValue: number\\n```"],
          version: 1,
        };
      }

      return null;
    });

    const bridge = createLspBridge({
      sendCommand,
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

    const hoverPromise = bridge.provideHover(model, { lineNumber: 1, column: 16 });
    model.fireDidChangeContent("export const sharedValue = 2;\n", 2);

    await expect(hoverPromise).resolves.toBeNull();
  });
});
```

Add this import after the existing `import { beforeEach, describe, expect, it, vi } from "vitest";` line:

```ts
import { wsClientAtom } from "../../../atoms/connection";
```

Add this test after the Task 5 bridge-attachment test inside `describe("MonacoHost", () => { ... })`:

```ts
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
```

```ts
// packages/server/src/lsp/session.test.ts
import { join } from "node:path";
import { vi } from "vitest";
import { LspSession } from "./session";

it("times out one request without poisoning the whole session", async () => {
  const session = new LspSession({
    workspaceId: "ws-1",
    workspacePath: process.cwd(),
    spec: {
      serverKind: "typescript",
      command: "node",
      args: [join(process.cwd(), "packages/server/src/__tests__/fixtures/fake-lsp-server.js")],
      rootPath: process.cwd(),
    },
    onDiagnostics: vi.fn(),
    requestTimeoutMs: 5,
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

  const connection = (
    session as unknown as {
      connection: {
        sendRequest: (method: string, params: unknown) => Promise<unknown>;
      };
    }
  ).connection;
  const sendRequestSpy = vi.spyOn(connection, "sendRequest");
  const originalSendRequest = sendRequestSpy.getMockImplementation() ?? connection.sendRequest.bind(connection);

  sendRequestSpy.mockImplementation((method, params) => {
    if (method === "textDocument/hover") {
      return new Promise(() => {});
    }
    return originalSendRequest(method, params);
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
});
```

```ts
// packages/server/src/lsp/manager.test.ts
it("returns null for unsupported languages without creating a session", async () => {
  const manager = new LspManager({
    requestTimeoutMs: 2000,
    idleTtlMs: 1000,
    restartLimit: 2,
    workspaceMgr: {
      get: () => ({
        id: "ws-1",
        path: process.cwd(),
        targetRuntime: "native",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: { leftPanelWidth: 250, bottomPanelHeight: 200, focusMode: false },
      }),
    },
    eventBus: { emit: vi.fn() },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });

  await expect(
    manager.ensureSession({
      workspaceId: "ws-1",
      path: "README.md",
    })
  ).resolves.toBeNull();

  expect(manager.getSessionCount()).toBe(0);
});
```

- [ ] **Step 2: Run the failing diagnostics and stale-result tests**

Run: `pnpm exec vitest run packages/web/src/features/code-editor/lsp/bridge.test.tsx packages/web/src/features/code-editor/lsp/diagnostics.test.ts packages/web/src/features/code-editor/lsp/providers.test.ts packages/web/src/features/code-editor/components/monaco-host.test.tsx packages/server/src/lsp/session.test.ts packages/server/src/lsp/manager.test.ts`

Expected: FAIL because diagnostics helpers, extra providers, and timeout/recovery behavior are incomplete

- [ ] **Step 3: Implement diagnostics control, the remaining providers, and stale-version guards**

```ts
// packages/web/src/features/code-editor/lsp/diagnostics.ts
import * as monaco from "monaco-editor";
import { toWorkspaceFileUri } from "../monaco/uri";

const MARKER_OWNER = "coder-studio-lsp";

export function createDiagnosticsController() {
  return {
    apply(
      workspaceRootPath: string,
      input: {
        path: string;
        version?: number;
        diagnostics: Array<{
          message: string;
          severity: "error" | "warning" | "info" | "hint";
          source?: string;
          code?: string;
          range: {
            startLine: number;
            startColumn: number;
            endLine: number;
            endColumn: number;
          };
        }>;
      }
    ) {
      const model = monaco.editor.getModel(toWorkspaceFileUri(workspaceRootPath, input.path));
      if (!model) {
        return;
      }

      if (typeof input.version === "number" && input.version < model.getVersionId()) {
        return;
      }

      monaco.editor.setModelMarkers(
        model,
        MARKER_OWNER,
        input.diagnostics.map((diagnostic) => ({
          message: diagnostic.message,
          source: diagnostic.source,
          code: diagnostic.code,
          severity:
            diagnostic.severity === "error"
              ? monaco.MarkerSeverity.Error
              : diagnostic.severity === "warning"
                ? monaco.MarkerSeverity.Warning
                : diagnostic.severity === "info"
                  ? monaco.MarkerSeverity.Info
                  : monaco.MarkerSeverity.Hint,
          startLineNumber: diagnostic.range.startLine,
          startColumn: diagnostic.range.startColumn,
          endLineNumber: diagnostic.range.endLine,
          endColumn: diagnostic.range.endColumn,
        }))
      );
    },

    clearFile(workspaceRootPath: string, path: string) {
      const model = monaco.editor.getModel(toWorkspaceFileUri(workspaceRootPath, path));
      if (!model) {
        return;
      }
      monaco.editor.setModelMarkers(model, MARKER_OWNER, []);
    },
  };
}
```

```ts
// packages/web/src/features/code-editor/lsp/providers.ts
import type {
  LspDocumentSymbol,
  LspHoverResult,
  LspLocation,
} from "@coder-studio/core";
import * as monaco from "monaco-editor";
import { toWorkspaceFileUri } from "../monaco/uri";

export interface LspModelMetadata {
  workspaceId: string;
  workspaceRootPath: string;
  path: string;
}

export interface LspProviderRegistryDeps {
  lookupModelMetadata: (model: monaco.editor.ITextModel) => LspModelMetadata | undefined;
  requestDefinition: (input: {
    meta: LspModelMetadata;
    line: number;
    column: number;
    version: number;
  }) => Promise<LspLocation[] | null>;
  requestHover: (input: {
    meta: LspModelMetadata;
    line: number;
    column: number;
    version: number;
  }) => Promise<LspHoverResult | null>;
  requestReferences: (input: {
    meta: LspModelMetadata;
    line: number;
    column: number;
    version: number;
  }) => Promise<LspLocation[] | null>;
  requestDocumentSymbols: (input: {
    meta: LspModelMetadata;
    version: number;
  }) => Promise<LspDocumentSymbol[] | null>;
}

export function createLspProviderRegistry(deps: LspProviderRegistryDeps) {
  const registeredLanguages = new Set<string>();

  function register(languageId: string): void {
    if (registeredLanguages.has(languageId)) {
      return;
    }

    registeredLanguages.add(languageId);

    monaco.languages.registerDefinitionProvider(languageId, {
      provideDefinition,
    });
    monaco.languages.registerHoverProvider(languageId, {
      provideHover,
    });
    monaco.languages.registerReferenceProvider(languageId, {
      provideReferences,
    });
    monaco.languages.registerDocumentSymbolProvider(languageId, {
      provideDocumentSymbols,
    });
  }

  async function provideDefinition(
    model: monaco.editor.ITextModel,
    position: monaco.Position
  ): Promise<monaco.languages.Location[]> {
    const meta = deps.lookupModelMetadata(model);
    if (!meta) {
      return [];
    }

    const requestVersion = model.getVersionId();
    const result = await deps.requestDefinition({
      meta,
      line: position.lineNumber,
      column: position.column,
      version: requestVersion,
    });

    if (!result || model.getVersionId() !== requestVersion) {
      return [];
    }

    return result.map((location) => ({
      uri: toWorkspaceFileUri(meta.workspaceRootPath, location.path),
      range: toMonacoRange(location.range),
    }));
  }

  async function provideHover(
    model: monaco.editor.ITextModel,
    position: monaco.Position
  ): Promise<monaco.languages.Hover | null> {
    const meta = deps.lookupModelMetadata(model);
    if (!meta) {
      return null;
    }

    const requestVersion = model.getVersionId();
    const result = await deps.requestHover({
      meta,
      line: position.lineNumber,
      column: position.column,
      version: requestVersion,
    });

    if (!result || model.getVersionId() !== requestVersion) {
      return null;
    }

    return {
      contents: result.contents.map((value) => ({ value })),
      range: result.range ? toMonacoRange(result.range) : undefined,
    };
  }

  async function provideReferences(
    model: monaco.editor.ITextModel,
    position: monaco.Position
  ): Promise<monaco.languages.Location[]> {
    const meta = deps.lookupModelMetadata(model);
    if (!meta) {
      return [];
    }

    const requestVersion = model.getVersionId();
    const result = await deps.requestReferences({
      meta,
      line: position.lineNumber,
      column: position.column,
      version: requestVersion,
    });

    if (!result || model.getVersionId() !== requestVersion) {
      return [];
    }

    return result.map((location) => ({
      uri: toWorkspaceFileUri(meta.workspaceRootPath, location.path),
      range: toMonacoRange(location.range),
    }));
  }

  async function provideDocumentSymbols(
    model: monaco.editor.ITextModel
  ): Promise<monaco.languages.DocumentSymbol[]> {
    const meta = deps.lookupModelMetadata(model);
    if (!meta) {
      return [];
    }

    const requestVersion = model.getVersionId();
    const result = await deps.requestDocumentSymbols({
      meta,
      version: requestVersion,
    });

    if (!result || model.getVersionId() !== requestVersion) {
      return [];
    }

    return result.map(toMonacoSymbol);
  }

  return {
    register,
    provideDefinition,
    provideHover,
    provideReferences,
    provideDocumentSymbols,
  };
}

function toMonacoRange(range: {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}): monaco.IRange {
  return {
    startLineNumber: range.startLine,
    startColumn: range.startColumn,
    endLineNumber: range.endLine,
    endColumn: range.endColumn,
  };
}

function toMonacoSymbol(symbol: LspDocumentSymbol): monaco.languages.DocumentSymbol {
  return {
    name: symbol.name,
    detail: "",
    kind: symbol.kind as monaco.languages.SymbolKind,
    tags: [],
    containerName: "",
    range: toMonacoRange(symbol.range),
    selectionRange: toMonacoRange(symbol.selectionRange),
    children: Array.isArray(symbol.children)
      ? symbol.children.map(toMonacoSymbol)
      : [],
  };
}
```

```ts
// packages/web/src/features/code-editor/lsp/bridge.ts
import type {
  LspDiagnosticsEvent,
  LspDocumentSymbol,
  LspHoverResult,
  LspLocation,
  LspSessionSummary,
} from "@coder-studio/core";
import { Topics } from "@coder-studio/core";
import * as monaco from "monaco-editor";
import { createDiagnosticsController } from "./diagnostics";
import { resolveLspServerKind } from "./language-map";
import { createLspProviderRegistry } from "./providers";

type LspBridgeTransport = {
  sendCommand: <T = unknown>(op: string, args: unknown) => Promise<T>;
  subscribe: (topics: string[], handler: (topic: string, payload: unknown) => void) => () => void;
};

type AttachedModel = {
  workspaceId: string;
  workspaceRootPath: string;
  path: string;
  monacoLanguage: string;
  model: monaco.editor.ITextModel;
};

const noopTransport: LspBridgeTransport = {
  sendCommand: async () => null,
  subscribe: () => () => {},
};

export function createLspBridge(initialTransport: Partial<LspBridgeTransport> = {}) {
  let transport: LspBridgeTransport = {
    ...noopTransport,
    ...initialTransport,
  };
  const models = new Map<string, AttachedModel>();
  const diagnostics = createDiagnosticsController();
  const workspaceSubscriptions = new Map<string, { refCount: number; unsubscribe: () => void }>();
  const changeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const providers = createLspProviderRegistry({
    lookupModelMetadata: (model) => {
      const meta = models.get(model.uri.toString());
      if (!meta) {
        return undefined;
      }

      return {
        workspaceId: meta.workspaceId,
        workspaceRootPath: meta.workspaceRootPath,
        path: meta.path,
      };
    },
    requestDefinition: async ({ meta, line, column }) =>
      await transport.sendCommand<LspLocation[] | null>("lsp.definition", {
        workspaceId: meta.workspaceId,
        path: meta.path,
        line,
        column,
      }),
    requestHover: async ({ meta, line, column }) =>
      await transport.sendCommand<LspHoverResult | null>("lsp.hover", {
        workspaceId: meta.workspaceId,
        path: meta.path,
        line,
        column,
      }),
    requestReferences: async ({ meta, line, column }) =>
      await transport.sendCommand<LspLocation[] | null>("lsp.references", {
        workspaceId: meta.workspaceId,
        path: meta.path,
        line,
        column,
      }),
    requestDocumentSymbols: async ({ meta }) =>
      await transport.sendCommand<LspDocumentSymbol[] | null>("lsp.documentSymbols", {
        workspaceId: meta.workspaceId,
        path: meta.path,
      }),
  });

  function configure(nextTransport: Partial<LspBridgeTransport>): void {
    transport = {
      ...transport,
      ...nextTransport,
    };
  }

  function attachModel(input: AttachedModel): () => void {
    const serverKind = resolveLspServerKind(input.path, input.monacoLanguage);
    if (!serverKind) {
      return () => {};
    }

    const key = input.model.uri.toString();
    models.set(key, input);
    providers.register(input.monacoLanguage);
    ensureDiagnosticsSubscription(input.workspaceId, input.workspaceRootPath);

    void transport
      .sendCommand<LspSessionSummary | null>("lsp.ensureSession", {
        workspaceId: input.workspaceId,
        path: input.path,
      })
      .then((summary) => {
        if (!summary || summary.status !== "ready") {
          return null;
        }

        return transport.sendCommand("lsp.openDocument", {
          workspaceId: input.workspaceId,
          path: input.path,
          languageId: input.monacoLanguage,
          text: input.model.getValue(),
        });
      })
      .catch(() => null);

    const changeDisposable = input.model.onDidChangeContent(() => {
      clearTimeout(changeTimers.get(key));
      changeTimers.set(
        key,
        setTimeout(() => {
          void transport
            .sendCommand("lsp.changeDocument", {
              workspaceId: input.workspaceId,
              path: input.path,
              text: input.model.getValue(),
            })
            .catch(() => null);
        }, 75)
      );
    });

    return () => {
      clearTimeout(changeTimers.get(key));
      changeTimers.delete(key);
      models.delete(key);
      diagnostics.clearFile(input.workspaceRootPath, input.path);
      changeDisposable.dispose();
      releaseDiagnosticsSubscription(input.workspaceId);

      void transport
        .sendCommand("lsp.closeDocument", {
          workspaceId: input.workspaceId,
          path: input.path,
        })
        .catch(() => null);
    };
  }

  function ensureDiagnosticsSubscription(workspaceId: string, workspaceRootPath: string): void {
    const existing = workspaceSubscriptions.get(workspaceId);
    if (existing) {
      existing.refCount += 1;
      return;
    }

    const unsubscribe = transport.subscribe(
      [Topics.workspaceLspDiagnostics(workspaceId)],
      (_topic, payload) => {
        diagnostics.apply(workspaceRootPath, payload as LspDiagnosticsEvent);
      }
    );

    workspaceSubscriptions.set(workspaceId, { refCount: 1, unsubscribe });
  }

  function releaseDiagnosticsSubscription(workspaceId: string): void {
    const existing = workspaceSubscriptions.get(workspaceId);
    if (!existing) {
      return;
    }

    existing.refCount -= 1;
    if (existing.refCount <= 0) {
      existing.unsubscribe();
      workspaceSubscriptions.delete(workspaceId);
    }
  }

  return {
    configure,
    attachModel,
    provideDefinition: providers.provideDefinition,
    provideHover: providers.provideHover,
    provideReferences: providers.provideReferences,
    provideDocumentSymbols: providers.provideDocumentSymbols,
  };
}

export const globalLspBridge = createLspBridge();
```

```ts
// packages/web/src/features/code-editor/components/monaco-host.tsx
import { dispatchCommandAtom, wsClientAtom } from "../../../atoms/connection";

const dispatchCommand = useAtomValue(dispatchCommandAtom);
const wsClient = useAtomValue(wsClientAtom);

useEffect(() => {
  globalLspBridge.configure({
    sendCommand: async (op, args) => {
      const result = await dispatchCommand(op, args);
      return result.ok ? (result.data as unknown) : null;
    },
    subscribe: (topics, handler) =>
      wsClient?.subscribe(topics, (topic, payload) => handler(topic, payload)) ?? (() => {}),
  });
}, [dispatchCommand, wsClient]);
```

```ts
// packages/server/src/lsp/session.ts
private async withTimeout<T>(promise: Promise<T>): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("LSP request timed out")), this.deps.requestTimeoutMs)
    ),
  ]);
}

async definition(input: {
  path: string;
  line: number;
  column: number;
}): Promise<LspLocation[]> {
  try {
    return (await this.requestLocations(DefinitionRequest, input)) ?? [];
  } catch (error) {
    this.deps.logger.warn({ error }, "lsp definition request failed");
    return [];
  }
}

async references(input: {
  path: string;
  line: number;
  column: number;
}): Promise<LspLocation[]> {
  try {
    return (await this.requestLocations(ReferencesRequest, input)) ?? [];
  } catch (error) {
    this.deps.logger.warn({ error }, "lsp references request failed");
    return [];
  }
}

async hover(input: { path: string; line: number; column: number }): Promise<LspHoverResult | null> {
  try {
    const doc = this.documents.get(input.path);
    if (!doc || !this.connection) {
      return null;
    }

    const result = await this.withTimeout(
      this.connection.sendRequest(HoverRequest, {
        textDocument: { uri: doc.uri },
        position: { line: input.line - 1, character: input.column - 1 },
      })
    );

    if (!result) {
      return null;
    }

    return {
      contents: toHoverContents(result.contents),
      range: result.range ? toSharedRange(result.range) : undefined,
      version: doc.version,
    };
  } catch (error) {
    this.deps.logger.warn({ error }, "lsp hover request failed");
    return null;
  }
}

async documentSymbols(input: { path: string }): Promise<LspDocumentSymbol[]> {
  try {
    const doc = this.documents.get(input.path);
    if (!doc || !this.connection) {
      return [];
    }

    const result = await this.withTimeout(
      this.connection.sendRequest(DocumentSymbolsRequest, {
        textDocument: { uri: doc.uri },
      })
    );

    return Array.isArray(result) ? result.map(toSharedSymbol) : [];
  } catch (error) {
    this.deps.logger.warn({ error }, "lsp document symbols request failed");
    return [];
  }
}
```

- [ ] **Step 4: Run the diagnostics/provider/recovery tests**

Run: `pnpm exec vitest run packages/web/src/features/code-editor/lsp/bridge.test.tsx packages/web/src/features/code-editor/lsp/diagnostics.test.ts packages/web/src/features/code-editor/lsp/providers.test.ts packages/web/src/features/code-editor/components/monaco-host.test.tsx packages/server/src/lsp/session.test.ts packages/server/src/lsp/manager.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add \
  packages/web/src/features/code-editor/lsp/bridge.test.tsx \
  packages/web/src/features/code-editor/lsp/diagnostics.ts \
  packages/web/src/features/code-editor/lsp/diagnostics.test.ts \
  packages/web/src/features/code-editor/lsp/bridge.ts \
  packages/web/src/features/code-editor/lsp/providers.ts \
  packages/web/src/features/code-editor/lsp/providers.test.ts \
  packages/web/src/features/code-editor/components/monaco-host.tsx \
  packages/web/src/features/code-editor/components/monaco-host.test.tsx \
  packages/server/src/lsp/session.test.ts \
  packages/server/src/lsp/manager.test.ts
git commit -m "feat(web): add lsp diagnostics and read-only providers"
```

## Task 7: Add Acceptance Fixtures, Playwright Coverage, And Final Verification

**Files:**
- Create: `e2e/fixtures/lsp-workspace/shared.ts`
- Create: `e2e/fixtures/lsp-workspace/consumer.ts`
- Create: `e2e/fixtures/lsp-workspace/broken.ts`
- Create: `e2e/specs/workspace/lsp-editor.spec.ts`
- Modify: `e2e/playwright.config.ts`

- [ ] **Step 1: Write the failing Playwright acceptance spec for definition, hover, references, and diagnostics**

```ts
import { expect, test } from "@playwright/test";
import { openWorkspace } from "../helpers/workspace-session";

test.describe("workspace LSP editor", () => {
  test("go to definition opens the cross-file target", async ({ page }) => {
    await openWorkspace(page);

    await page.getByText("e2e").click();
    await page.getByText("fixtures").click();
    await page.getByText("lsp-workspace").click();
    await page.getByText("consumer.ts").click();

    await page.keyboard.press(process.platform === "darwin" ? "Meta+F12" : "F12");

    await expect(page.locator(".code-file-path")).toContainText("shared.ts");
    await expect(page.locator(".monaco-editor .selected-text")).toContainText("sharedValue");
  });

  test("hover, references, and diagnostics work without blocking editing", async ({ page }) => {
    await openWorkspace(page);

    await page.getByText("broken.ts").click();
    await expect(page.locator(".monaco-editor .squiggly-error")).toBeVisible();

    await page.getByText("shared.ts").click();
    await page.locator(".view-lines").hover({ position: { x: 140, y: 12 } });
    await expect(page.locator(".monaco-hover")).toContainText("sharedValue");

    await page.keyboard.press(process.platform === "darwin" ? "Shift+Meta+F12" : "Shift+F12");
    await expect(page.locator(".references-view")).toContainText("consumer.ts");
  });
});
```

- [ ] **Step 2: Run the Playwright spec to verify it fails**

Run: `pnpm --dir e2e exec playwright test --config playwright.config.ts specs/workspace/lsp-editor.spec.ts`

Expected: FAIL because the fixture files do not exist and the backend does not yet point TypeScript-family LSP traffic at the fake server

- [ ] **Step 3: Add the committed repo fixtures and Playwright LSP override**

```ts
// e2e/fixtures/lsp-workspace/shared.ts
export const sharedValue = 1;
```

```ts
// e2e/fixtures/lsp-workspace/consumer.ts
import { sharedValue } from "./shared";

export const computedValue = sharedValue + 1;
```

```ts
// e2e/fixtures/lsp-workspace/broken.ts
export const broken = missingSymbol;
```

```ts
// e2e/playwright.config.ts
const fakeLspServerPath = join(
  process.cwd(),
  "..",
  "packages/server/src/__tests__/fixtures/fake-lsp-server.js"
);

env: {
  ...process.env,
  HOST,
  PORT: String(SERVER_PORT),
  DATA_DIR: dataDir,
  RUNTIME_DIR: runtimeDir,
  NO_AUTH: "true",
  CODER_STUDIO_LSP_TYPESCRIPT_COMMAND: "node",
  CODER_STUDIO_LSP_TYPESCRIPT_ARGS_JSON: JSON.stringify([fakeLspServerPath]),
  CODER_STUDIO_E2E_PROVIDER_STATE_PATH: providerMockStatePath,
  CODER_STUDIO_E2E_PROVIDER_BIN_DIR: providerMockBinDir,
  CODER_STUDIO_E2E_PROVIDER_DEBUG_LOG_PATH: providerMockDebugLogPath,
  PATH: `${providerMockBinDir}:${process.env.PATH ?? ""}`,
},
```

- [ ] **Step 4: Run the full targeted verification suite**

Run:

```bash
pnpm exec vitest run \
  packages/core/src/domain/lsp.test.ts \
  packages/server/src/lsp/server-factory.test.ts \
  packages/server/src/lsp/document-store.test.ts \
  packages/server/src/lsp/session.test.ts \
  packages/server/src/lsp/manager.test.ts \
  packages/server/src/__tests__/lsp-commands.test.ts \
  packages/web/src/features/code-editor/lsp/bridge.test.tsx \
  packages/web/src/features/code-editor/lsp/providers.test.ts \
  packages/web/src/features/code-editor/lsp/diagnostics.test.ts \
  packages/web/src/features/code-editor/components/monaco-host.test.tsx
```

Expected: PASS

Run: `pnpm --dir e2e exec playwright test --config playwright.config.ts specs/workspace/lsp-editor.spec.ts`

Expected: PASS

Run: `pnpm exec biome check packages/core/src/domain/lsp.ts packages/server/src/lsp packages/server/src/commands/lsp.ts packages/web/src/features/code-editor/lsp packages/web/src/features/code-editor/components/monaco-host.tsx e2e/specs/workspace/lsp-editor.spec.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add \
  e2e/fixtures/lsp-workspace/shared.ts \
  e2e/fixtures/lsp-workspace/consumer.ts \
  e2e/fixtures/lsp-workspace/broken.ts \
  e2e/specs/workspace/lsp-editor.spec.ts \
  e2e/playwright.config.ts
git commit -m "test(e2e): cover generic lsp editor flows"
```

## Notes For Execution

- Keep `lsp.*` commands non-fatal for unsupported languages or unavailable server binaries. Return `null`/`[]` and log; do not break editing.
- Use one `LspManager` session per `workspaceId + serverKind`. Do not spawn one process per file or per editor tab.
- Keep the frontend bridge model-scoped and stateless beyond provider registration, metadata lookup, debounced sync, and diagnostics subscription bookkeeping.
- Reuse the existing `MonacoHost` cross-file open handler and `useOpenLocation` landing path. Do not introduce a second navigation state path.
- Do not claim repo-wide `tsc --noEmit` is clean unless you actually eliminate the existing unrelated failures first.
