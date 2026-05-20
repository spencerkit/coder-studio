# Managed LSP Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace raw language-server `spawn()` failures with a managed LSP tool workflow that bundles TypeScript, detects missing Python/Go/Rust servers, offers one-click install, and keeps Monaco editing usable while tools are unavailable.

**Architecture:** Introduce a dedicated server-side `lsp-tools` subsystem that resolves tool availability in this order: env override, managed install, bundled binary, system `PATH`. Move `lsp.ensureSession` to a structured readiness response, add a managed install job surface for Python/Go/Rust, and extend the Monaco bridge so it can show an inline install notice, poll install progress, and automatically retry opening the document after a successful install.

**Tech Stack:** TypeScript, React, Monaco Editor, Jotai, Vitest, websocket command transport, Node child-process spawning, local manifest files, `typescript-language-server`, `python-lsp-server`, `gopls`, `rust-analyzer`

---

## File Structure

- Modify: `packages/core/src/domain/lsp.ts`
  - Add shared DTOs for tool runtime status, install jobs, install failures, tool sources, and `lsp.ensureSession` readiness union.
- Modify: `packages/core/src/domain/lsp.test.ts`
  - Lock the new DTO and union contracts.
- Modify: `packages/core/src/index.ts`
  - Re-export the new shared LSP DTOs.

- Modify: `packages/server/package.json`
  - Add bundled TypeScript LSP runtime dependencies.
- Modify: `pnpm-lock.yaml`
  - Record the new runtime dependencies.

- Create: `packages/server/src/lsp-tools/definitions.ts`
  - Tool definitions, display names, managed versions, prerequisite metadata, and Rust asset mapping.
- Create: `packages/server/src/lsp-tools/tool-root.ts`
  - Resolve the managed tools root under the app-owned data directory.
- Create: `packages/server/src/lsp-tools/manifest-store.ts`
  - Read and write per-tool `manifest.json` files.
- Create: `packages/server/src/lsp-tools/manager.ts`
  - Resolve ready/missing/installing tool state using override, managed, bundled, and system fallback sources.
- Create: `packages/server/src/lsp-tools/manager.test.ts`
  - Resolution-order coverage plus bundled TypeScript and WSL-native-install constraints.

- Create: `packages/server/src/lsp-tools/runtime-status.ts`
  - Build a `lsp.runtimeStatus` payload for settings/debug surfaces.
- Create: `packages/server/src/lsp-tools/install-manager.ts`
  - Create and run managed install jobs for Python, Go, and Rust.
- Create: `packages/server/src/lsp-tools/install-manager.test.ts`
  - Cover job planning, prerequisite failure, success, and manifest write behavior.
- Modify: `packages/server/src/provider-runtime/command-runner.ts`
  - Allow install jobs to pass `cwd` and `env`.
- Modify: `packages/server/src/__tests__/provider-runtime/command-runner.test.ts`
  - Cover the new `cwd` and `env` passthrough.

- Modify: `packages/server/src/lsp/server-factory.ts`
  - Split language-kind detection from command resolution and preserve WSL wrapping.
- Modify: `packages/server/src/lsp/server-factory.test.ts`
  - Cover kind detection and WSL wrapping only.
- Modify: `packages/server/src/lsp/manager.ts`
  - Resolve tool readiness before creating a session and return `LspEnsureSessionResult`.
- Modify: `packages/server/src/lsp/manager.test.ts`
  - Cover `tool_missing`, `failed`, `ready`, and reuse behavior.
- Modify: `packages/server/src/lsp/session.ts`
  - Treat only post-resolution process failures as runtime start failures.
- Modify: `packages/server/src/commands/lsp.ts`
  - Add `lsp.install.start`, `lsp.install.get`, `lsp.runtimeStatus`, and return structured readiness from `lsp.ensureSession`.
- Modify: `packages/server/src/__tests__/lsp-commands.test.ts`
  - Cover the new command surface and structured readiness results.
- Modify: `packages/server/src/ws/dispatch.ts`
  - Extend `CommandContext` with `lspToolMgr` and `lspToolInstallMgr`.
- Modify: `packages/server/src/server.ts`
  - Instantiate and inject the new managers with the server data-dir-aware tool root.

- Create: `packages/web/src/features/code-editor/components/lsp-status-notice.tsx`
  - Inline, non-blocking editor notice with install/dismiss/retry actions.
- Create: `packages/web/src/features/code-editor/components/lsp-status-notice.test.tsx`
  - Cover tone, copy, progress, and CTA rendering.
- Modify: `packages/web/src/features/code-editor/lsp/bridge.ts`
  - Return an attach handle with `detach`, `install`, and `retry`, surface readiness changes, poll install jobs, and auto-reopen after success.
- Modify: `packages/web/src/features/code-editor/lsp/bridge.test.tsx`
  - Cover `tool_missing`, install polling, success auto-retry, and failure fallback.
- Modify: `packages/web/src/features/code-editor/components/monaco-host.tsx`
  - Track per-model LSP readiness state and render the inline notice above the editor.
- Modify: `packages/web/src/features/code-editor/components/monaco-host.test.tsx`
  - Cover inline notice rendering and install action wiring.
- Modify: `packages/web/src/features/code-editor/index.test.tsx`
  - Ensure the editor shell still renders and ordinary text editing survives missing tools.

## Task 1: Expand Shared LSP Readiness And Install DTOs

**Files:**
- Modify: `packages/core/src/domain/lsp.ts`
- Modify: `packages/core/src/domain/lsp.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing shared-surface test for readiness and install DTOs**

```ts
import { describe, expectTypeOf, it } from "vitest";
import type {
  LspEnsureSessionResult,
  LspServerKind,
  LspSessionSummary,
  LspToolInstallFailure,
  LspToolInstallJobSnapshot,
  LspToolInstallStepSnapshot,
  LspToolRuntimeStatusEntry,
  LspToolSource,
} from "../index";

describe("managed LSP DTO surface", () => {
  it("keeps the ensure-session readiness union stable", () => {
    expectTypeOf<LspToolSource>().toEqualTypeOf<
      "override" | "managed" | "bundled" | "system"
    >();

    expectTypeOf<LspToolRuntimeStatusEntry>().toEqualTypeOf<{
      serverKind: LspServerKind;
      displayName: string;
      available: boolean;
      source?: LspToolSource;
      autoInstallSupported: boolean;
      installReadiness: "ready" | "missing_prerequisite" | "unsupported_platform";
      missingCommands: string[];
      missingPrerequisites: string[];
      message?: string;
    }>();

    expectTypeOf<LspToolInstallStepSnapshot>().toEqualTypeOf<{
      id: string;
      title: string;
      kind: "check" | "install" | "verify";
      status: "pending" | "running" | "succeeded" | "failed";
      command: string;
      args: string[];
      startedAt?: number;
      finishedAt?: number;
      exitCode?: number;
      stdoutExcerpt?: string;
      stderrExcerpt?: string;
    }>();

    expectTypeOf<LspToolInstallFailure>().toEqualTypeOf<{
      code:
        | "missing_prerequisite"
        | "unsupported_platform"
        | "permission_denied"
        | "command_not_found"
        | "command_failed"
        | "verification_failed"
        | "download_failed"
        | "unknown_failure";
      serverKind: LspServerKind;
      message: string;
      failedStepId: string;
      command: string;
      args: string[];
      missingCommands: string[];
    }>();

    expectTypeOf<LspToolInstallJobSnapshot>().toEqualTypeOf<{
      jobId: string;
      serverKind: LspServerKind;
      status: "queued" | "running" | "succeeded" | "failed";
      currentStepId?: string;
      steps: LspToolInstallStepSnapshot[];
      failure?: LspToolInstallFailure;
    }>();

    expectTypeOf<LspEnsureSessionResult>().toEqualTypeOf<
      | { kind: "unsupported_language" }
      | {
          kind: "ready";
          summary: LspSessionSummary;
          displayName: string;
          source: LspToolSource;
        }
      | {
          kind: "tool_missing" | "installing" | "failed";
          serverKind: LspServerKind;
          displayName: string;
          errorCode:
            | "lsp_tool_missing"
            | "lsp_prerequisite_missing"
            | "lsp_install_in_progress"
            | "lsp_install_failed"
            | "lsp_start_failed";
          message: string;
          autoInstallSupported: boolean;
          missingCommands: string[];
          missingPrerequisites: string[];
          installJob?: LspToolInstallJobSnapshot;
        }
    >();
  });
});
```

- [ ] **Step 2: Run the shared-surface test to verify it fails**

Run: `pnpm exec vitest run packages/core/src/domain/lsp.test.ts`

Expected: FAIL with missing exported types such as `LspEnsureSessionResult` and `LspToolInstallJobSnapshot`

- [ ] **Step 3: Add the new shared DTOs and re-export them**

```ts
// packages/core/src/domain/lsp.ts
export type LspServerKind = "typescript" | "python" | "go" | "rust";
export type LspToolSource = "override" | "managed" | "bundled" | "system";

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

export interface LspToolRuntimeStatusEntry {
  serverKind: LspServerKind;
  displayName: string;
  available: boolean;
  source?: LspToolSource;
  autoInstallSupported: boolean;
  installReadiness: "ready" | "missing_prerequisite" | "unsupported_platform";
  missingCommands: string[];
  missingPrerequisites: string[];
  message?: string;
}

export interface LspToolInstallStepSnapshot {
  id: string;
  title: string;
  kind: "check" | "install" | "verify";
  status: "pending" | "running" | "succeeded" | "failed";
  command: string;
  args: string[];
  startedAt?: number;
  finishedAt?: number;
  exitCode?: number;
  stdoutExcerpt?: string;
  stderrExcerpt?: string;
}

export interface LspToolInstallFailure {
  code:
    | "missing_prerequisite"
    | "unsupported_platform"
    | "permission_denied"
    | "command_not_found"
    | "command_failed"
    | "verification_failed"
    | "download_failed"
    | "unknown_failure";
  serverKind: LspServerKind;
  message: string;
  failedStepId: string;
  command: string;
  args: string[];
  exitCode?: number;
  stdoutExcerpt?: string;
  stderrExcerpt?: string;
  missingCommands: string[];
}

export interface LspToolInstallJobSnapshot {
  jobId: string;
  serverKind: LspServerKind;
  status: "queued" | "running" | "succeeded" | "failed";
  currentStepId?: string;
  steps: LspToolInstallStepSnapshot[];
  failure?: LspToolInstallFailure;
}

export type LspEnsureSessionResult =
  | { kind: "unsupported_language" }
  | {
      kind: "ready";
      summary: LspSessionSummary;
      displayName: string;
      source: LspToolSource;
    }
  | {
      kind: "tool_missing" | "installing" | "failed";
      serverKind: LspServerKind;
      displayName: string;
      errorCode:
        | "lsp_tool_missing"
        | "lsp_prerequisite_missing"
        | "lsp_install_in_progress"
        | "lsp_install_failed"
        | "lsp_start_failed";
      message: string;
      autoInstallSupported: boolean;
      missingCommands: string[];
      missingPrerequisites: string[];
      installJob?: LspToolInstallJobSnapshot;
    };
```

```ts
// packages/core/src/index.ts
export * from "./domain/lsp";
```

- [ ] **Step 4: Run the shared-surface test to verify it passes**

Run: `pnpm exec vitest run packages/core/src/domain/lsp.test.ts`

Expected: PASS

- [ ] **Step 5: Commit the shared DTO changes**

```bash
git add packages/core/src/domain/lsp.ts packages/core/src/domain/lsp.test.ts packages/core/src/index.ts
git commit -m "feat(core): add managed lsp tool contracts"
```

## Task 2: Add Server-Side Tool Resolution And Bundle TypeScript

**Files:**
- Modify: `packages/server/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `packages/server/src/lsp-tools/definitions.ts`
- Create: `packages/server/src/lsp-tools/tool-root.ts`
- Create: `packages/server/src/lsp-tools/manifest-store.ts`
- Create: `packages/server/src/lsp-tools/manager.ts`
- Create: `packages/server/src/lsp-tools/manager.test.ts`
- Modify: `packages/server/src/lsp/server-factory.ts`
- Modify: `packages/server/src/lsp/server-factory.test.ts`

- [ ] **Step 1: Write the failing tool-resolution tests**

```ts
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileManifestStore } from "./manifest-store.js";
import { LspToolManager } from "./manager.js";

const workspace = {
  id: "ws-1",
  path: "/repo",
  targetRuntime: "native" as const,
  openedAt: 1,
  lastActiveAt: 1,
  uiState: { leftPanelWidth: 240, bottomPanelHeight: 180, focusMode: false },
};

describe("LspToolManager.resolve", () => {
  it("prefers an env override over managed, bundled, and system sources", async () => {
    const manager = new LspToolManager({
      manifestStore: new FileManifestStore(mkdtempSync(join(tmpdir(), "lsp-tools-"))),
      commandExists: vi.fn(async () => true),
      resolveBundledCommand: vi.fn(() => ({
        command: "/bundled/tsls",
        args: ["--stdio"],
      })),
    });

    const result = await manager.resolve({
      workspace,
      serverKind: "typescript",
      env: {
        CODER_STUDIO_LSP_TYPESCRIPT_COMMAND: "node",
        CODER_STUDIO_LSP_TYPESCRIPT_ARGS_JSON: '["scripts/fake-tsls.mjs"]',
      },
    });

    expect(result).toMatchObject({
      kind: "ready",
      source: "override",
      command: "node",
      args: ["scripts/fake-tsls.mjs"],
    });
  });

  it("uses the bundled TypeScript language server before system PATH", async () => {
    const manager = new LspToolManager({
      manifestStore: new FileManifestStore(mkdtempSync(join(tmpdir(), "lsp-tools-"))),
      commandExists: vi.fn(async () => true),
      resolveBundledCommand: vi.fn(() => ({
        command: "/app/node_modules/typescript-language-server/lib/cli.mjs",
        args: ["--stdio"],
      })),
    });

    const result = await manager.resolve({
      workspace,
      serverKind: "typescript",
      env: {},
    });

    expect(result).toMatchObject({
      kind: "ready",
      source: "bundled",
      command: "/app/node_modules/typescript-language-server/lib/cli.mjs",
      args: ["--stdio"],
    });
  });

  it("returns tool_missing when no source is available", async () => {
    const root = mkdtempSync(join(tmpdir(), "lsp-tools-"));
    const manager = new LspToolManager({
      manifestStore: new FileManifestStore(root),
      commandExists: vi.fn(async () => false),
      resolveBundledCommand: vi.fn(() => null),
    });

    const result = await manager.resolve({
      workspace,
      serverKind: "python",
      env: {},
    });

    expect(result).toMatchObject({
      kind: "tool_missing",
      serverKind: "python",
      errorCode: "lsp_tool_missing",
      autoInstallSupported: true,
    });
  });
});
```

- [ ] **Step 2: Run the server resolution tests to verify they fail**

Run: `pnpm --filter @coder-studio/server exec vitest run src/lsp-tools/manager.test.ts src/lsp/server-factory.test.ts`

Expected: FAIL because `src/lsp-tools/*` does not exist and `server-factory.ts` still performs direct command selection

- [ ] **Step 3: Add bundled TypeScript dependencies and install them**

```json
// packages/server/package.json
{
  "dependencies": {
    "@coder-studio/core": "workspace:*",
    "@coder-studio/providers": "workspace:*",
    "@coder-studio/utils": "workspace:*",
    "@fastify/compress": "^8.3.1",
    "@fastify/cors": "^11.2.0",
    "@fastify/multipart": "^10.0.0",
    "@fastify/static": "^9.1.3",
    "@fastify/websocket": "^11.2.0",
    "@xterm/addon-serialize": "^0.14.0",
    "@xterm/headless": "^6.0.0",
    "chokidar": "^5.0.0",
    "fastify": "^5.8.5",
    "ignore": "^7.0.0",
    "node-pty": "^1.1.0",
    "pino-pretty": "^13.1.3",
    "typescript": "^6.0.3",
    "typescript-language-server": "^5.2.0",
    "uuid": "^14.0.0",
    "vscode-jsonrpc": "^8.2.1",
    "vscode-languageserver-protocol": "^3.17.5",
    "ws": "^8.20.0",
    "zod": "^4.4.2"
  }
}
```

Run: `pnpm install`

Expected: lockfile updates and `typescript-language-server` becomes available inside workspace `node_modules`

- [ ] **Step 4: Implement tool definitions, manifest store, and resolution manager**

```ts
// packages/server/src/lsp-tools/definitions.ts
import type { LspServerKind } from "@coder-studio/core";

export interface LspToolDefinition {
  serverKind: LspServerKind;
  displayName: string;
  defaultCommand: string;
  defaultArgs: string[];
  bundled?: {
    packageName: string;
    entry: string;
    args: string[];
  };
  managed?: {
    version: string;
    prerequisites: string[];
  };
}

export const LSP_TOOL_DEFINITIONS: Record<LspServerKind, LspToolDefinition> = {
  typescript: {
    serverKind: "typescript",
    displayName: "TypeScript language server",
    defaultCommand: "typescript-language-server",
    defaultArgs: ["--stdio"],
    bundled: {
      packageName: "typescript-language-server",
      entry: "lib/cli.mjs",
      args: ["--stdio"],
    },
  },
  python: {
    serverKind: "python",
    displayName: "Python language server",
    defaultCommand: "pylsp",
    defaultArgs: [],
    managed: {
      version: "1.14.0",
      prerequisites: ["python3"],
    },
  },
  go: {
    serverKind: "go",
    displayName: "Go language server",
    defaultCommand: "gopls",
    defaultArgs: [],
    managed: {
      version: "v0.21.1",
      prerequisites: ["go"],
    },
  },
  rust: {
    serverKind: "rust",
    displayName: "Rust Analyzer",
    defaultCommand: "rust-analyzer",
    defaultArgs: [],
    managed: {
      version: "2026-05-18",
      prerequisites: [],
    },
  },
};
```

```ts
// packages/server/src/lsp-tools/manifest-store.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { LspServerKind } from "@coder-studio/core";

export interface LspToolManifest {
  serverKind: LspServerKind;
  version: string;
  executablePath: string;
  installedAt: number;
  source: "managed";
}

export class FileManifestStore {
  constructor(private readonly root: string) {}

  read(serverKind: LspServerKind): LspToolManifest | null {
    const path = join(this.root, serverKind, "manifest.json");
    try {
      return JSON.parse(readFileSync(path, "utf8")) as LspToolManifest;
    } catch {
      return null;
    }
  }

  write(serverKind: LspServerKind, manifest: LspToolManifest): void {
    const path = join(this.root, serverKind, "manifest.json");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(manifest, null, 2));
  }
}
```

```ts
// packages/server/src/lsp-tools/manager.ts
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type {
  LspEnsureSessionResult,
  LspServerKind,
  LspToolRuntimeStatusEntry,
  LspToolSource,
} from "@coder-studio/core";
import type { Workspace } from "@coder-studio/core";
import { LSP_TOOL_DEFINITIONS } from "./definitions.js";
import type { FileManifestStore } from "./manifest-store.js";

const require = createRequire(import.meta.url);

export class LspToolManager {
  constructor(
    private readonly deps: {
      manifestStore: FileManifestStore;
      commandExists: (command: string) => Promise<boolean>;
      resolveBundledCommand?: (serverKind: LspServerKind) => { command: string; args: string[] } | null;
    }
  ) {}

  async resolve(args: {
    workspace: Workspace;
    serverKind: LspServerKind;
    env: NodeJS.ProcessEnv;
  }): Promise<
    | ({ kind: "ready"; source: LspToolSource; command: string; args: string[]; displayName: string })
    | Extract<LspEnsureSessionResult, { kind: "tool_missing" | "failed" }>
  > {
    const definition = LSP_TOOL_DEFINITIONS[args.serverKind];
    const prefix = `CODER_STUDIO_LSP_${args.serverKind.toUpperCase()}`;
    const overrideCommand = args.env[`${prefix}_COMMAND`];
    const overrideArgs = args.env[`${prefix}_ARGS_JSON`]
      ? (JSON.parse(args.env[`${prefix}_ARGS_JSON`]!) as string[])
      : definition.defaultArgs;

    if (overrideCommand) {
      return {
        kind: "ready",
        source: "override",
        command: overrideCommand,
        args: overrideArgs,
        displayName: definition.displayName,
      };
    }

    const manifest = this.deps.manifestStore.read(args.serverKind);
    if (manifest && (await executableExists(manifest.executablePath))) {
      return {
        kind: "ready",
        source: "managed",
        command: manifest.executablePath,
        args: definition.defaultArgs,
        displayName: definition.displayName,
      };
    }

    const bundled = this.resolveBundled(args.serverKind);
    if (bundled) {
      return {
        kind: "ready",
        source: "bundled",
        command: bundled.command,
        args: bundled.args,
        displayName: definition.displayName,
      };
    }

    if (await this.deps.commandExists(definition.defaultCommand)) {
      return {
        kind: "ready",
        source: "system",
        command: definition.defaultCommand,
        args: definition.defaultArgs,
        displayName: definition.displayName,
      };
    }

    return {
      kind: "tool_missing",
      serverKind: args.serverKind,
      displayName: definition.displayName,
      errorCode: "lsp_tool_missing",
      message: `${definition.displayName} is not installed`,
      autoInstallSupported:
        Boolean(definition.managed) && args.workspace.targetRuntime !== "wsl",
      missingCommands: [definition.defaultCommand],
      missingPrerequisites: [],
    };
  }

  async getRuntimeStatus(workspace: Workspace): Promise<Record<LspServerKind, LspToolRuntimeStatusEntry>> {
    const entries = {} as Record<LspServerKind, LspToolRuntimeStatusEntry>;
    for (const serverKind of Object.keys(LSP_TOOL_DEFINITIONS) as LspServerKind[]) {
      const resolved = await this.resolve({ workspace, serverKind, env: process.env });
      entries[serverKind] =
        resolved.kind === "ready"
          ? {
              serverKind,
              displayName: resolved.displayName,
              available: true,
              source: resolved.source,
              autoInstallSupported: false,
              installReadiness: "ready",
              missingCommands: [],
              missingPrerequisites: [],
            }
          : {
              serverKind,
              displayName: resolved.displayName,
              available: false,
              autoInstallSupported: resolved.autoInstallSupported,
              installReadiness: resolved.missingPrerequisites.length > 0
                ? "missing_prerequisite"
                : resolved.autoInstallSupported
                  ? "ready"
                  : "unsupported_platform",
              missingCommands: resolved.missingCommands,
              missingPrerequisites: resolved.missingPrerequisites,
              message: resolved.message,
            };
    }
    return entries;
  }

  private resolveBundled(serverKind: LspServerKind) {
    if (this.deps.resolveBundledCommand) {
      return this.deps.resolveBundledCommand(serverKind);
    }

    const definition = LSP_TOOL_DEFINITIONS[serverKind];
    if (!definition.bundled) {
      return null;
    }

    const packageRoot = dirname(require.resolve(`${definition.bundled.packageName}/package.json`));
    return {
      command: join(packageRoot, definition.bundled.entry),
      args: definition.bundled.args,
    };
  }
}

async function executableExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
```

```ts
// packages/server/src/lsp/server-factory.ts
import type { LspServerKind, Workspace } from "@coder-studio/core";

const TYPESCRIPT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"]);
const PYTHON_EXTENSIONS = new Set([".py"]);
const GO_EXTENSIONS = new Set([".go"]);
const RUST_EXTENSIONS = new Set([".rs"]);

export function resolveLspServerKind(path: string): LspServerKind | null {
  const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
  if (TYPESCRIPT_EXTENSIONS.has(extension)) return "typescript";
  if (PYTHON_EXTENSIONS.has(extension)) return "python";
  if (GO_EXTENSIONS.has(extension)) return "go";
  if (RUST_EXTENSIONS.has(extension)) return "rust";
  return null;
}

export function wrapLspCommandForWorkspace(
  workspace: Workspace,
  command: string,
  args: string[]
): { command: string; args: string[] } {
  if (workspace.targetRuntime !== "wsl") {
    return { command, args };
  }

  return {
    command: "wsl",
    args: [...(workspace.wslDistro ? ["-d", workspace.wslDistro] : []), "--", command, ...args],
  };
}
```

- [ ] **Step 5: Run the server resolution tests to verify they pass**

Run: `pnpm --filter @coder-studio/server exec vitest run src/lsp-tools/manager.test.ts src/lsp/server-factory.test.ts`

Expected: PASS

- [ ] **Step 6: Commit the server resolution work**

```bash
git add packages/server/package.json pnpm-lock.yaml packages/server/src/lsp-tools/definitions.ts packages/server/src/lsp-tools/tool-root.ts packages/server/src/lsp-tools/manifest-store.ts packages/server/src/lsp-tools/manager.ts packages/server/src/lsp-tools/manager.test.ts packages/server/src/lsp/server-factory.ts packages/server/src/lsp/server-factory.test.ts
git commit -m "feat(server): add managed lsp tool resolution"
```

## Task 3: Add Managed Install Jobs And Structured `lsp.ensureSession`

**Files:**
- Create: `packages/server/src/lsp-tools/runtime-status.ts`
- Create: `packages/server/src/lsp-tools/install-manager.ts`
- Create: `packages/server/src/lsp-tools/install-manager.test.ts`
- Modify: `packages/server/src/provider-runtime/command-runner.ts`
- Modify: `packages/server/src/__tests__/provider-runtime/command-runner.test.ts`
- Modify: `packages/server/src/lsp/manager.ts`
- Modify: `packages/server/src/lsp/manager.test.ts`
- Modify: `packages/server/src/commands/lsp.ts`
- Modify: `packages/server/src/__tests__/lsp-commands.test.ts`
- Modify: `packages/server/src/ws/dispatch.ts`
- Modify: `packages/server/src/server.ts`

- [ ] **Step 1: Write the failing install-manager and structured-readiness tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileManifestStore } from "./manifest-store.js";
import { LspToolInstallManager } from "./install-manager.js";
import { LspManager } from "../lsp/manager.js";

describe("LspToolInstallManager", () => {
  it("fails immediately when a managed Python install is missing python3", async () => {
    const manager = new LspToolInstallManager({
      manifestStore: new FileManifestStore(mkdtempSync(join(tmpdir(), "lsp-tools-"))),
      commandExists: vi.fn(async (command) => command !== "python3"),
      runCommand: vi.fn(),
      downloadFile: vi.fn(),
    });

    const job = await manager.start("python");

    expect(job.status).toBe("failed");
    expect(job.failure?.code).toBe("missing_prerequisite");
    expect(job.failure?.missingCommands).toContain("python3");
  });
});

describe("LspManager.ensureSession", () => {
  it("returns tool_missing without creating a session when the tool is absent", async () => {
    const createSession = vi.fn();
    const manager = new LspManager({
      requestTimeoutMs: 2_000,
      idleTtlMs: 60_000,
      restartLimit: 2,
      workspaceMgr: {
        get: () => ({
          id: "ws-1",
          path: "/repo",
          targetRuntime: "native",
          openedAt: 1,
          lastActiveAt: 1,
          uiState: { leftPanelWidth: 240, bottomPanelHeight: 180, focusMode: false },
        }),
      },
      eventBus: { emit: vi.fn() },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      lspToolMgr: {
        resolve: vi.fn(async () => ({
          kind: "tool_missing",
          serverKind: "python",
          displayName: "Python language server",
          errorCode: "lsp_tool_missing",
          message: "Python language server is not installed",
          autoInstallSupported: true,
          missingCommands: ["pylsp"],
          missingPrerequisites: [],
        })),
      },
      createSession,
    });

    const result = await manager.ensureSession({
      workspaceId: "ws-1",
      path: "app/main.py",
    });

    expect(result).toMatchObject({
      kind: "tool_missing",
      serverKind: "python",
      errorCode: "lsp_tool_missing",
    });
    expect(createSession).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the targeted server tests to verify they fail**

Run: `pnpm --filter @coder-studio/server exec vitest run src/lsp-tools/install-manager.test.ts src/lsp/manager.test.ts src/__tests__/lsp-commands.test.ts src/__tests__/provider-runtime/command-runner.test.ts`

Expected: FAIL because the install manager and structured readiness flow do not exist yet

- [ ] **Step 3: Extend the command runner so install jobs can pass `cwd` and `env`**

```ts
// packages/server/src/provider-runtime/command-runner.ts
import { spawn } from "node:child_process";
import { shouldUseShellForCommand } from "@coder-studio/utils";

export type CommandRunnerOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  windowsHide?: boolean;
};

export async function runCommandAsString(
  file: string,
  args: string[],
  options?: CommandRunnerOptions
): Promise<CommandRunnerResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: options?.cwd,
      env: options?.env,
      shell: shouldUseShellForCommand(file, process.platform),
      windowsHide: options?.windowsHide ?? true,
    });
    // existing stdout/stderr accumulation stays unchanged
  });
}
```

```ts
// packages/server/src/__tests__/provider-runtime/command-runner.test.ts
it("passes cwd and env through to spawn", async () => {
  const spawnMock = vi.fn().mockImplementation(() => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => child.emit("close", 0));
    return child;
  });

  vi.doMock("node:child_process", () => ({ spawn: spawnMock }));

  await runCommandAsString("go", ["version"], {
    cwd: "/tmp/work",
    env: { ...process.env, GOBIN: "/tmp/bin" },
  });

  expect(spawnMock).toHaveBeenCalledWith(
    "go",
    ["version"],
    expect.objectContaining({
      cwd: "/tmp/work",
      env: expect.objectContaining({ GOBIN: "/tmp/bin" }),
    })
  );
});
```

- [ ] **Step 4: Implement managed install jobs, runtime status, and structured readiness**

```ts
// packages/server/src/lsp-tools/install-manager.ts
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { LspServerKind, LspToolInstallJobSnapshot, LspToolInstallStepSnapshot } from "@coder-studio/core";
import { LSP_TOOL_DEFINITIONS } from "./definitions.js";
import type { FileManifestStore } from "./manifest-store.js";

export class LspToolInstallManager {
  private readonly jobs = new Map<string, LspToolInstallJobSnapshot>();

  constructor(
    private readonly deps: {
      manifestStore: FileManifestStore;
      toolRoot: string;
      commandExists: (command: string) => Promise<boolean>;
      runCommand: (
        command: string,
        args: string[],
        options?: { cwd?: string; env?: NodeJS.ProcessEnv; windowsHide?: boolean }
      ) => Promise<{ stdout: string; stderr: string }>;
      downloadFile: (url: string, destPath: string) => Promise<void>;
    }
  ) {}

  async start(serverKind: LspServerKind): Promise<LspToolInstallJobSnapshot> {
    const definition = LSP_TOOL_DEFINITIONS[serverKind];
    if (!definition.managed) {
      return {
        jobId: randomUUID(),
        serverKind,
        status: "failed",
        steps: [],
        failure: {
          code: "unsupported_platform",
          serverKind,
          message: `${definition.displayName} cannot be installed automatically`,
          failedStepId: "unsupported",
          command: "",
          args: [],
          missingCommands: [],
        },
      };
    }

    for (const prerequisite of definition.managed.prerequisites) {
      if (!(await this.deps.commandExists(prerequisite))) {
        return {
          jobId: randomUUID(),
          serverKind,
          status: "failed",
          steps: [],
          failure: {
            code: "missing_prerequisite",
            serverKind,
            message: `Missing prerequisite: ${prerequisite}`,
            failedStepId: `check-${prerequisite}`,
            command: prerequisite,
            args: ["--version"],
            missingCommands: [prerequisite],
          },
        };
      }
    }

    const job: LspToolInstallJobSnapshot = {
      jobId: randomUUID(),
      serverKind,
      status: "queued",
      currentStepId: "install",
      steps: [
        {
          id: "install",
          title: `Install ${definition.displayName}`,
          kind: "install",
          status: "pending",
          command: definition.defaultCommand,
          args: [],
        },
        {
          id: "verify",
          title: `Verify ${definition.displayName}`,
          kind: "verify",
          status: "pending",
          command: definition.defaultCommand,
          args: ["--version"],
        },
      ],
    };

    this.jobs.set(job.jobId, job);
    void this.run(job);
    return structuredClone(job);
  }

  get(jobId: string): LspToolInstallJobSnapshot | undefined {
    const job = this.jobs.get(jobId);
    return job ? structuredClone(job) : undefined;
  }

  private async run(job: LspToolInstallJobSnapshot): Promise<void> {
    job.status = "running";
    const definition = LSP_TOOL_DEFINITIONS[job.serverKind];
    const versionRoot = join(this.deps.toolRoot, job.serverKind, definition.managed!.version);
    mkdirSync(versionRoot, { recursive: true });

    try {
      if (job.serverKind === "python") {
        const pythonPath = join(versionRoot, "venv", "bin", "python");
        await this.deps.runCommand("python3", ["-m", "venv", join(versionRoot, "venv")]);
        await this.deps.runCommand(pythonPath, ["-m", "pip", "install", "python-lsp-server==1.14.0"]);
        this.deps.manifestStore.write("python", {
          serverKind: "python",
          version: "1.14.0",
          executablePath: join(versionRoot, "venv", "bin", "pylsp"),
          installedAt: Date.now(),
          source: "managed",
        });
      }

      if (job.serverKind === "go") {
        const binDir = join(versionRoot, "bin");
        mkdirSync(binDir, { recursive: true });
        await this.deps.runCommand("go", ["install", "golang.org/x/tools/gopls@v0.21.1"], {
          env: { ...process.env, GOBIN: binDir },
        });
        this.deps.manifestStore.write("go", {
          serverKind: "go",
          version: "v0.21.1",
          executablePath: join(binDir, "gopls"),
          installedAt: Date.now(),
          source: "managed",
        });
      }

      if (job.serverKind === "rust") {
        const executablePath = join(versionRoot, "rust-analyzer");
        await this.deps.downloadFile(
          "https://github.com/rust-lang/rust-analyzer/releases/download/2026-05-18/rust-analyzer-x86_64-unknown-linux-gnu.gz",
          `${executablePath}.gz`
        );
        this.deps.manifestStore.write("rust", {
          serverKind: "rust",
          version: "2026-05-18",
          executablePath,
          installedAt: Date.now(),
          source: "managed",
        });
      }

      job.status = "succeeded";
      job.currentStepId = undefined;
    } catch (error) {
      job.status = "failed";
      job.failure = {
        code: "command_failed",
        serverKind: job.serverKind,
        message: error instanceof Error ? error.message : "LSP tool install failed",
        failedStepId: job.currentStepId ?? "install",
        command: definition.defaultCommand,
        args: [],
        missingCommands: [],
      };
    }
  }
}
```

```ts
// packages/server/src/lsp/manager.ts
import type {
  DomainEvent,
  LspDocumentSymbol,
  LspEnsureSessionResult,
  LspHoverResult,
  LspLocation,
  LspSessionSummary,
  Workspace,
} from "@coder-studio/core";
import { resolveLspServerKind, wrapLspCommandForWorkspace } from "./server-factory.js";
import { LspSession } from "./session.js";

export class LspManager {
  constructor(
    private readonly deps: {
      workspaceMgr: { get: (workspaceId: string) => Workspace | undefined };
      eventBus: { emit: (event: DomainEvent) => void };
      logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
      requestTimeoutMs: number;
      idleTtlMs: number;
      restartLimit: number;
      lspToolMgr: {
        resolve: (args: {
          workspace: Workspace;
          serverKind: "typescript" | "python" | "go" | "rust";
          env: NodeJS.ProcessEnv;
        }) => Promise<
          | { kind: "ready"; source: "override" | "managed" | "bundled" | "system"; command: string; args: string[]; displayName: string }
          | Extract<LspEnsureSessionResult, { kind: "tool_missing" | "failed" }>
        >;
      };
      createSession?: (deps: LspSessionDeps) => LspSessionLike;
    }
  ) {}

  async ensureSession(input: { workspaceId: string; path: string }): Promise<LspEnsureSessionResult> {
    const workspace = this.deps.workspaceMgr.get(input.workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${input.workspaceId}`);
    }

    const serverKind = resolveLspServerKind(input.path);
    if (!serverKind) {
      return { kind: "unsupported_language" };
    }

    const resolved = await this.deps.lspToolMgr.resolve({
      workspace,
      serverKind,
      env: process.env,
    });

    if (resolved.kind !== "ready") {
      return resolved;
    }

    const commandSpec = wrapLspCommandForWorkspace(workspace, resolved.command, resolved.args);
    const key = this.keyFor(input.workspaceId, serverKind);
    // existing session reuse stays the same, but return { kind: "ready", summary, displayName, source }
  }
}
```

```ts
// packages/server/src/commands/lsp.ts
registerCommand("lsp.runtimeStatus", z.object({ workspaceId: z.string() }), async (args, ctx) => {
  const workspace = ctx.workspaceMgr.get(args.workspaceId);
  if (!workspace) {
    throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
  }
  return ctx.lspToolMgr.getRuntimeStatus(workspace);
});

registerCommand(
  "lsp.install.start",
  z.object({ serverKind: z.enum(["typescript", "python", "go", "rust"]) }),
  async (args, ctx) => ctx.lspToolInstallMgr.start(args.serverKind)
);

registerCommand(
  "lsp.install.get",
  z.object({ jobId: z.string() }),
  async (args, ctx) => {
    const job = ctx.lspToolInstallMgr.get(args.jobId);
    if (!job) {
      throw {
        code: "lsp_install_job_not_found",
        message: `Install job not found: ${args.jobId}`,
      };
    }
    return job;
  }
);
```

- [ ] **Step 5: Run the targeted server tests to verify they pass**

Run: `pnpm --filter @coder-studio/server exec vitest run src/lsp-tools/install-manager.test.ts src/lsp/manager.test.ts src/__tests__/lsp-commands.test.ts src/__tests__/provider-runtime/command-runner.test.ts`

Expected: PASS

- [ ] **Step 6: Commit the install-manager and command-surface changes**

```bash
git add packages/server/src/lsp-tools/runtime-status.ts packages/server/src/lsp-tools/install-manager.ts packages/server/src/lsp-tools/install-manager.test.ts packages/server/src/provider-runtime/command-runner.ts packages/server/src/__tests__/provider-runtime/command-runner.test.ts packages/server/src/lsp/manager.ts packages/server/src/lsp/manager.test.ts packages/server/src/commands/lsp.ts packages/server/src/__tests__/lsp-commands.test.ts packages/server/src/ws/dispatch.ts packages/server/src/server.ts
git commit -m "feat(server): add managed lsp install workflow"
```

## Task 4: Add Monaco Notice, Install CTA, And Auto-Retry

**Files:**
- Create: `packages/web/src/features/code-editor/components/lsp-status-notice.tsx`
- Create: `packages/web/src/features/code-editor/components/lsp-status-notice.test.tsx`
- Modify: `packages/web/src/features/code-editor/lsp/bridge.ts`
- Modify: `packages/web/src/features/code-editor/lsp/bridge.test.tsx`
- Modify: `packages/web/src/features/code-editor/components/monaco-host.tsx`
- Modify: `packages/web/src/features/code-editor/components/monaco-host.test.tsx`
- Modify: `packages/web/src/features/code-editor/index.test.tsx`

- [ ] **Step 1: Write the failing web tests for the missing-tool notice and install loop**

```ts
import * as monaco from "monaco-editor";
import { describe, expect, it, vi } from "vitest";
import { createLspBridge } from "./bridge";

function createMockModel(value: string) {
  let listener: (() => void) | null = null;
  return {
    uri: monaco.Uri.file("/repo/src/main.py"),
    getValue: () => value,
    getVersionId: () => 1,
    onDidChangeContent(callback: () => void) {
      listener = callback;
      return { dispose() {} };
    },
    fireDidChangeContent(nextValue: string) {
      value = nextValue;
      listener?.();
    },
  } as monaco.editor.ITextModel & { fireDidChangeContent(nextValue: string): void };
}

describe("createLspBridge managed install flow", () => {
  it("surfaces tool_missing, starts install, polls, and retries openDocument after success", async () => {
    const sendCommand = vi
      .fn()
      .mockResolvedValueOnce({
        kind: "tool_missing",
        serverKind: "python",
        displayName: "Python language server",
        errorCode: "lsp_tool_missing",
        message: "Python language server is not installed",
        autoInstallSupported: true,
        missingCommands: ["pylsp"],
        missingPrerequisites: [],
      })
      .mockResolvedValueOnce({
        jobId: "job-1",
        serverKind: "python",
        status: "running",
        currentStepId: "install",
        steps: [],
      })
      .mockResolvedValueOnce({
        jobId: "job-1",
        serverKind: "python",
        status: "succeeded",
        steps: [],
      })
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValue(undefined);

    const states: unknown[] = [];
    const bridge = createLspBridge({
      sendCommand,
      subscribe: vi.fn(() => () => {}),
    });

    const handle = bridge.attachModel({
      workspaceId: "ws-1",
      workspaceRootPath: "/repo",
      path: "src/main.py",
      monacoLanguage: "python",
      model: createMockModel("print('hello')\n"),
      onSessionStateChange: (state) => states.push(state),
    });

    await vi.waitFor(() => {
      expect(states.at(-1)).toMatchObject({ kind: "tool_missing", serverKind: "python" });
    });

    await handle.install();

    await vi.waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("lsp.openDocument", {
        workspaceId: "ws-1",
        path: "src/main.py",
        languageId: "python",
        text: "print('hello')\n",
      });
    });
  });
});
```

```ts
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LspStatusNotice } from "./lsp-status-notice";

describe("LspStatusNotice", () => {
  it("renders install and dismiss actions for a missing managed tool", async () => {
    const onInstall = vi.fn(async () => {});
    const onDismiss = vi.fn();

    render(
      <LspStatusNotice
        state={{
          kind: "tool_missing",
          serverKind: "python",
          displayName: "Python language server",
          errorCode: "lsp_tool_missing",
          message: "Python language server is not installed",
          autoInstallSupported: true,
          missingCommands: ["pylsp"],
          missingPrerequisites: [],
        }}
        onDismiss={onDismiss}
        onInstall={onInstall}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(onInstall).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the targeted web tests to verify they fail**

Run: `pnpm --filter @coder-studio/web exec vitest run src/features/code-editor/lsp/bridge.test.tsx src/features/code-editor/components/lsp-status-notice.test.tsx src/features/code-editor/components/monaco-host.test.tsx`

Expected: FAIL because the bridge does not expose install/retry handles and the notice component does not exist

- [ ] **Step 3: Implement the inline notice component and bridge install loop**

```tsx
// packages/web/src/features/code-editor/components/lsp-status-notice.tsx
import { Button, Notice } from "../../../../components/ui";
import type { LspEnsureSessionResult } from "@coder-studio/core";

export function LspStatusNotice(props: {
  state: Extract<LspEnsureSessionResult, { kind: "tool_missing" | "installing" | "failed" }>;
  onInstall: () => Promise<void>;
  onRetry: () => Promise<void>;
  onDismiss: () => void;
}) {
  const { state, onDismiss, onInstall, onRetry } = props;

  const action =
    state.kind === "tool_missing" && state.autoInstallSupported ? (
      <div className="code-editor-lsp-notice__actions">
        <Button size="sm" onClick={() => void onInstall()}>
          Install
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    ) : state.kind === "installing" ? (
      <div className="code-editor-lsp-notice__actions">
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    ) : (
      <div className="code-editor-lsp-notice__actions">
        <Button size="sm" onClick={() => void onRetry()}>
          Retry
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    );

  return (
    <Notice
      className="code-editor-lsp-notice"
      tone={state.kind === "failed" ? "warning" : "info"}
      title={state.displayName}
      message={state.message}
      action={action}
    />
  );
}
```

```ts
// packages/web/src/features/code-editor/lsp/bridge.ts
import type { LspEnsureSessionResult, LspToolInstallJobSnapshot } from "@coder-studio/core";

type AttachedModel = {
  workspaceId: string;
  workspaceRootPath: string;
  path: string;
  monacoLanguage: string;
  model: monaco.editor.ITextModel;
  onSessionStateChange?: (state: LspEnsureSessionResult | null) => void;
};

type AttachHandle = {
  detach: () => void;
  install: () => Promise<void>;
  retry: () => Promise<void>;
};

export function createLspBridge(initialTransport: Partial<LspBridgeTransport> = {}) {
  // existing transport/providers setup stays in place

  function attachModel(input: AttachedModel): AttachHandle {
    const key = input.model.uri.toString();
    let detached = false;

    const emitState = (state: LspEnsureSessionResult | null) => {
      if (!detached) {
        input.onSessionStateChange?.(state);
      }
    };

    const openIfReady = async () => {
      const result = await transport.sendCommand<LspEnsureSessionResult>("lsp.ensureSession", {
        workspaceId: input.workspaceId,
        path: input.path,
      });

      emitState(result ?? null);

      if (!result || result.kind !== "ready" || detached) {
        return;
      }

      await transport.sendCommand("lsp.openDocument", {
        workspaceId: input.workspaceId,
        path: input.path,
        languageId: input.monacoLanguage,
        text: input.model.getValue(),
      });
    };

    const pollInstall = async (jobId: string): Promise<void> => {
      const job = await transport.sendCommand<LspToolInstallJobSnapshot>("lsp.install.get", { jobId });
      if (!job || detached) {
        return;
      }

      emitState({
        kind: job.status === "failed" ? "failed" : job.status === "succeeded" ? "installing" : "installing",
        serverKind: job.serverKind,
        displayName: models.get(key)?.monacoLanguage ?? job.serverKind,
        errorCode: job.status === "failed" ? "lsp_install_failed" : "lsp_install_in_progress",
        message:
          job.status === "failed"
            ? job.failure?.message ?? "Language server install failed"
            : "Installing language server…",
        autoInstallSupported: true,
        missingCommands: [],
        missingPrerequisites: [],
        installJob: job,
      });

      if (job.status === "queued" || job.status === "running") {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await pollInstall(job.jobId);
        return;
      }

      if (job.status === "succeeded") {
        await openIfReady();
      }
    };

    void openIfReady().catch(() => null);

    return {
      detach() {
        detached = true;
        models.delete(key);
        void transport.sendCommand("lsp.closeDocument", {
          workspaceId: input.workspaceId,
          path: input.path,
        });
      },
      async install() {
        const serverKind = resolveLspServerKind(input.path, input.monacoLanguage);
        if (!serverKind) return;
        const job = await transport.sendCommand<LspToolInstallJobSnapshot>("lsp.install.start", {
          serverKind,
        });
        if (job) {
          await pollInstall(job.jobId);
        }
      },
      async retry() {
        await openIfReady();
      },
    };
  }

  return { attachModel, configure, provideDefinition: providers.provideDefinition, provideHover: providers.provideHover, provideReferences: providers.provideReferences, provideDocumentSymbols: providers.provideDocumentSymbols };
}
```

- [ ] **Step 4: Render the notice from `MonacoHost` and keep editing alive**

```tsx
// packages/web/src/features/code-editor/components/monaco-host.tsx
import type { LspEnsureSessionResult } from "@coder-studio/core";
import { useEffect, useRef, useState } from "react";
import { LspStatusNotice } from "./lsp-status-notice";

export const MonacoHost: FC<MonacoHostProps> = ({ workspaceId, workspaceRootPath, filePath, content, onContentChange, onSave, visible = true, standalone = false }) => {
  const [lspState, setLspState] = useState<LspEnsureSessionResult | null>(null);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const lspHandleRef = useRef<ReturnType<typeof globalLspBridge.attachModel> | null>(null);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (!model || !isWorkspaceBacked || !workspaceId || !workspaceRootPath) {
      return;
    }

    const handle = globalLspBridge.attachModel({
      workspaceId,
      workspaceRootPath,
      path: filePath,
      monacoLanguage: language,
      model,
      onSessionStateChange: setLspState,
    });
    lspHandleRef.current = handle;

    return () => {
      handle.detach();
      lspHandleRef.current = null;
      setLspState(null);
    };
  }, [filePath, isWorkspaceBacked, language, workspaceId, workspaceRootPath]);

  const shouldShowNotice =
    lspState &&
    lspState.kind !== "unsupported_language" &&
    lspState.kind !== "ready" &&
    dismissedKey !== `${workspaceId}:${filePath}:${lspState.kind}:${lspState.errorCode}`;

  return (
    <>
      {shouldShowNotice ? (
        <LspStatusNotice
          state={lspState}
          onDismiss={() =>
            setDismissedKey(`${workspaceId}:${filePath}:${lspState.kind}:${lspState.errorCode}`)
          }
          onInstall={async () => {
            await lspHandleRef.current?.install();
          }}
          onRetry={async () => {
            await lspHandleRef.current?.retry();
          }}
        />
      ) : null}
      <div className="code-editor-monaco-shell" ref={containerRef} />
    </>
  );
};
```

- [ ] **Step 5: Run the targeted web tests to verify they pass**

Run: `pnpm --filter @coder-studio/web exec vitest run src/features/code-editor/lsp/bridge.test.tsx src/features/code-editor/components/lsp-status-notice.test.tsx src/features/code-editor/components/monaco-host.test.tsx src/features/code-editor/index.test.tsx`

Expected: PASS

- [ ] **Step 6: Commit the Monaco notice and auto-retry flow**

```bash
git add packages/web/src/features/code-editor/components/lsp-status-notice.tsx packages/web/src/features/code-editor/components/lsp-status-notice.test.tsx packages/web/src/features/code-editor/lsp/bridge.ts packages/web/src/features/code-editor/lsp/bridge.test.tsx packages/web/src/features/code-editor/components/monaco-host.tsx packages/web/src/features/code-editor/components/monaco-host.test.tsx packages/web/src/features/code-editor/index.test.tsx
git commit -m "feat(web): add managed lsp install notice"
```

## Task 5: Verify The Managed LSP Tool Flow End To End

**Files:**
- Modify if needed based on failing assertions from prior tasks; do not create new features in this task.

- [ ] **Step 1: Run the shared core LSP tests**

Run: `pnpm exec vitest run packages/core/src/domain/lsp.test.ts`

Expected: PASS

- [ ] **Step 2: Run the targeted server LSP test suite**

Run: `pnpm --filter @coder-studio/server exec vitest run src/lsp/server-factory.test.ts src/lsp/manager.test.ts src/lsp-tools/manager.test.ts src/lsp-tools/install-manager.test.ts src/__tests__/lsp-commands.test.ts src/__tests__/provider-runtime/command-runner.test.ts`

Expected: PASS

- [ ] **Step 3: Run the targeted web LSP test suite**

Run: `pnpm --filter @coder-studio/web exec vitest run src/features/code-editor/lsp/bridge.test.tsx src/features/code-editor/components/lsp-status-notice.test.tsx src/features/code-editor/components/monaco-host.test.tsx src/features/code-editor/index.test.tsx`

Expected: PASS

- [ ] **Step 4: Run a manual smoke check in the app**

Run: `pnpm dev`

Expected manual checks:
- opening a `.ts` or `.js` file does not show a missing-tool notice
- opening a `.py`, `.go`, or `.rs` file on a clean machine shows a non-blocking install notice
- clicking `Install` starts a visible progress state
- successful install removes the notice and enables diagnostics/navigation without reopening the file
- while the tool is missing or installing, ordinary text editing and save still work

- [ ] **Step 5: Commit only the final cleanup if this verification task required code changes**

```bash
git add -A
git commit -m "test(lsp): verify managed tool flow"
```

## Notes For The Implementer

- Keep managed installs native-only for this first pass. If `workspace.targetRuntime === "wsl"`, do not offer managed install yet; keep override and system-command resolution working via the existing `wsl -- <command>` wrapper.
- Do not gate progress on full-repo `tsc` or `ci:verify` yet. The current branch baseline already has unrelated type-check noise. Use the targeted server/web/core LSP tests in this plan as the quality gate.
- Do not regress the current behavior where unsupported languages simply do nothing.
- Do not block typing or saving on any LSP state. Missing tools, install failures, and session start failures must stay soft-failures from the editor's point of view.
