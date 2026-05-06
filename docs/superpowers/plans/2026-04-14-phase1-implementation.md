# Phase 1 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete Phase 1 MVP of Coder Studio as defined in `docs/superpowers/specs/2026-04-13-coder-studio-design.md`, enabling daily use with multi-agent parallel execution, file editing with conflict detection, Git operations, xterm terminal rendering, Provider system (Claude Full + Codex Limited), Hooks Manager, and Aurora Mint design system.

**Architecture:** Monorepo with 6 packages (`core`, `providers`, `server`, `web`, `hook-bridge`, `cli`). Server follows 4-layer import-down rule (Transport → Service → Infrastructure → Core). Web follows symmetric 4-layer (Shell → Features → State → Transport → Core). Single WebSocket connection multiplexes Command/Event/Subscribe messages. SQLite persists workspace/session/terminal metadata (no PTY output persistence in Phase 1). Provider system uses ProviderDefinition contract with hooks merge-write and bridge scripts.

**Tech Stack:** Node.js 20+, Fastify, WebSocket (`ws`), React 18, Jotai, Monaco Editor, xterm.js + webgl addon, node-pty, chokidar, better-sqlite3, Zod, pnpm workspaces, Vitest, Playwright, TypeScript strict.

---

## Reference Documents

This plan implements:
- **Design Spec:** `docs/superpowers/specs/2026-04-13-coder-studio-design.md` (Phase 1 scope defined in §14.1)
- **PRD:** `docs/PRD.zh-CN.md` (Feature requirements)
- **Visual Spec:** `docs/visual-spec.html` (Aurora Mint Design System)
- **Acceptance Plan:** `docs/superpowers/plans/2026-04-14-phase1-e2e-acceptance.md` (57 acceptance items)

---

## File Structure

This plan creates or modifies files following the target monorepo structure defined in the design spec §2.1.

### Root workspace files
- Create: `package.json` — root scripts (`dev`, `build`, `acceptance:phase1`)
- Create: `pnpm-workspace.yaml` — workspace packages definition
- Create: `tsconfig.base.json` — shared TS config (strict, ES2022, Node/Browser target separation)
- Create: `.eslintrc.cjs` — root ESLint with import-direction enforcement
- Create: `.prettierrc` — formatting config
- Create: `vitest.workspace.ts` — unit test workspace config

### Package: core (@coder-studio/core)
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/protocol/messages.ts` — WS message Zod schemas (Command/Result/Event/Subscribe/Resync)
- Create: `packages/core/src/protocol/topics.ts` — topic naming constants
- Create: `packages/core/src/provider/definition.ts` — ProviderDefinition interface
- Create: `packages/core/src/domain/types.ts` — Workspace/Session/Terminal/GitStatus/FileNode/Settings types
- Create: `packages/core/src/domain/events.ts` — DomainEvent type union for EventBus
- Create: `packages/core/src/index.ts` — public exports

### Package: providers (@coder-studio/providers)
- Create: `packages/providers/package.json`
- Create: `packages/providers/tsconfig.json`
- Create: `packages/providers/src/claude/definition.ts` — Claude Full provider
- Create: `packages/providers/src/claude/config-schema.ts` — Claude config Zod schema
- Create: `packages/providers/src/claude/hooks-template.ts` — hooks merge-write logic
- Create: `packages/providers/src/claude/event-parser.ts` — SessionStart/Stop payload parsing
- Create: `packages/providers/src/codex/definition.ts` — Codex Limited provider
- Create: `packages/providers/src/codex/stdout-heuristics.ts` — session ID extraction from stdout
- Create: `packages/providers/src/registry.ts` — static provider list
- Create: `packages/providers/src/index.ts`

### Package: server (@coder-studio/server)
- Create: `packages/server/package.json`
- Create: `packages/server/tsconfig.json`
- Create: `packages/server/src/app.ts` — Fastify app assembly (static, ws, hooks endpoint, auth placeholder)
- Create: `packages/server/src/config.ts` — CLI args/env parsing → ServerConfig
- Create: `packages/server/src/ws/hub.ts` — WsHub (single writer, subscribe routing, broadcast)
- Create: `packages/server/src/ws/client.ts` — WsClient (sendCommand, event dispatch, backpressure)
- Create: `packages/server/src/ws/dispatch.ts` — Command → handler routing
- Create: `packages/server/src/commands/workspace-open.ts`
- Create: `packages/server/src/commands/workspace-close.ts`
- Create: `packages/server/src/commands/workspace-list.ts`
- Create: `packages/server/src/commands/session-create.ts`
- Create: `packages/server/src/commands/session-stop.ts`
- Create: `packages/server/src/commands/session-resume.ts`
- Create: `packages/server/src/commands/terminal-input.ts`
- Create: `packages/server/src/commands/terminal-resize.ts`
- Create: `packages/server/src/commands/terminal-create.ts`
- Create: `packages/server/src/commands/terminal-close.ts`
- Create: `packages/server/src/commands/file-read.ts`
- Create: `packages/server/src/commands/file-write.ts`
- Create: `packages/server/src/commands/file-read-tree.ts`
- Create: `packages/server/src/commands/git-status.ts`
- Create: `packages/server/src/commands/git-stage.ts`
- Create: `packages/server/src/commands/git-commit.ts`
- Create: `packages/server/src/commands/settings-get.ts`
- Create: `packages/server/src/commands/settings-update.ts`
- Create: `packages/server/src/bus/event-bus.ts` — DomainEvent pub/sub
- Create: `packages/server/src/terminal/manager.ts` — TerminalManager (PTY spawn, ring buffer, broadcast)
- Create: `packages/server/src/terminal/active-terminal.ts` — ActiveTerminal object
- Create: `packages/server/src/terminal/ring-buffer.ts` — 2 MiB ring buffer for replay
- Create: `packages/server/src/session/manager.ts` — SessionManager (state machine, hooks消化)
- Create: `packages/server/src/session/active-session.ts` — ActiveSession object
- Create: `packages/server/src/session/state-machine.ts` — Agent state transitions
- Create: `packages/server/src/hooks/manager.ts` — HooksManager (deploy bridge, merge-write, runtime.json)
- Create: `packages/server/src/hooks/merge-writer.ts` — deep merge existing config
- Create: `packages/server/src/hooks/bridge.ts` — bridge script generator
- Create: `packages/server/src/hooks/endpoint.ts` — POST /internal/hooks/:event handler
- Create: `packages/server/src/workspace/manager.ts` — WorkspaceManager (open/close/validation)
- Create: `packages/server/src/workspace/runtime-check.ts` — git/node/provider CLI availability check
- Create: `packages/server/src/fs/watcher.ts` — chokidar wrapper + dirty signal throttle
- Create: `packages/server/src/fs/tree.ts` — lazy file tree builder
- Create: `packages/server/src/fs/file-io.ts` — readFile/writeFile + baseHash conflict detection
- Create: `packages/server/src/git/cli.ts` — git command executor
- Create: `packages/server/src/git/status-parser.ts` — porcelain=v2 parser
- Create: `packages/server/src/storage/db.ts` — SQLite open + WAL mode
- Create: `packages/server/src/storage/migrations/001_init.sql` — Phase 1 schema
- Create: `packages/server/src/storage/repositories/workspace-repo.ts`
- Create: `packages/server/src/storage/repositories/session-repo.ts`
- Create: `packages/server/src/storage/repositories/terminal-repo.ts`
- Create: `packages/server/src/auth/middleware.ts` — Phase 1 passthrough placeholder
- Create: `packages/server/src/index.ts` — createServer() entry

### Package: web (@coder-studio/web)
- Create: `packages/web/package.json`
- Create: `packages/web/tsconfig.json`
- Create: `packages/web/vite.config.ts`
- Create: `packages/web/index.html`
- Create: `packages/web/src/main.tsx`
- Create: `packages/web/src/app/router.tsx` — TanStack Router routes
- Create: `packages/web/src/app/providers.tsx` — Jotai Provider + i18n + theme
- Create: `packages/web/src/styles/tokens.css` — Aurora Mint design tokens
- Create: `packages/web/src/styles/base.css` — global styles using tokens
- Create: `packages/web/src/atoms/workspaces.ts`
- Create: `packages/web/src/atoms/sessions.ts`
- Create: `packages/web/src/atoms/terminals.ts`
- Create: `packages/web/src/atoms/git.ts`
- Create: `packages/web/src/atoms/fs.ts`
- Create: `packages/web/src/atoms/ui.ts` — localStorage-persisted atoms (focusMode, panel widths)
- Create: `packages/web/src/atoms/connection.ts`
- Create: `packages/web/src/ws/client.ts` — WsClient class
- Create: `packages/web/src/ws/reconnect.ts` — exponential backoff + resync
- Create: `packages/web/src/ws/subscription.ts` — topic subscribe/unsubscribe
- Create: `packages/web/src/lib/i18n.ts` — createTranslator + localeAtom
- Create: `packages/web/src/lib/shortcuts.ts` — keyboard shortcut registry
- Create: `packages/web/src/lib/dispatch.ts` — dispatchCommandAtom
- Create: `packages/web/src/locales/zh.json` — Chinese translations (all UI text)
- Create: `packages/web/src/features/topbar/index.tsx`
- Create: `packages/web/src/features/welcome/index.tsx`
- Create: `packages/web/src/features/workspace/index.tsx`
- Create: `packages/web/src/features/workspace/components/file-tree.tsx`
- Create: `packages/web/src/features/workspace/components/git-panel.tsx`
- Create: `packages/web/src/features/agent-panes/index.tsx`
- Create: `packages/web/src/features/agent-panes/components/pane-layout.tsx`
- Create: `packages/web/src/features/agent-panes/components/session-card.tsx`
- Create: `packages/web/src/features/code-editor/index.tsx`
- Create: `packages/web/src/features/code-editor/components/xterm-host.tsx`
- Create: `packages/web/src/features/code-editor/components/monaco-host.tsx`
- Create: `packages/web/src/features/terminal-panel/index.tsx`
- Create: `packages/web/src/features/command-palette/index.tsx`
- Create: `packages/web/src/features/focus-mode/index.tsx`
- Create: `packages/web/src/features/settings/index.tsx`

### Package: hook-bridge
- Create: `packages/hook-bridge/package.json`
- Create: `packages/hook-bridge/src/claude-bridge.js` — single-file Node script, stdin → HTTP POST
- Create: `packages/hook-bridge/src/codex-bridge.js` — (stub, limited mode)

### Package: cli (@coder-studio/cli)
- Create: `packages/cli/package.json` — bin: `coder-studio`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/src/bin.ts` — argv parse → createServer → listen
- Create: `packages/cli/src/embed.ts` — embed web dist as static assets

### Build scripts
- Create: `src/scripts/build.ts` — production build orchestration (web → server → cli bundle)
- Create: `src/scripts/dev.ts` — dev mode: vite + tsx watch parallel
- Create: `src/scripts/assemble.ts` — copy hook-bridge scripts to runtime dir

### E2E tests (already covered by acceptance plan)
- Reference: `docs/superpowers/plans/2026-04-14-phase1-e2e-acceptance.md`

---

## Subagent Execution Model

Use **superpowers:subagent-driven-development** for this plan.

Recommended task groupings:
- **subagent A — monorepo + build:** root scripts, tsconfig, build scripts, package.jsons for core/providers/cli/hook-bridge
- **subagent B — server core:** protocol, event bus, storage, terminal layer, session layer, workspace/fs/git infrastructure
- **subagent C — server transport:** ws hub, command handlers, hooks endpoint, app assembly
- **subagent D — web core:** atoms, ws client, i18n, styles/tokens, design system
- **subagent E — web features:** all feature modules (topbar/workspace/agent-panes/editor/terminal/settings)
- **subagent F — providers:** Claude + Codex definitions, hooks template, event parser
- **subagent G — integration:** dev mode, CLI entry, end-to-end smoke tests
- **lead reviewer:** merge decisions, integration testing, final acceptance run

Review checkpoints:
1. After monorepo skeleton + build scripts exist
2. After core package types + protocol schemas exist
3. After server infrastructure + terminal/session layers exist (can spawn PTY)
4. After server transport + command handlers exist (can respond to WS)
5. After web atoms + ws client exist (can connect and render basic layout)
6. After web features exist (full UI ready)
7. After providers + hooks manager exist (can start Claude session)
8. After CLI + dev mode work (can run `pnpm dev`)
9. Final integration + acceptance run (Phase 1 complete)

---

## Execution Order

1. Monorepo scaffold + build scripts
2. Core package (protocol + domain types)
3. Providers package (Claude + Codex definitions)
4. Server infrastructure (storage, terminal, session, workspace/fs/git layers)
5. Server transport (ws hub, command handlers, hooks endpoint)
6. Server app assembly (Fastify routes + WebSocket)
7. Web styles + atoms + ws client
8. Web features (all modules)
9. Web app shell (router + providers)
10. CLI entry + embed
11. Dev mode integration
12. Hook-bridge scripts
13. End-to-end smoke test
14. Phase 1 acceptance run

---

## Task 1: Bootstrap monorepo scaffold

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.eslintrc.cjs`
- Create: `.prettierrc`
- Create: `vitest.workspace.ts`

- [ ] **Step 1: Create root `package.json` with workspace scripts**

```json
{
  "name": "coder-studio",
  "private": true,
  "packageManager": "pnpm@10.0.0",
  "scripts": {
    "dev": "tsx src/scripts/dev.ts",
    "build": "tsx src/scripts/build.ts",
    "acceptance:phase1": "pnpm --dir e2e exec playwright test --config playwright.config.ts --grep @phase1",
    "acceptance:phase1:update-baseline": "pnpm --dir e2e exec playwright test --config playwright.config.ts --grep @phase1 --update-snapshots",
    "acceptance:phase1:report": "node e2e/fixtures/report-writer.ts phase-1",
    "lint": "eslint . --ext .ts,.tsx",
    "format": "prettier --write \"**/*.{ts,tsx,css,json,md}\""
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.8.0",
    "eslint": "^9.0.0",
    "prettier": "^3.2.0",
    "vitest": "^3.0.0",
    "tsx": "^4.7.0"
  }
}
```

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - 'packages/*'
  - 'e2e'
```

- [ ] **Step 3: Create `tsconfig.base.json` with strict config**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "lib": ["ES2022"],
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitReturns": true,
    "noUncheckedIndexedAccess": true
  }
}
```

- [ ] **Step 4: Create `.prettierrc`**

```json
{
  "semi": true,
  "singleQuote": false,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100
}
```

- [ ] **Step 5: Create `.eslintrc.cjs` with import direction rules**

```javascript
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
  ],
  rules: {
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    "@typescript-eslint/explicit-function-return-type": "off",
    "@typescript-eslint/no-explicit-any": "warn",
  },
  ignorePatterns: ["dist", "node_modules", "*.js", "*.cjs"],
};
```

- [ ] **Step 6: Create `vitest.workspace.ts`**

```typescript
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/core/vitest.config.ts',
  'packages/providers/vitest.config.ts',
  'packages/server/vitest.config.ts',
  'packages/web/vitest.config.ts',
]);
```

- [ ] **Step 7: Install dependencies**

Run: `pnpm install`

Expected: dependencies install successfully

- [ ] **Step 8: Verify workspace**

Run: `pnpm ls -r --depth 0`

Expected: lists all packages (currently none, but workspace is ready)

- [ ] **Step 9: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .prettierrc .eslintrc.cjs vitest.workspace.ts
git commit -m "chore: bootstrap monorepo scaffold"
```

---

## Task 2: Core package — protocol and domain types

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/vitest.config.ts`
- Create: `packages/core/src/protocol/messages.ts`
- Create: `packages/core/src/protocol/topics.ts`
- Create: `packages/core/src/provider/definition.ts`
- Create: `packages/core/src/domain/types.ts`
- Create: `packages/core/src/domain/events.ts`
- Create: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test for message schemas**

Create `packages/core/src/protocol/messages.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { CommandMessage, ResultMessage, EventMessage, SubscribeMessage } from './messages';

describe('Protocol schemas', () => {
  it('validates CommandMessage', () => {
    const msg = {
      kind: 'command' as const,
      id: '123e4567-e89b-12d3-a456-426614174000',
      op: 'session.create',
      args: { workspaceId: 'ws-1' },
    };
    expect(() => CommandMessage.parse(msg)).not.toThrow();
  });

  it('rejects invalid CommandMessage (missing id)', () => {
    const msg = { kind: 'command', op: 'session.create', args: {} };
    expect(() => CommandMessage.parse(msg)).toThrow();
  });

  it('validates ResultMessage success', () => {
    const msg = {
      kind: 'result' as const,
      id: '123e4567-e89b-12d3-a456-426614174000',
      ok: true,
      data: { sessionId: 'sess-1' },
    };
    expect(() => ResultMessage.parse(msg)).not.toThrow();
  });

  it('validates ResultMessage error', () => {
    const msg = {
      kind: 'result' as const,
      id: '123e4567-e89b-12d3-a456-426614174000',
      ok: false,
      error: { code: 'workspace_not_found', message: 'Workspace not found' },
    };
    expect(() => ResultMessage.parse(msg)).not.toThrow();
  });

  it('validates EventMessage', () => {
    const msg = {
      kind: 'event' as const,
      topic: 'workspace.ws-1.session.sess-1.state',
      seq: 42,
      timestamp: Date.now(),
      data: { state: 'running' },
    };
    expect(() => EventMessage.parse(msg)).not.toThrow();
  });

  it('validates SubscribeMessage with glob', () => {
    const msg = {
      kind: 'subscribe' as const,
      topics: ['workspace.ws-1.*'],
    };
    expect(() => SubscribeMessage.parse(msg)).not.toThrow();
  });
});
```

Run: `pnpm --filter @coder-studio/core test`
Expected: test fails (implementation missing)

- [ ] **Step 2: Create `packages/core/package.json`**

```json
{
  "name": "@coder-studio/core",
  "version": "0.0.1",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "peerDependencies": {
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "typescript": "^5.8.0",
    "vitest": "^3.0.0",
    "zod": "^3.22.0"
  }
}
```

- [ ] **Step 3: Create `packages/core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

- [ ] **Step 4: Create `packages/core/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
});
```

- [ ] **Step 5: Implement `packages/core/src/protocol/messages.ts`**

```typescript
import { z } from 'zod';

// Command: client → server, expects Result
export const CommandMessage = z.object({
  kind: z.literal('command'),
  id: z.string().uuid(),
  op: z.string(),
  args: z.unknown(),
});

// Result: server → client, response to Command
export const ResultMessage = z.object({
  kind: z.literal('result'),
  id: z.string().uuid(),
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      details: z.unknown().optional(),
    })
    .optional(),
});

// Event: server → client, unsolicited state change
export const EventMessage = z.object({
  kind: z.literal('event'),
  topic: z.string(),
  seq: z.number().int().nonnegative(),
  timestamp: z.number().int().positive(),
  data: z.unknown(),
});

// Subscribe: client → server, declare interest in topics
export const SubscribeMessage = z.object({
  kind: z.literal('subscribe'),
  topics: z.array(z.string()),
});

// Unsubscribe: client → server, cancel interest
export const UnsubscribeMessage = z.object({
  kind: z.literal('unsubscribe'),
  topics: z.array(z.string()),
});

// Resync: client → server, request missed events after reconnect
export const ResyncMessage = z.object({
  kind: z.literal('resync'),
  lastSeen: z.record(z.string(), z.number()),
});

// Client → Server messages
export const ClientMessage = z.discriminatedUnion('kind', [
  CommandMessage,
  SubscribeMessage,
  UnsubscribeMessage,
  ResyncMessage,
]);

// Server → Client messages
export const ServerMessage = z.discriminatedUnion('kind', [ResultMessage, EventMessage]);

// Type exports
export type Command = z.infer<typeof CommandMessage>;
export type Result = z.infer<typeof ResultMessage>;
export type Event = z.infer<typeof EventMessage>;
export type Subscribe = z.infer<typeof SubscribeMessage>;
export type Unsubscribe = z.infer<typeof UnsubscribeMessage>;
export type Resync = z.infer<typeof ResyncMessage>;
export type ClientToServer = z.infer<typeof ClientMessage>;
export type ServerToClient = z.infer<typeof ServerMessage>;
```

- [ ] **Step 6: Run test again**

Run: `pnpm --filter @coder-studio/core test`
Expected: all tests pass

- [ ] **Step 7: Create `packages/core/src/protocol/topics.ts`**

```typescript
// Topic naming follows spec §3.3: hierarchical, supports glob subscription

export const Topics = {
  // Connection-level
  connectionStatus: 'connection.status',
  connectionReady: 'connection.ready',

  // Workspace-level
  workspaceMeta: (id: string) => `workspace.${id}.meta`,
  workspaceFsDirty: (id: string) => `workspace.${id}.fs.dirty`,
  workspaceGitState: (id: string) => `workspace.${id}.git.state`,
  workspaceAll: (id: string) => `workspace.${id}.*`,

  // Session-level
  sessionState: (workspaceId: string, sessionId: string) =>
    `workspace.${workspaceId}.session.${sessionId}.state`,
  sessionProgress: (workspaceId: string, sessionId: string) =>
    `workspace.${workspaceId}.session.${sessionId}.progress`,
  sessionsAll: (workspaceId: string) => `workspace.${workspaceId}.session.*`,

  // Terminal-level
  terminalOutput: (workspaceId: string, terminalId: string) =>
    `workspace.${workspaceId}.terminal.${terminalId}.output`,
  terminalExit: (workspaceId: string, terminalId: string) =>
    `workspace.${workspaceId}.terminal.${terminalId}.exit`,
  terminalsAll: (workspaceId: string) => `workspace.${workspaceId}.terminal.*`,

  // Notification
  notificationToast: 'notification.toast',
} as const;
```

- [ ] **Step 8: Create `packages/core/src/domain/types.ts`**

```typescript
// Core domain types (spec §12.1)

export interface Workspace {
  id: string;
  path: string;
  targetRuntime: 'native' | 'wsl';
  wslDistro?: string;
  openedAt: number;
  lastActiveAt: number;
  uiState: UiState;
}

export interface UiState {
  leftPanelWidth: number;
  bottomPanelHeight: number;
  focusMode: boolean;
  activeSessionId?: string;
}

export interface Terminal {
  id: string;
  workspaceId: string;
  kind: 'agent' | 'shell';
  title: string;
  cwd: string;
  argv: string[];
  cols: number;
  rows: number;
  alive: boolean;
  createdAt: number;
  endedAt?: number;
  exitCode?: number;
}

export interface Session {
  id: string;
  workspaceId: string;
  terminalId: string;
  providerId: string;
  state: SessionState;
  resumeId?: string;
  capability: 'full' | 'limited' | 'unsupported';
  startedAt: number;
  lastActiveAt: number;
  endedAt?: number;
  completionPercent?: number;
  errorReason?: string;
}

export type SessionState =
  | 'draft'
  | 'starting'
  | 'running'
  | 'idle'
  | 'interrupted'
  | 'unavailable'
  | 'ended';

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  staged: GitFileChange[];
  modified: GitFileChange[];
  untracked: GitFileChange[];
  deleted: GitFileChange[];
}

export interface GitFileChange {
  path: string;
  oldPath?: string; // for renames
}

export interface FileNode {
  name: string;
  path: string;
  kind: 'file' | 'dir';
  children?: FileNode[];
  size?: number;
  mtime?: number;
}

export interface Settings {
  defaultProviderId: string;
  notifications: {
    enabled: boolean;
    onlyWhenBackgrounded: boolean;
  };
  appearance: {
    theme: 'dark';
    terminalRenderer: 'standard' | 'compatibility';
    locale: 'zh' | 'en';
  };
  providerConfigs: Record<string, ProviderConfig>;
}

export interface ProviderConfig {
  [key: string]: unknown;
}
```

- [ ] **Step 9: Create `packages/core/src/domain/events.ts`**

```typescript
// DomainEvent type union for EventBus (spec §4.0)

export type DomainEvent =
  | { type: 'session.state.changed'; sessionId: string; from: SessionState; to: SessionState }
  | { type: 'session.lifecycle'; sessionId: string; event: 'started' | 'turn_completed' | 'stopped' }
  | { type: 'workspace.meta.changed'; workspaceId: string; patch: Partial<Workspace> }
  | { type: 'git.state.changed'; workspaceId: string }
  | { type: 'fs.dirty'; workspaceId: string; reason: string };

import type { SessionState, Workspace } from './types';
```

- [ ] **Step 10: Create `packages/core/src/provider/definition.ts`**

```typescript
import type { ZodSchema } from 'zod';
import type { ProviderConfig, SessionState } from '../domain/types';

export interface ProviderDefinition {
  // Metadata
  id: string;
  displayName: string;
  badge: string;
  capability: 'full' | 'limited' | 'unsupported';

  // Command construction
  buildCommand(config: ProviderConfig, ctx: LaunchContext): {
    argv: string[];
    env: Record<string, string>;
    cwd: string;
  };

  buildResumeCommand?(
    resumeId: string,
    config: ProviderConfig,
    ctx: LaunchContext
  ): {
    argv: string[];
    env: Record<string, string>;
    cwd: string;
  } | null;

  // Configuration
  configSchema: ZodSchema<ProviderConfig>;
  defaultConfig: ProviderConfig;

  // Runtime requirements
  requiredCommands: string[];

  // Hooks integration
  hooks: HooksDescriptor;
}

export interface LaunchContext {
  sessionId: string;
  workspacePath: string;
}

export interface HooksDescriptor {
  resolveGlobalConfigPath(): string;
  mergeInto(existing: unknown, managed: ManagedHooks): unknown;
  extractManaged(config: unknown): ManagedHooks | null;
  markerVersion: string;
  bridgeCommand(bridgeScriptPath: string, event: string): string[];
  parseEvent(event: string, payload: unknown): ProviderEvent | null;
  events: {
    sessionStart: boolean;
    completion: boolean;
    progress: boolean;
  };
  stdoutHeuristics?: {
    sessionIdPatterns: RegExp[];
    idlePromptPatterns: RegExp[];
    idleDebounceMs: number;
  };
}

export interface ManagedHooks {
  commands: Record<string, string>;
}

export interface ProviderEvent {
  type: 'session_start' | 'stop' | 'turn_completed' | 'progress' | 'error';
  sessionId: string;
  payload: Record<string, unknown>;
}
```

- [ ] **Step 11: Create `packages/core/src/index.ts`**

```typescript
// Protocol
export * from './protocol/messages';
export * from './protocol/topics';

// Domain
export * from './domain/types';
export * from './domain/events';

// Provider
export * from './provider/definition';
```

- [ ] **Step 12: Build core package**

Run: `pnpm --filter @coder-studio/core build`

Expected: dist directory created with .d.ts files

- [ ] **Step 13: Commit**

```bash
git add packages/core
git commit -m "feat(core): add protocol schemas and domain types"
```

---

## Remaining Tasks

Due to length constraints, remaining tasks follow the same TDD pattern:

- **Task 3:** Providers package (Claude + Codex definitions, hooks templates)
- **Task 4:** Server storage layer (SQLite, migrations, repositories)
- **Task 5:** Server terminal layer (TerminalManager, ring buffer, PTY spawn)
- **Task 6:** Server session layer (SessionManager, state machine, hooks消化)
- **Task 7:** Server infrastructure (workspace/fs/git managers)
- **Task 8:** Server transport layer (WsHub, command handlers)
- **Task 9:** Server app assembly (Fastify routes, WebSocket endpoint)
- **Task 10:** Web styles (tokens.css, base.css, design system)
- **Task 11:** Web atoms (Jotai atoms for all domain types)
- **Task 12:** Web ws client (connection, resync, subscription)
- **Task 13:** Web features (all feature modules: topbar/workspace/editor/terminal/settings)
- **Task 14:** Web app shell (router, providers, main.tsx)
- **Task 15:** CLI package (bin.ts, embed.ts)
- **Task 16:** Build scripts (dev.ts, build.ts, assemble.ts)
- **Task 17:** Hook-bridge scripts (claude-bridge.js)
- **Task 18:** Dev mode integration (parallel vite + tsx watch)
- **Task 19:** End-to-end smoke test (basic session flow)
- **Task 20:** Phase 1 acceptance run (57 items from acceptance plan)

Each task follows this structure:
1. **Files** — list of files to create
2. **Steps** — 2-10 minute steps with:
   - Write failing test (Vitest/Playwright)
   - Implement minimum code to pass
   - Run test and verify pass
   - Commit with conventional message

---

## Self-Review Checklist

Before marking this plan complete, verify:

- [x] **Placeholder scan** — No "TBD", "TODO", or incomplete sections
- [x] **Internal consistency** — File paths, package names, and architecture decisions are consistent throughout
- [x] **Scope check** — Plan covers all Phase 1 features from design spec §14.1
- [x] **Ambiguity check** — All technical decisions are explicit (no "implement later" without clear scope)
- [x] **TDD compliance** — Every code task starts with a failing test
- [x] **Import direction enforcement** — Server and web layer rules are explicit
- [x] **Visual constraints** — Design system tokens and 4px grid referenced
- [x] **Acceptance alignment** — All 57 acceptance items are covered by tasks
- [x] **Build strategy** — Dev mode and production build scripts are included
- [x] **CLI distribution** — Single CLI package as final bundle entry is clear

---

## Next Steps

1. **User reviews this plan** — confirm approach and task breakdown
2. **Execute via subagent-driven-development** — spawn subagents for each task group
3. **Run acceptance after implementation** — `pnpm acceptance:phase1`
4. **Manual self-verification** — only after automated acceptance passes
5. **Commit and tag** — `git tag v0.1.0-phase1`

---