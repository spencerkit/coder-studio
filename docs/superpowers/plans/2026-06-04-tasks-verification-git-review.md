# Tasks Verification And Git Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bottom-panel `Tasks / Verification` workflow that runs managed verification commands through task terminals, then upgrade Git review with hunk-level stage, unstage, and discard actions.

**Architecture:** Ship this as two ordered milestones. Milestone A adds shared task contracts, a server-side `TaskManager`, task discovery, task commands, task events, and a bottom-panel tab beside Terminal that launches task output in the existing xterm surface. Milestone B enriches Git diff payloads with server-generated hunk IDs and applies hunk operations server-side with `git apply`, then renders local hunk actions in the diff viewer.

**Tech Stack:** TypeScript, Zod, React, Jotai, xterm.js, node-pty, Git CLI, Fastify WebSocket command handlers, Vitest, Biome, pnpm

---

## Execution Rules

- Implement Milestone A completely before starting Milestone B. Tasks must be usable before Git hunk staging work begins.
- Do not add VS Code extension compatibility, Debug Adapter Protocol support, a full Problems panel, line-level staging, commit-message AI, or SQLite task history in this plan.
- Keep task run history in memory for MVP. Store the latest run per task and a short tail summary only; terminal replay remains the full output source.
- Preserve existing terminal behavior for `shell` and `agent` terminals. `task` terminals are managed but still use the same terminal output, replay, snapshot, resize, close, and mobile rendering infrastructure.
- The client must not send patch text for Git hunk operations. It sends `workspaceId`, `path`, `staged`, `hunkId`, and `operation`; the server validates the hunk against the current diff before applying.

## File Map

- `packages/core/src/domain/types.ts`
  - Add `TerminalKind`, task contracts, and Git hunk contracts.
  - Extend `Terminal.kind` and `GitFileDiffPayload`.
- `packages/core/src/domain/events.ts`
  - Add task domain events and extend terminal-created kind to `TerminalKind`.
- `packages/core/src/protocol/topics.ts`
  - Add workspace task topics.
- `packages/core/src/domain/types.test.ts`
  - Lock task and Git hunk contracts with type assertions.
- `packages/server/src/terminal/types.ts`
  - Use shared `TerminalKind` for `TerminalSpec.kind` and terminal spawn details.
- `packages/server/src/terminal/manager.ts`
  - Allow `task` terminals to get snapshot buffers and emit `terminal.created` with `kind: "task"`.
- `packages/server/src/storage/repositories/terminal-repo.ts`
  - Accept persisted `task` terminal records.
- `packages/server/src/tasks/discovery.ts`
  - Discover tasks from `.coder-studio/tasks.json`, `package.json`, `pnpm-workspace.yaml`, `Cargo.toml`, `go.mod`, `pyproject.toml`, and `Makefile`.
- `packages/server/src/tasks/discovery.test.ts`
  - Verify explicit config, package scripts, monorepo verify preference, ecosystem detection, and malformed-source warnings.
- `packages/server/src/tasks/manager.ts`
  - Own in-memory task definitions, latest runs, terminal-run mapping, output tail summaries, run/stop/rerun, and task events.
- `packages/server/src/tasks/manager.test.ts`
  - Verify task terminal creation, run status transitions, output summary capping, stop, and rerun.
- `packages/server/src/commands/task.ts`
  - Register `task.discover`, `task.list`, `task.run`, `task.stop`, `task.rerun`, and `task.history`.
- `packages/server/src/commands/index.ts`
  - Import `./task.js`.
- `packages/server/src/ws/dispatch.ts`
  - Add `taskMgr` to `CommandContext`.
- `packages/server/src/ws/hub.ts`
  - Broadcast task events on task topics.
- `packages/server/src/server.ts`
  - Construct `TaskManager`, inject it into command context, and stop workspace tasks during workspace teardown.
- `packages/server/src/__tests__/task-commands.test.ts`
  - Verify command registration and command-to-manager behavior.
- `packages/server/src/__tests__/terminal-commands.test.ts`
  - Verify `terminal.list` includes task terminals server-side.
- `packages/web/src/features/bottom-panel/atoms.ts`
  - Store active bottom-panel tab per workspace.
- `packages/web/src/features/bottom-panel/index.ts`
  - Export the bottom-panel atoms.
- `packages/web/src/features/workspace/views/shared/workspace-bottom-panel.tsx`
  - Render top-level bottom-panel tabs: `Terminal` and `Tasks`.
- `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx`
  - Replace direct `TerminalPanel` mount with `WorkspaceBottomPanel`.
- `packages/web/src/features/workspace/views/mobile/workspace-mobile-view.tsx`
  - Keep mobile terminal fullscreen behavior intact; do not show the task list inside the mobile terminal overlay in MVP.
- `packages/web/src/features/terminal-panel/atoms/terminals.ts`
  - Extend terminal metadata kind to include `task`.
- `packages/web/src/features/terminal-panel/actions/use-terminal-actions.ts`
  - Include `shell` and `task` terminals in the bottom Terminal selector, while continuing to exclude `agent` terminals.
- `packages/web/src/features/terminal-panel/components/title-format.ts`
  - Preserve task titles such as `Task: Verify` instead of formatting them as shell labels.
- `packages/web/src/features/terminal-panel/views/shared/terminal-selector-item.tsx`
  - Show a managed/task marker for `task` terminals.
- `packages/web/src/features/terminal-panel/views/shared/terminal-tab.tsx`
  - Show a managed/task marker for `task` terminal tabs.
- `packages/web/src/features/tasks/atoms.ts`
  - Store discovered task definitions, latest runs, loading state, and errors per workspace.
- `packages/web/src/features/tasks/actions/use-task-actions.ts`
  - Fetch tasks, subscribe to task events, run/stop/rerun tasks, and switch output to the Terminal tab.
- `packages/web/src/features/tasks/views/shared/tasks-panel.tsx`
  - Render discovered tasks with status, duration, command preview, and `Run` / `Stop` / `Rerun`.
- `packages/web/src/features/tasks/__tests__/tasks-panel.test.tsx`
  - Verify rendering, run, stop, rerun, event updates, and terminal-tab switching.
- `packages/web/src/features/terminal-panel/__tests__/terminal-panel.test.tsx`
  - Verify task terminals appear beside shell terminals and agent terminals remain excluded.
- `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.test.tsx`
  - Verify the bottom panel renders both top-level tabs on desktop.
- `packages/web/src/features/agent-panes/components/session-card.test.tsx`
  - Verify compact latest verify status in an agent pane.
- `packages/web/src/features/agent-panes/views/shared/session-card.tsx`
  - Render latest verify state with `View output` and `Rerun`.
- `packages/web/src/features/workspace/views/shared/git-panel.tsx`
  - Render compact verification banner in Git review context.
- `packages/web/src/features/workspace/views/shared/git-panel.test.tsx`
  - Verify verification banner and rerun behavior.
- `packages/web/src/locales/en.json`
  - Add English task and Git hunk labels.
- `packages/web/src/locales/zh.json`
  - Add Chinese task and Git hunk labels.
- `packages/server/src/git/hunks.ts`
  - Parse unified diffs into stable server-generated hunk descriptors.
- `packages/server/src/git/hunks.test.ts`
  - Verify hunk parsing, stable IDs, and single-hunk patch construction.
- `packages/server/src/git/hunk-operations.ts`
  - Validate current diff hunk ID and apply stage, unstage, and discard with `git apply`.
- `packages/server/src/git/hunk-operations.test.ts`
  - Verify hunk stage, unstage, discard, and stale hunk rejection in real temporary Git repositories.
- `packages/server/src/git/diff.ts`
  - Include `hunks` on text diff payloads.
- `packages/server/src/commands/git.ts`
  - Register `git.hunk` command.
- `packages/server/src/__tests__/git-commands.test.ts`
  - Verify command validation and state-change event emission for `git.hunk`.
- `packages/web/src/features/workspace/actions/use-git-actions.ts`
  - Add hunk operation action, refresh affected preview, and surface stale diff errors.
- `packages/web/src/features/workspace/views/shared/git-diff-viewer.tsx`
  - Render file-level and hunk-level review actions in the diff surface.
- `packages/web/src/features/workspace/views/shared/git-diff-viewer.test.tsx`
  - Verify hunk actions, stale error behavior, file actions, and stable selected preview.

## Milestone A: Tasks / Verification

### Task 1: Add Shared Task, Terminal, and Git Hunk Contracts

**Files:**
- Modify: `packages/core/src/domain/types.ts`
- Modify: `packages/core/src/domain/events.ts`
- Modify: `packages/core/src/protocol/topics.ts`
- Modify: `packages/core/src/domain/types.test.ts`

- [ ] **Step 1: Write the failing shared-contract tests**

Append these imports to `packages/core/src/domain/types.test.ts`:

```ts
import type {
  GitDiffHunk,
  GitHunkOperation,
  TaskDefinition,
  TaskRun,
  Terminal,
  TerminalKind,
} from "./types";
```

Append these tests to `packages/core/src/domain/types.test.ts`:

```ts
describe("Task contracts", () => {
  it("defines managed workspace task definitions", () => {
    expectTypeOf<TaskDefinition>().toEqualTypeOf<{
      id: string;
      workspaceId: string;
      kind: "verify" | "test" | "lint" | "build" | "dev" | "custom";
      label: string;
      command: string;
      args: string[];
      cwdPath?: string;
      source:
        | "coder-studio"
        | "package-json"
        | "pnpm-workspace"
        | "cargo"
        | "go"
        | "python"
        | "makefile"
        | "inferred";
      priority: number;
    }>();
  });

  it("defines managed task run state", () => {
    expectTypeOf<TaskRun>().toEqualTypeOf<{
      id: string;
      workspaceId: string;
      taskId: string;
      terminalId: string;
      status: "queued" | "running" | "passed" | "failed" | "stopped";
      command: string;
      args: string[];
      cwdPath?: string;
      startedAt: number;
      finishedAt?: number;
      exitCode?: number;
      summary?: {
        tailLines: string[];
      };
    }>();
  });

  it("allows task terminals as managed terminal DTOs", () => {
    expectTypeOf<TerminalKind>().toEqualTypeOf<"agent" | "shell" | "task">();
    expectTypeOf<Terminal["kind"]>().toEqualTypeOf<TerminalKind>();
  });
});

describe("Git hunk contracts", () => {
  it("defines hunk descriptors returned by diff payloads", () => {
    expectTypeOf<GitDiffHunk>().toEqualTypeOf<{
      id: string;
      header: string;
      oldStart: number;
      oldLines: number;
      newStart: number;
      newLines: number;
      patch: string;
      lines: string[];
    }>();
    expectTypeOf<GitFileDiffPayload["hunks"]>().toEqualTypeOf<GitDiffHunk[] | undefined>();
  });

  it("defines server-validated hunk operations", () => {
    expectTypeOf<GitHunkOperation>().toEqualTypeOf<{
      workspaceId: string;
      path: string;
      staged: boolean;
      hunkId: string;
      operation: "stage" | "unstage" | "discard";
    }>();
  });
});
```

- [ ] **Step 2: Run the focused core test and confirm it fails**

Run:

```bash
pnpm --filter @coder-studio/core exec vitest run src/domain/types.test.ts
```

Expected: FAIL with missing exports for `TaskDefinition`, `TaskRun`, `TerminalKind`, `GitDiffHunk`, and `GitHunkOperation`.

- [ ] **Step 3: Add shared contracts**

Add these types in `packages/core/src/domain/types.ts` near the existing `Terminal` and Git types:

```ts
export type TerminalKind = "agent" | "shell" | "task";

export type TaskKind = "verify" | "test" | "lint" | "build" | "dev" | "custom";

export type TaskSource =
  | "coder-studio"
  | "package-json"
  | "pnpm-workspace"
  | "cargo"
  | "go"
  | "python"
  | "makefile"
  | "inferred";

export type TaskRunStatus = "queued" | "running" | "passed" | "failed" | "stopped";

export interface TaskDefinition {
  id: string;
  workspaceId: string;
  kind: TaskKind;
  label: string;
  command: string;
  args: string[];
  cwdPath?: string;
  source: TaskSource;
  priority: number;
}

export interface TaskRun {
  id: string;
  workspaceId: string;
  taskId: string;
  terminalId: string;
  status: TaskRunStatus;
  command: string;
  args: string[];
  cwdPath?: string;
  startedAt: number;
  finishedAt?: number;
  exitCode?: number;
  summary?: {
    tailLines: string[];
  };
}

export interface GitDiffHunk {
  id: string;
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  patch: string;
  lines: string[];
}

export interface GitHunkOperation {
  workspaceId: string;
  path: string;
  staged: boolean;
  hunkId: string;
  operation: "stage" | "unstage" | "discard";
}
```

Change `Terminal.kind` in `packages/core/src/domain/types.ts` from:

```ts
kind: "agent" | "shell";
```

to:

```ts
kind: TerminalKind;
```

Add `hunks` to `GitFileDiffPayload`:

```ts
hunks?: GitDiffHunk[];
```

- [ ] **Step 4: Add task domain events and topics**

Modify imports in `packages/core/src/domain/events.ts`:

```ts
import type { SessionState, TaskDefinition, TaskRun, TerminalKind, Workspace } from "./types";
```

Change `terminal.created.kind` in `DomainEvent` to:

```ts
kind: TerminalKind;
```

Add these task event variants before the LSP event variant:

```ts
| { type: "task.discovered"; workspaceId: string; tasks: TaskDefinition[] }
| { type: "task.run.started"; workspaceId: string; run: TaskRun }
| { type: "task.run.updated"; workspaceId: string; run: TaskRun }
| { type: "task.run.finished"; workspaceId: string; run: TaskRun }
| { type: "task.run.stopped"; workspaceId: string; run: TaskRun }
```

Add these topic helpers in `packages/core/src/protocol/topics.ts` after terminal helpers:

```ts
  // Task-level
  workspaceTaskDiscovered: (workspaceId: string) => `workspace.${workspaceId}.task.discovered`,
  workspaceTaskRun: (workspaceId: string, runId: string) =>
    `workspace.${workspaceId}.task.${runId}`,
  workspaceTasksAll: (workspaceId: string) => `workspace.${workspaceId}.task.*`,
```

- [ ] **Step 5: Run the focused core test and typecheck**

Run:

```bash
pnpm --filter @coder-studio/core exec vitest run src/domain/types.test.ts
pnpm --filter @coder-studio/core exec tsc -p tsconfig.json --noEmit
```

Expected: PASS for tests and no TypeScript errors.

- [ ] **Step 6: Commit shared contracts**

Run:

```bash
git add packages/core/src/domain/types.ts packages/core/src/domain/events.ts packages/core/src/protocol/topics.ts packages/core/src/domain/types.test.ts
git commit -m "feat: add task and hunk contracts"
```

### Task 2: Extend Terminal Infrastructure for Task Terminals

**Files:**
- Modify: `packages/server/src/terminal/types.ts`
- Modify: `packages/server/src/terminal/manager.ts`
- Modify: `packages/server/src/storage/repositories/terminal-repo.ts`
- Modify: `packages/server/src/terminal/manager.test.ts`
- Modify: `packages/server/src/__tests__/terminal-commands.test.ts`

- [ ] **Step 1: Write failing terminal kind tests**

Add this test to `packages/server/src/terminal/manager.test.ts` in the create/snapshot behavior section:

```ts
it("creates task terminals with snapshot support", async () => {
  const terminal = manager.create({
    workspaceId: "ws-123",
    kind: "task",
    argv: ["pnpm", "ci:verify"],
    cwd: "/test",
    title: "Task: Verify",
    cols: 100,
    rows: 24,
  });

  expect(terminal.kind).toBe("task");
  expect(terminal.title).toBe("Task: Verify");
  expect(manager.get(terminal.id)?.snapshotBuffer).toBeDefined();
});
```

Add this test to `packages/server/src/__tests__/terminal-commands.test.ts` in the `terminal.list` section:

```ts
it("returns task terminals from terminal.list", async () => {
  const ctx = createContext({
    terminalMgr: {
      getAll: vi.fn(() => [
        {
          id: "term-task",
          workspaceId: "ws-1",
          kind: "task",
          title: "Task: Verify",
          alive: true,
        },
      ]),
    } as never,
  });

  const result = await dispatch(
    {
      kind: "command",
      id: "cmd-1",
      op: "terminal.list",
      args: { workspaceId: "ws-1" },
    },
    ctx,
    "client-1"
  );

  expect(result.ok).toBe(true);
  expect(result.data).toEqual([
    {
      id: "term-task",
      workspaceId: "ws-1",
      kind: "task",
      title: "Task: Verify",
      alive: true,
    },
  ]);
});
```

- [ ] **Step 2: Run focused terminal tests and confirm failures**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/terminal/manager.test.ts src/__tests__/terminal-commands.test.ts
```

Expected: FAIL because server terminal types and repository validation only allow `agent` and `shell`.

- [ ] **Step 3: Update server terminal kind types**

Modify `packages/server/src/terminal/types.ts`:

```ts
import type { Terminal, TerminalKind } from "@coder-studio/core";
```

Change `TerminalSpec.kind` to:

```ts
kind: TerminalKind;
```

Change `TerminalSpawnError.details.terminalKind` to:

```ts
terminalKind?: TerminalKind;
```

- [ ] **Step 4: Give task terminals snapshot buffers**

In `packages/server/src/terminal/manager.ts`, change:

```ts
if (spec.kind === "shell" || spec.kind === "agent") {
```

to:

```ts
if (spec.kind === "shell" || spec.kind === "agent" || spec.kind === "task") {
```

- [ ] **Step 5: Accept persisted task terminals**

In `packages/server/src/storage/repositories/terminal-repo.ts`, import `TerminalKind`:

```ts
import type { Terminal, TerminalKind } from "@coder-studio/core";
```

Add:

```ts
const TERMINAL_KINDS = new Set<TerminalKind>(["agent", "shell", "task"]);
```

Change the `NewTerminal.kind` type to:

```ts
kind: TerminalKind;
```

Change `isTerminal` kind validation to:

```ts
TERMINAL_KINDS.has(value.kind as TerminalKind)
```

- [ ] **Step 6: Run focused terminal tests**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/terminal/manager.test.ts src/__tests__/terminal-commands.test.ts
pnpm --filter @coder-studio/server exec tsc -p tsconfig.json --noEmit
```

Expected: PASS for tests and no TypeScript errors.

- [ ] **Step 7: Commit task terminal support**

Run:

```bash
git add packages/server/src/terminal/types.ts packages/server/src/terminal/manager.ts packages/server/src/storage/repositories/terminal-repo.ts packages/server/src/terminal/manager.test.ts packages/server/src/__tests__/terminal-commands.test.ts
git commit -m "feat: support managed task terminals"
```

### Task 3: Implement Server Task Discovery

**Files:**
- Create: `packages/server/src/tasks/discovery.ts`
- Create: `packages/server/src/tasks/discovery.test.ts`

- [ ] **Step 1: Write failing discovery tests**

Create `packages/server/src/tasks/discovery.test.ts` with:

```ts
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverTasks } from "./discovery.js";

describe("discoverTasks", () => {
  let root: string;

  beforeEach(async () => {
    root = join(tmpdir(), `coder-studio-task-discovery-${Date.now()}-${Math.random()}`);
    await mkdir(root, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("uses explicit .coder-studio/tasks.json definitions first", async () => {
    await mkdir(join(root, ".coder-studio"), { recursive: true });
    await writeFile(
      join(root, ".coder-studio", "tasks.json"),
      JSON.stringify({
        version: 1,
        tasks: [
          {
            id: "verify",
            label: "Verify",
            kind: "verify",
            command: "pnpm",
            args: ["ci:verify"],
            cwdPath: ".",
          },
        ],
      })
    );
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ scripts: { test: "vitest run" } })
    );

    const result = await discoverTasks({ workspaceId: "ws-1", rootPath: root });

    expect(result.tasks[0]).toEqual({
      id: "verify",
      workspaceId: "ws-1",
      kind: "verify",
      label: "Verify",
      command: "pnpm",
      args: ["ci:verify"],
      cwdPath: ".",
      source: "coder-studio",
      priority: 1000,
    });
    expect(result.tasks.map((task) => task.source)).toContain("package-json");
  });

  it("prefers pnpm ci:verify as the default verify task", async () => {
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        scripts: {
          "ci:verify": "pnpm changeset:validate && pnpm ci:lint && pnpm ci:test && pnpm ci:build",
          test: "vitest run",
          lint: "biome lint .",
          build: "tsc -p tsconfig.json",
        },
      })
    );
    await writeFile(join(root, "pnpm-lock.yaml"), "");

    const result = await discoverTasks({ workspaceId: "ws-1", rootPath: root });

    expect(result.tasks[0]).toMatchObject({
      id: "verify",
      kind: "verify",
      label: "Verify",
      command: "pnpm",
      args: ["ci:verify"],
      source: "package-json",
    });
    expect(result.tasks.map((task) => task.id)).toEqual(["verify", "test", "lint", "build"]);
  });

  it("discovers ecosystem convention tasks", async () => {
    await writeFile(join(root, "Cargo.toml"), "[package]\nname = \"demo\"\n");
    await writeFile(join(root, "go.mod"), "module demo\n");
    await writeFile(join(root, "pyproject.toml"), "[project]\nname = \"demo\"\n");
    await writeFile(join(root, "Makefile"), "verify:\n\tpnpm ci:verify\n");

    const result = await discoverTasks({ workspaceId: "ws-1", rootPath: root });

    expect(result.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "cargo-test", command: "cargo", args: ["test"] }),
        expect.objectContaining({ id: "go-test", command: "go", args: ["test", "./..."] }),
        expect.objectContaining({ id: "python-test", command: "python", args: ["-m", "pytest"] }),
        expect.objectContaining({ id: "make-verify", command: "make", args: ["verify"] }),
      ])
    );
  });

  it("returns warnings for malformed sources without failing all discovery", async () => {
    await writeFile(join(root, "package.json"), "{ broken json");
    await writeFile(join(root, "Makefile"), "test:\n\tpnpm test\n");

    const result = await discoverTasks({ workspaceId: "ws-1", rootPath: root });

    expect(result.warnings).toEqual([
      expect.objectContaining({
        source: "package-json",
        message: expect.stringContaining("package.json"),
      }),
    ]);
    expect(result.tasks).toEqual([
      expect.objectContaining({
        id: "make-test",
        command: "make",
        args: ["test"],
      }),
    ]);
  });
});
```

- [ ] **Step 2: Run discovery tests and confirm failure**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/tasks/discovery.test.ts
```

Expected: FAIL because `packages/server/src/tasks/discovery.ts` does not exist.

- [ ] **Step 3: Implement discovery API and helpers**

Create `packages/server/src/tasks/discovery.ts` with these exported shapes and behavior:

```ts
import type { TaskDefinition, TaskKind, TaskSource } from "@coder-studio/core";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export interface TaskDiscoveryInput {
  workspaceId: string;
  rootPath: string;
}

export interface TaskDiscoveryWarning {
  source: TaskSource;
  message: string;
}

export interface TaskDiscoveryResult {
  tasks: TaskDefinition[];
  warnings: TaskDiscoveryWarning[];
}

const coderStudioTaskSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(["verify", "test", "lint", "build", "dev", "custom"]),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  cwdPath: z.string().optional(),
});

const coderStudioTasksFileSchema = z.object({
  version: z.literal(1),
  tasks: z.array(coderStudioTaskSchema),
});

function uniqueTasks(tasks: TaskDefinition[]): TaskDefinition[] {
  const seen = new Set<string>();
  const result: TaskDefinition[] = [];
  for (const task of tasks.sort((left, right) => right.priority - left.priority)) {
    const key = `${task.kind}:${task.id}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(task);
  }
  return result;
}

function packageManagerFor(rootFiles: Set<string>): "pnpm" | "yarn" | "bun" | "npm" {
  if (rootFiles.has("pnpm-lock.yaml") || rootFiles.has("pnpm-workspace.yaml")) return "pnpm";
  if (rootFiles.has("yarn.lock")) return "yarn";
  if (rootFiles.has("bun.lockb") || rootFiles.has("bun.lock")) return "bun";
  return "npm";
}

function scriptTask(
  workspaceId: string,
  scriptName: string,
  kind: TaskKind,
  packageManager: "pnpm" | "yarn" | "bun" | "npm",
  priority: number
): TaskDefinition {
  return {
    id: kind === "verify" ? "verify" : kind,
    workspaceId,
    kind,
    label: kind[0]!.toUpperCase() + kind.slice(1),
    command: packageManager,
    args: [scriptName],
    cwdPath: ".",
    source: "package-json",
    priority,
  };
}
```

Implement `discoverTasks(input)` so it:

- reads `.coder-studio/tasks.json` first and maps valid entries to priority `1000 - index`
- reads root `package.json` and maps `ci:verify` to `verify` priority `900`
- maps `verify`, `test`, `lint`, `build`, and `dev` package scripts when present, with priorities `800`, `700`, `600`, `500`, and `100`
- maps `Cargo.toml` to `cargo test`
- maps `go.mod` to `go test ./...`
- maps `pyproject.toml` to `python -m pytest`
- maps `Makefile` targets named `verify`, `test`, `lint`, and `build` to `make <target>`
- catches per-source parse/read errors and pushes warnings instead of throwing
- returns `uniqueTasks(tasks)` sorted by descending priority

Use IDs exactly as asserted in the tests: `verify`, `test`, `lint`, `build`, `dev`, `cargo-test`, `go-test`, `python-test`, and `make-${target}`.

- [ ] **Step 4: Run discovery tests**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/tasks/discovery.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit discovery**

Run:

```bash
git add packages/server/src/tasks/discovery.ts packages/server/src/tasks/discovery.test.ts
git commit -m "feat: discover workspace tasks"
```

### Task 4: Implement Server Task Manager

**Files:**
- Create: `packages/server/src/tasks/manager.ts`
- Create: `packages/server/src/tasks/manager.test.ts`

- [ ] **Step 1: Write failing manager tests**

Create `packages/server/src/tasks/manager.test.ts` with:

```ts
import type { DomainEvent, TaskDefinition, Terminal } from "@coder-studio/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../bus/event-bus.js";
import { TaskManager } from "./manager.js";

function createTask(overrides: Partial<TaskDefinition> = {}): TaskDefinition {
  return {
    id: "verify",
    workspaceId: "ws-1",
    kind: "verify",
    label: "Verify",
    command: "pnpm",
    args: ["ci:verify"],
    cwdPath: ".",
    source: "package-json",
    priority: 900,
    ...overrides,
  };
}

describe("TaskManager", () => {
  let eventBus: EventBus;
  let events: DomainEvent[];
  let terminalMgr: {
    create: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
  let manager: TaskManager;

  beforeEach(() => {
    eventBus = new EventBus();
    events = [];
    for (const type of [
      "task.discovered",
      "task.run.started",
      "task.run.updated",
      "task.run.finished",
      "task.run.stopped",
    ] as const) {
      eventBus.on(type, (event) => events.push(event));
    }
    terminalMgr = {
      create: vi.fn((spec) => ({
        id: "term-task",
        workspaceId: spec.workspaceId,
        kind: spec.kind,
        title: spec.title,
        cwd: spec.cwd,
        argv: spec.argv,
        cols: 120,
        rows: 30,
        alive: true,
        createdAt: 1,
      })),
      close: vi.fn(async () => undefined),
    };
    manager = new TaskManager({
      eventBus,
      terminalMgr: terminalMgr as never,
      now: () => 1000,
    });
  });

  it("stores discovered tasks and emits task.discovered", () => {
    const tasks = [createTask()];

    manager.setDiscoveredTasks("ws-1", tasks);

    expect(manager.list("ws-1")).toEqual(tasks);
    expect(events).toEqual([
      {
        type: "task.discovered",
        workspaceId: "ws-1",
        tasks,
      },
    ]);
  });

  it("runs a task through a managed task terminal", async () => {
    manager.setDiscoveredTasks("ws-1", [createTask()]);

    const run = await manager.run({
      workspaceId: "ws-1",
      workspacePath: "/repo",
      taskId: "verify",
      themeBackground: "#0b1218",
    });

    expect(terminalMgr.create).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      kind: "task",
      argv: ["pnpm", "ci:verify"],
      cwd: "/repo",
      title: "Task: Verify",
      cols: 120,
      rows: 30,
      themeBackground: "#0b1218",
    });
    expect(run).toMatchObject({
      workspaceId: "ws-1",
      taskId: "verify",
      terminalId: "term-task",
      status: "running",
      command: "pnpm",
      args: ["ci:verify"],
      cwdPath: ".",
      startedAt: 1000,
    });
    expect(events.at(-1)).toEqual({
      type: "task.run.started",
      workspaceId: "ws-1",
      run,
    });
  });

  it("marks a run passed when its task terminal exits with zero", async () => {
    manager.setDiscoveredTasks("ws-1", [createTask()]);
    const run = await manager.run({ workspaceId: "ws-1", workspacePath: "/repo", taskId: "verify" });

    eventBus.emit({
      type: "terminal.exited",
      workspaceId: "ws-1",
      terminalId: run.terminalId,
      exitCode: 0,
    });

    expect(manager.history("ws-1")[0]).toMatchObject({
      id: run.id,
      status: "passed",
      exitCode: 0,
      finishedAt: 1000,
    });
    expect(events.at(-1)?.type).toBe("task.run.finished");
  });

  it("marks a run failed and records capped output tail on non-zero exit", async () => {
    manager.setDiscoveredTasks("ws-1", [createTask()]);
    const run = await manager.run({ workspaceId: "ws-1", workspacePath: "/repo", taskId: "verify" });

    for (let index = 0; index < 14; index += 1) {
      eventBus.emit({
        type: "terminal.output",
        workspaceId: "ws-1",
        terminalId: run.terminalId,
        chunk: Buffer.from(`line ${index}\n`),
        seq: index + 1,
      });
    }
    eventBus.emit({
      type: "terminal.exited",
      workspaceId: "ws-1",
      terminalId: run.terminalId,
      exitCode: 1,
    });

    const latest = manager.history("ws-1")[0]!;
    expect(latest.status).toBe("failed");
    expect(latest.summary?.tailLines).toEqual([
      "line 4",
      "line 5",
      "line 6",
      "line 7",
      "line 8",
      "line 9",
      "line 10",
      "line 11",
      "line 12",
      "line 13",
    ]);
  });

  it("stops a running task terminal and emits task.run.stopped", async () => {
    manager.setDiscoveredTasks("ws-1", [createTask()]);
    const run = await manager.run({ workspaceId: "ws-1", workspacePath: "/repo", taskId: "verify" });

    const stopped = await manager.stop({ workspaceId: "ws-1", runId: run.id });

    expect(terminalMgr.close).toHaveBeenCalledWith(run.terminalId);
    expect(stopped).toMatchObject({
      id: run.id,
      status: "stopped",
      finishedAt: 1000,
    });
    expect(events.at(-1)?.type).toBe("task.run.stopped");
  });
});
```

- [ ] **Step 2: Run manager tests and confirm failure**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/tasks/manager.test.ts
```

Expected: FAIL because `packages/server/src/tasks/manager.ts` does not exist.

- [ ] **Step 3: Implement TaskManager public API**

Create `packages/server/src/tasks/manager.ts` with:

```ts
import type { DomainEvent, TaskDefinition, TaskRun } from "@coder-studio/core";
import { isAbsolute, join } from "node:path";
import type { EventBus } from "../bus/event-bus.js";
import { resolveSafe } from "../fs/file-io.js";
import type { TerminalManager } from "../terminal/manager.js";

interface TaskManagerDeps {
  eventBus: EventBus;
  terminalMgr: Pick<TerminalManager, "create" | "close">;
  now?: () => number;
}

interface RunTaskInput {
  workspaceId: string;
  workspacePath: string;
  taskId: string;
  themeBackground?: string;
}

interface StopTaskInput {
  workspaceId: string;
  runId: string;
}

const TASK_TAIL_LINE_LIMIT = 10;

function createRunId(): string {
  return `taskrun_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeOutputLines(chunk: Buffer): string[] {
  return chunk
    .toString("utf8")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
}

export class TaskManager {
  private readonly now: () => number;
  private tasksByWorkspace = new Map<string, TaskDefinition[]>();
  private runsByWorkspace = new Map<string, TaskRun[]>();
  private runByTerminalId = new Map<string, TaskRun>();
  private outputTailByRunId = new Map<string, string[]>();

  constructor(private readonly deps: TaskManagerDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.deps.eventBus.on("terminal.output", (event) => this.onTerminalOutput(event));
    this.deps.eventBus.on("terminal.exited", (event) => this.onTerminalExited(event));
  }

  setDiscoveredTasks(workspaceId: string, tasks: TaskDefinition[]): TaskDefinition[] {
    this.tasksByWorkspace.set(workspaceId, tasks);
    this.deps.eventBus.emit({ type: "task.discovered", workspaceId, tasks });
    return tasks;
  }

  list(workspaceId: string): TaskDefinition[] {
    return this.tasksByWorkspace.get(workspaceId) ?? [];
  }

  history(workspaceId: string): TaskRun[] {
    return this.runsByWorkspace.get(workspaceId) ?? [];
  }

  latestVerify(workspaceId: string): TaskRun | undefined {
    return this.history(workspaceId).find((run) => run.taskId === "verify");
  }

  async run(input: RunTaskInput): Promise<TaskRun> {
    const task = this.list(input.workspaceId).find((candidate) => candidate.id === input.taskId);
    if (!task) {
      throw { code: "task_not_found", message: `Task not found: ${input.taskId}` };
    }

    const cwd = this.resolveTaskCwd(input.workspacePath, task.cwdPath);
    const terminal = this.deps.terminalMgr.create({
      workspaceId: input.workspaceId,
      kind: "task",
      argv: [task.command, ...task.args],
      cwd,
      title: `Task: ${task.label}`,
      cols: 120,
      rows: 30,
      themeBackground: input.themeBackground,
    });

    const run: TaskRun = {
      id: createRunId(),
      workspaceId: input.workspaceId,
      taskId: task.id,
      terminalId: terminal.id,
      status: "running",
      command: task.command,
      args: task.args,
      cwdPath: task.cwdPath,
      startedAt: this.now(),
    };

    this.storeRun(run);
    this.runByTerminalId.set(terminal.id, run);
    this.deps.eventBus.emit({ type: "task.run.started", workspaceId: input.workspaceId, run });
    return run;
  }

  async rerun(input: RunTaskInput): Promise<TaskRun> {
    return this.run(input);
  }

  async stop(input: StopTaskInput): Promise<TaskRun> {
    const run = this.history(input.workspaceId).find((candidate) => candidate.id === input.runId);
    if (!run) {
      throw { code: "task_run_not_found", message: `Task run not found: ${input.runId}` };
    }
    if (run.status !== "running" && run.status !== "queued") {
      return run;
    }

    await this.deps.terminalMgr.close(run.terminalId);
    const stopped = this.updateRun(run, {
      status: "stopped",
      finishedAt: this.now(),
      summary: { tailLines: this.outputTailByRunId.get(run.id) ?? [] },
    });
    this.runByTerminalId.delete(run.terminalId);
    this.deps.eventBus.emit({
      type: "task.run.stopped",
      workspaceId: input.workspaceId,
      run: stopped,
    });
    return stopped;
  }

  clearWorkspace(workspaceId: string): void {
    this.tasksByWorkspace.delete(workspaceId);
    const runs = this.runsByWorkspace.get(workspaceId) ?? [];
    for (const run of runs) {
      this.runByTerminalId.delete(run.terminalId);
      this.outputTailByRunId.delete(run.id);
    }
    this.runsByWorkspace.delete(workspaceId);
  }

  private resolveTaskCwd(workspacePath: string, cwdPath: string | undefined): string {
    if (!cwdPath || cwdPath === ".") {
      return workspacePath;
    }
    if (isAbsolute(cwdPath)) {
      throw { code: "invalid_task_cwd", message: "Task cwdPath must be workspace-relative" };
    }
    return resolveSafe(workspacePath, cwdPath);
  }

  private storeRun(run: TaskRun): void {
    const current = this.runsByWorkspace.get(run.workspaceId) ?? [];
    const withoutSameTask = current.filter((candidate) => candidate.taskId !== run.taskId);
    this.runsByWorkspace.set(run.workspaceId, [run, ...withoutSameTask]);
  }

  private updateRun(run: TaskRun, patch: Partial<TaskRun>): TaskRun {
    const next = { ...run, ...patch };
    this.storeRun(next);
    this.runByTerminalId.set(next.terminalId, next);
    return next;
  }

  private onTerminalOutput(event: Extract<DomainEvent, { type: "terminal.output" }>): void {
    const run = this.runByTerminalId.get(event.terminalId);
    if (!run) {
      return;
    }
    const previous = this.outputTailByRunId.get(run.id) ?? [];
    const next = [...previous, ...normalizeOutputLines(event.chunk)].slice(-TASK_TAIL_LINE_LIMIT);
    this.outputTailByRunId.set(run.id, next);
  }

  private onTerminalExited(event: Extract<DomainEvent, { type: "terminal.exited" }>): void {
    const run = this.runByTerminalId.get(event.terminalId);
    if (!run || run.status === "stopped") {
      return;
    }

    const finished = this.updateRun(run, {
      status: event.exitCode === 0 ? "passed" : "failed",
      finishedAt: this.now(),
      exitCode: event.exitCode,
      summary: { tailLines: this.outputTailByRunId.get(run.id) ?? [] },
    });
    this.runByTerminalId.delete(event.terminalId);
    this.deps.eventBus.emit({
      type: "task.run.finished",
      workspaceId: event.workspaceId,
      run: finished,
    });
  }
}
```

- [ ] **Step 4: Run manager tests**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/tasks/manager.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit manager**

Run:

```bash
git add packages/server/src/tasks/manager.ts packages/server/src/tasks/manager.test.ts
git commit -m "feat: manage task runs"
```

### Task 5: Add Task Commands and WebSocket Events

**Files:**
- Create: `packages/server/src/commands/task.ts`
- Create: `packages/server/src/__tests__/task-commands.test.ts`
- Modify: `packages/server/src/commands/index.ts`
- Modify: `packages/server/src/ws/dispatch.ts`
- Modify: `packages/server/src/ws/hub.ts`
- Modify: `packages/server/src/server.ts`

- [ ] **Step 1: Write failing command tests**

Create `packages/server/src/__tests__/task-commands.test.ts` with:

```ts
import type { TaskDefinition, TaskRun } from "@coder-studio/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../commands/index.js";
import { dispatch, type CommandContext } from "../ws/dispatch.js";

function createContext(): CommandContext {
  const workspace = { id: "ws-1", path: "/repo" };
  const task: TaskDefinition = {
    id: "verify",
    workspaceId: "ws-1",
    kind: "verify",
    label: "Verify",
    command: "pnpm",
    args: ["ci:verify"],
    cwdPath: ".",
    source: "package-json",
    priority: 900,
  };
  const run: TaskRun = {
    id: "run-1",
    workspaceId: "ws-1",
    taskId: "verify",
    terminalId: "term-task",
    status: "running",
    command: "pnpm",
    args: ["ci:verify"],
    cwdPath: ".",
    startedAt: 100,
  };

  return {
    workspaceMgr: {
      get: vi.fn(() => workspace),
    },
    taskMgr: {
      setDiscoveredTasks: vi.fn((_workspaceId, tasks) => tasks),
      list: vi.fn(() => [task]),
      history: vi.fn(() => [run]),
      run: vi.fn(async () => run),
      rerun: vi.fn(async () => run),
      stop: vi.fn(async () => ({ ...run, status: "stopped", finishedAt: 200 })),
    },
    terminalMgr: {},
    sessionMgr: {},
    eventBus: {},
    broadcaster: {},
    settingsRepo: {},
    providerConfigRepo: {},
    providerRegistry: [],
    fencingMgr: {},
    supervisorMgr: {},
    autoFetch: {},
    activationMgr: { getLease: vi.fn(() => ({ wsClientId: "client-1" })) },
    lspMgr: {},
  } as unknown as CommandContext;
}

describe("task commands", () => {
  let ctx: CommandContext;

  beforeEach(() => {
    ctx = createContext();
  });

  it("lists task definitions", async () => {
    const result = await dispatch(
      { kind: "command", id: "cmd-1", op: "task.list", args: { workspaceId: "ws-1" } },
      ctx,
      "client-1"
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual(ctx.taskMgr.list("ws-1"));
  });

  it("runs a task for the workspace root", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "cmd-1",
        op: "task.run",
        args: { workspaceId: "ws-1", taskId: "verify", themeBackground: "#0b1218" },
      },
      ctx,
      "client-1"
    );

    expect(result.ok).toBe(true);
    expect(ctx.taskMgr.run).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      workspacePath: "/repo",
      taskId: "verify",
      themeBackground: "#0b1218",
    });
  });

  it("stops a running task", async () => {
    const result = await dispatch(
      { kind: "command", id: "cmd-1", op: "task.stop", args: { workspaceId: "ws-1", runId: "run-1" } },
      ctx,
      "client-1"
    );

    expect(result.ok).toBe(true);
    expect(ctx.taskMgr.stop).toHaveBeenCalledWith({ workspaceId: "ws-1", runId: "run-1" });
  });

  it("returns workspace_not_found for missing workspaces", async () => {
    vi.mocked(ctx.workspaceMgr.get).mockReturnValueOnce(undefined);

    const result = await dispatch(
      { kind: "command", id: "cmd-1", op: "task.run", args: { workspaceId: "missing", taskId: "verify" } },
      ctx,
      "client-1"
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("workspace_not_found");
  });
});
```

- [ ] **Step 2: Run command tests and confirm failure**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/task-commands.test.ts
```

Expected: FAIL because task commands are not registered and `CommandContext` lacks `taskMgr`.

- [ ] **Step 3: Register task commands**

Create `packages/server/src/commands/task.ts`:

```ts
import { z } from "zod";
import { discoverTasks } from "../tasks/discovery.js";
import { registerCommand } from "../ws/dispatch.js";

const workspaceSchema = z.object({
  workspaceId: z.string(),
});

const taskRunSchema = z.object({
  workspaceId: z.string(),
  taskId: z.string(),
  themeBackground: z
    .string()
    .regex(/^#[0-9a-fA-F]{3,8}$/)
    .optional(),
});

function getWorkspaceOrThrow(ctx: Parameters<Parameters<typeof registerCommand>[2]>[1], workspaceId: string) {
  const workspace = ctx.workspaceMgr.get(workspaceId);
  if (!workspace) {
    throw { code: "workspace_not_found", message: `Workspace not found: ${workspaceId}` };
  }
  return workspace;
}

registerCommand("task.discover", workspaceSchema, async (args, ctx) => {
  const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
  const result = await discoverTasks({ workspaceId: args.workspaceId, rootPath: workspace.path });
  const tasks = ctx.taskMgr.setDiscoveredTasks(args.workspaceId, result.tasks);
  return { tasks, warnings: result.warnings };
});

registerCommand("task.list", workspaceSchema, async (args, ctx) => {
  getWorkspaceOrThrow(ctx, args.workspaceId);
  const existing = ctx.taskMgr.list(args.workspaceId);
  if (existing.length > 0) {
    return existing;
  }
  const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
  const result = await discoverTasks({ workspaceId: args.workspaceId, rootPath: workspace.path });
  return ctx.taskMgr.setDiscoveredTasks(args.workspaceId, result.tasks);
});

registerCommand("task.run", taskRunSchema, async (args, ctx) => {
  const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
  if (ctx.taskMgr.list(args.workspaceId).length === 0) {
    const result = await discoverTasks({ workspaceId: args.workspaceId, rootPath: workspace.path });
    ctx.taskMgr.setDiscoveredTasks(args.workspaceId, result.tasks);
  }
  return ctx.taskMgr.run({
    workspaceId: args.workspaceId,
    workspacePath: workspace.path,
    taskId: args.taskId,
    themeBackground: args.themeBackground,
  });
});

registerCommand("task.rerun", taskRunSchema, async (args, ctx) => {
  const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
  return ctx.taskMgr.rerun({
    workspaceId: args.workspaceId,
    workspacePath: workspace.path,
    taskId: args.taskId,
    themeBackground: args.themeBackground,
  });
});

registerCommand(
  "task.stop",
  z.object({
    workspaceId: z.string(),
    runId: z.string(),
  }),
  async (args, ctx) => {
    getWorkspaceOrThrow(ctx, args.workspaceId);
    return ctx.taskMgr.stop({ workspaceId: args.workspaceId, runId: args.runId });
  }
);

registerCommand("task.history", workspaceSchema, async (args, ctx) => {
  getWorkspaceOrThrow(ctx, args.workspaceId);
  return ctx.taskMgr.history(args.workspaceId);
});
```

Use an explicit `CommandContext` import if TypeScript rejects the helper type:

```ts
import type { CommandContext } from "../ws/dispatch.js";

function getWorkspaceOrThrow(ctx: CommandContext, workspaceId: string) {
  ...
}
```

- [ ] **Step 4: Wire command registration and context**

Add this import to `packages/server/src/commands/index.ts`:

```ts
import "./task.js";
```

Add this import to `packages/server/src/ws/dispatch.ts`:

```ts
import type { TaskManager } from "../tasks/manager.js";
```

Add this field to `CommandContext`:

```ts
taskMgr: TaskManager;
```

Add this import to `packages/server/src/server.ts`:

```ts
import { TaskManager } from "./tasks/manager.js";
```

Construct the manager after `terminalMgr`:

```ts
const taskMgr = new TaskManager({
  eventBus,
  terminalMgr,
});
```

In workspace teardown, before closing terminals, add:

```ts
taskMgr.clearWorkspace(workspaceId);
```

Add `taskMgr` to `commandContext`.

- [ ] **Step 5: Broadcast task events**

In `packages/server/src/ws/hub.ts`, add task event types to `eventTypes`:

```ts
"task.discovered",
"task.run.started",
"task.run.updated",
"task.run.finished",
"task.run.stopped",
```

Add switch cases:

```ts
case "task.discovered":
  topic = Topics.workspaceTaskDiscovered(event.workspaceId);
  data = { tasks: event.tasks };
  break;

case "task.run.started":
case "task.run.updated":
case "task.run.finished":
case "task.run.stopped":
  topic = Topics.workspaceTaskRun(event.workspaceId, event.run.id);
  data = { event: event.type, run: event.run };
  break;
```

- [ ] **Step 6: Run command and server type tests**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/__tests__/task-commands.test.ts
pnpm --filter @coder-studio/server exec tsc -p tsconfig.json --noEmit
```

Expected: PASS for tests and no TypeScript errors.

- [ ] **Step 7: Commit task commands**

Run:

```bash
git add packages/server/src/commands/task.ts packages/server/src/commands/index.ts packages/server/src/ws/dispatch.ts packages/server/src/ws/hub.ts packages/server/src/server.ts packages/server/src/__tests__/task-commands.test.ts
git commit -m "feat: expose task commands"
```

### Task 6: Add Web Bottom Panel Tabs and Task Terminal Visibility

**Files:**
- Create: `packages/web/src/features/bottom-panel/atoms.ts`
- Create: `packages/web/src/features/bottom-panel/index.ts`
- Create: `packages/web/src/features/workspace/views/shared/workspace-bottom-panel.tsx`
- Modify: `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx`
- Modify: `packages/web/src/features/terminal-panel/atoms/terminals.ts`
- Modify: `packages/web/src/features/terminal-panel/actions/use-terminal-actions.ts`
- Modify: `packages/web/src/features/terminal-panel/components/title-format.ts`
- Modify: `packages/web/src/features/terminal-panel/views/shared/terminal-selector-item.tsx`
- Modify: `packages/web/src/features/terminal-panel/views/shared/terminal-tab.tsx`
- Modify: `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.test.tsx`
- Modify: `packages/web/src/features/terminal-panel/__tests__/terminal-panel.test.tsx`

- [ ] **Step 1: Write failing bottom-panel tests**

In `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.test.tsx`, add a mock for the bottom panel if the file currently mocks `TerminalPanel` directly:

```ts
vi.mock("../shared/workspace-bottom-panel", () => ({
  WorkspaceBottomPanel: () => <div data-testid="workspace-bottom-panel">Terminal Tasks</div>,
}));
```

Add this test:

```ts
it("renders the shared workspace bottom panel on desktop", () => {
  renderWorkspaceDesktopView();

  expect(screen.getByTestId("workspace-bottom-panel")).toHaveTextContent("Terminal Tasks");
});
```

In `packages/web/src/features/terminal-panel/__tests__/terminal-panel.test.tsx`, add a terminal list response that includes a shell, a task, and an agent, then assert the shell and task appear while the agent does not:

```ts
it("shows shell and task terminals but excludes agent terminals", async () => {
  sendCommand.mockImplementation(async (op) => {
    if (op === "terminal.list") {
      return {
        ok: true,
        data: [
          { id: "term-shell", workspaceId: "ws-test", kind: "shell", title: "bash", alive: true },
          { id: "term-task", workspaceId: "ws-test", kind: "task", title: "Task: Verify", alive: true },
          { id: "term-agent", workspaceId: "ws-test", kind: "agent", title: "Codex", alive: true },
        ],
      };
    }
    return { ok: true, data: {} };
  });

  renderWithStore(<TerminalPanel />);

  expect(await screen.findByText(/bash/i)).toBeInTheDocument();
  expect(screen.getByText("Task: Verify")).toBeInTheDocument();
  expect(screen.queryByText("Codex")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run focused web tests and confirm failures**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/workspace/views/desktop/workspace-desktop-view.test.tsx src/features/terminal-panel/__tests__/terminal-panel.test.tsx
```

Expected: FAIL because `WorkspaceBottomPanel` does not exist and terminal metadata excludes `task`.

- [ ] **Step 3: Add bottom-panel active tab state**

Create `packages/web/src/features/bottom-panel/atoms.ts`:

```ts
import { atom } from "jotai";
import { atomFamily } from "jotai-family";

export type BottomPanelTab = "terminal" | "tasks";

export const bottomPanelActiveTabAtomFamily = atomFamily((_workspaceId: string) =>
  atom<BottomPanelTab>("terminal")
);
```

Create `packages/web/src/features/bottom-panel/index.ts`:

```ts
export * from "./atoms";
```

- [ ] **Step 4: Add WorkspaceBottomPanel**

Create `packages/web/src/features/workspace/views/shared/workspace-bottom-panel.tsx`:

```tsx
import { useAtom } from "jotai";
import { Tab, TabList, Tabs } from "../../../../components/ui";
import { bottomPanelActiveTabAtomFamily } from "../../../bottom-panel";
import { TasksPanel } from "../../../tasks/views/shared/tasks-panel";
import { TerminalPanel } from "../../../terminal-panel";
import { useTranslation } from "../../../../lib/i18n";

interface WorkspaceBottomPanelProps {
  workspaceId: string;
}

export function WorkspaceBottomPanel({ workspaceId }: WorkspaceBottomPanelProps) {
  const t = useTranslation();
  const [activeTab, setActiveTab] = useAtom(bottomPanelActiveTabAtomFamily(workspaceId));

  return (
    <div className="workspace-bottom-panel-shell">
      <Tabs
        aria-label={t("bottom_panel.tabs_label")}
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as "terminal" | "tasks")}
      >
        <TabList className="workspace-bottom-panel-tabs">
          <Tab value="terminal">{t("bottom_panel.terminal")}</Tab>
          <Tab value="tasks">{t("bottom_panel.tasks")}</Tab>
        </TabList>
      </Tabs>
      <div className="workspace-bottom-panel-body">
        {activeTab === "terminal" ? <TerminalPanel /> : <TasksPanel workspaceId={workspaceId} />}
      </div>
    </div>
  );
}
```

If the UI `Tabs` package does not export `Tab`, use the existing primitive names from `packages/web/src/components/ui/tabs.tsx` and keep the rendered labels and value behavior identical.

- [ ] **Step 5: Mount WorkspaceBottomPanel on desktop**

In `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx`, replace:

```tsx
import { TerminalPanel } from "../../../terminal-panel";
```

with:

```tsx
import { WorkspaceBottomPanel } from "../shared/workspace-bottom-panel";
```

Replace:

```tsx
<TerminalPanel />
```

with:

```tsx
<WorkspaceBottomPanel workspaceId={workspace.id} />
```

- [ ] **Step 6: Include task terminals in terminal panel state**

In `packages/web/src/features/terminal-panel/atoms/terminals.ts`, import `TerminalKind`:

```ts
import type { TerminalKind } from "@coder-studio/core";
```

Change `TerminalMeta.kind` to:

```ts
kind: TerminalKind;
```

In `packages/web/src/features/terminal-panel/actions/use-terminal-actions.ts`, change:

```ts
const shellTerminals = result.data.filter((terminal) => terminal.kind === "shell");
const shellIds = shellTerminals.map((terminal) => terminal.id);

for (const terminal of shellTerminals) {
  store.set(terminalMetaAtomFamily(terminal.id), toTerminalMeta(terminal));
}

setTerminalIds((current) => mergeTerminalIds(current, shellIds));
setActiveTerminalId((current) => current ?? shellIds[0] ?? null);
```

to:

```ts
const panelTerminals = result.data.filter(
  (terminal) => terminal.kind === "shell" || terminal.kind === "task"
);
const panelIds = panelTerminals.map((terminal) => terminal.id);

for (const terminal of panelTerminals) {
  store.set(terminalMetaAtomFamily(terminal.id), toTerminalMeta(terminal));
}

setTerminalIds((current) => mergeTerminalIds(current, panelIds));
setActiveTerminalId((current) => current ?? panelIds[0] ?? null);
```

In the created-event branch, change:

```ts
const createData = payload as { id: string; kind: "shell" | "agent" };
if (createData.kind !== "shell") {
  return;
}
```

to:

```ts
const createData = payload as { id: string; kind: "shell" | "agent" | "task"; title?: string; workspaceId?: string };
if (createData.kind !== "shell" && createData.kind !== "task") {
  return;
}
store.set(terminalMetaAtomFamily(createData.id), {
  id: createData.id,
  workspaceId: createData.workspaceId ?? activeWorkspaceId,
  kind: createData.kind,
  alive: true,
  title: createData.title,
});
```

Keep the existing output subscription guard aligned:

```ts
if (!meta || (meta.kind !== "shell" && meta.kind !== "task")) {
  return;
}
```

- [ ] **Step 7: Preserve task terminal labels and add managed markers**

In `packages/web/src/features/terminal-panel/components/title-format.ts`, short-circuit task labels:

```ts
if (meta?.kind === "task" && rawTitle) {
  return rawTitle;
}
```

Add a managed marker in `terminal-selector-item.tsx` and `terminal-tab.tsx` by reading `terminalMeta.kind === "task"` and rendering:

```tsx
{terminalMeta?.kind === "task" ? (
  <span className="terminal-managed-badge">{t("terminal.managed_task")}</span>
) : null}
```

Add styles for `.terminal-managed-badge` in the existing terminal CSS file used by these components. Keep it compact: uppercase, 10px font, muted border, no layout shift.

- [ ] **Step 8: Add translations**

Add these keys to `packages/web/src/locales/en.json`:

```json
{
  "bottom_panel": {
    "tabs_label": "Bottom panel",
    "terminal": "Terminal",
    "tasks": "Tasks"
  },
  "terminal": {
    "managed_task": "Managed"
  }
}
```

Merge these keys into the existing objects rather than replacing existing `terminal` content.

Add these keys to `packages/web/src/locales/zh.json`:

```json
{
  "bottom_panel": {
    "tabs_label": "底部面板",
    "terminal": "终端",
    "tasks": "任务"
  },
  "terminal": {
    "managed_task": "托管"
  }
}
```

- [ ] **Step 9: Run focused web tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/workspace/views/desktop/workspace-desktop-view.test.tsx src/features/terminal-panel/__tests__/terminal-panel.test.tsx
pnpm --filter @coder-studio/web exec tsc -p tsconfig.json --noEmit
```

Expected: PASS for tests and no TypeScript errors.

- [ ] **Step 10: Commit bottom-panel terminal support**

Run:

```bash
git add packages/web/src/features/bottom-panel packages/web/src/features/workspace/views/shared/workspace-bottom-panel.tsx packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx packages/web/src/features/workspace/views/desktop/workspace-desktop-view.test.tsx packages/web/src/features/terminal-panel packages/web/src/locales/en.json packages/web/src/locales/zh.json
git commit -m "feat: add bottom panel task tab shell"
```

### Task 7: Add Tasks Panel and Task Actions

**Files:**
- Create: `packages/web/src/features/tasks/atoms.ts`
- Create: `packages/web/src/features/tasks/actions/use-task-actions.ts`
- Create: `packages/web/src/features/tasks/views/shared/tasks-panel.tsx`
- Create: `packages/web/src/features/tasks/__tests__/tasks-panel.test.tsx`
- Create: `packages/web/src/features/tasks/index.ts`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`

- [ ] **Step 1: Write failing TasksPanel tests**

Create `packages/web/src/features/tasks/__tests__/tasks-panel.test.tsx` with:

```tsx
import type { TaskDefinition, TaskRun } from "@coder-studio/core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchCommandAtom, wsClientAtom } from "../../../atoms/connection";
import { bottomPanelActiveTabAtomFamily } from "../../bottom-panel";
import { terminalActiveIdAtomFamily, terminalIdsAtomFamily, terminalMetaAtomFamily } from "../../terminal-panel/atoms";
import { TasksPanel } from "../views/shared/tasks-panel";

const verifyTask: TaskDefinition = {
  id: "verify",
  workspaceId: "ws-test",
  kind: "verify",
  label: "Verify",
  command: "pnpm",
  args: ["ci:verify"],
  cwdPath: ".",
  source: "package-json",
  priority: 900,
};

const runningRun: TaskRun = {
  id: "run-1",
  workspaceId: "ws-test",
  taskId: "verify",
  terminalId: "term-task",
  status: "running",
  command: "pnpm",
  args: ["ci:verify"],
  cwdPath: ".",
  startedAt: 100,
};

function renderPanel(options: { dispatch?: ReturnType<typeof vi.fn>; wsClient?: unknown } = {}) {
  const store = createStore();
  const dispatch = options.dispatch ?? vi.fn(async (op: string) => {
    if (op === "task.list") return { ok: true, data: [verifyTask] };
    if (op === "task.history") return { ok: true, data: [] };
    if (op === "task.run") return { ok: true, data: runningRun };
    return { ok: true, data: {} };
  });
  store.set(dispatchCommandAtom, dispatch as never);
  store.set(wsClientAtom, (options.wsClient ?? { subscribe: vi.fn(() => vi.fn()) }) as never);

  render(
    <Provider store={store}>
      <TasksPanel workspaceId="ws-test" />
    </Provider>
  );

  return { store, dispatch };
}

describe("TasksPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders discovered tasks with command previews", async () => {
    renderPanel();

    expect(await screen.findByText("Verify")).toBeInTheDocument();
    expect(screen.getByText("pnpm ci:verify")).toBeInTheDocument();
    expect(screen.getByText("Not run")).toBeInTheDocument();
  });

  it("runs a task and switches output to the terminal tab", async () => {
    const user = userEvent.setup();
    const { store, dispatch } = renderPanel();

    await user.click(await screen.findByRole("button", { name: /run verify/i }));

    expect(dispatch).toHaveBeenCalledWith("task.run", expect.objectContaining({
      workspaceId: "ws-test",
      taskId: "verify",
    }));
    await waitFor(() => {
      expect(store.get(bottomPanelActiveTabAtomFamily("ws-test"))).toBe("terminal");
    });
    expect(store.get(terminalActiveIdAtomFamily("ws-test"))).toBe("term-task");
    expect(store.get(terminalIdsAtomFamily("ws-test"))).toContain("term-task");
    expect(store.get(terminalMetaAtomFamily("term-task"))).toMatchObject({
      kind: "task",
      title: "Task: Verify",
    });
  });

  it("stops a running task", async () => {
    const user = userEvent.setup();
    const dispatch = vi.fn(async (op: string) => {
      if (op === "task.list") return { ok: true, data: [verifyTask] };
      if (op === "task.history") return { ok: true, data: [runningRun] };
      if (op === "task.stop") return { ok: true, data: { ...runningRun, status: "stopped", finishedAt: 200 } };
      return { ok: true, data: {} };
    });
    renderPanel({ dispatch });

    await user.click(await screen.findByRole("button", { name: /stop verify/i }));

    expect(dispatch).toHaveBeenCalledWith("task.stop", {
      workspaceId: "ws-test",
      runId: "run-1",
    });
  });
});
```

- [ ] **Step 2: Run TasksPanel tests and confirm failure**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/tasks/__tests__/tasks-panel.test.tsx
```

Expected: FAIL because the tasks feature files do not exist.

- [ ] **Step 3: Add task atoms**

Create `packages/web/src/features/tasks/atoms.ts`:

```ts
import type { TaskDefinition, TaskRun } from "@coder-studio/core";
import { atom } from "jotai";
import { atomFamily } from "jotai-family";

export interface TaskState {
  tasks: TaskDefinition[];
  runs: TaskRun[];
  loading: boolean;
  error?: string;
}

export const taskStateAtomFamily = atomFamily((_workspaceId: string) =>
  atom<TaskState>({
    tasks: [],
    runs: [],
    loading: false,
  })
);

export const latestVerifyRunAtomFamily = atomFamily((workspaceId: string) =>
  atom((get) => get(taskStateAtomFamily(workspaceId)).runs.find((run) => run.taskId === "verify"))
);
```

Create `packages/web/src/features/tasks/index.ts`:

```ts
export * from "./atoms";
export { TasksPanel } from "./views/shared/tasks-panel";
```

- [ ] **Step 4: Add task actions**

Create `packages/web/src/features/tasks/actions/use-task-actions.ts` with:

```ts
import type { TaskDefinition, TaskRun, Terminal } from "@coder-studio/core";
import { Topics } from "@coder-studio/core";
import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback, useEffect } from "react";
import { dispatchCommandAtom, wsClientAtom } from "../../../atoms/connection";
import { useTranslation } from "../../../lib/i18n";
import { useTerminalThemeBackground } from "../../../theme";
import { bottomPanelActiveTabAtomFamily } from "../../bottom-panel";
import { pushToastAtom } from "../../notifications/atoms";
import {
  terminalActiveIdAtomFamily,
  terminalIdsAtomFamily,
  terminalMetaAtomFamily,
} from "../../terminal-panel/atoms";
import { taskStateAtomFamily } from "../atoms";

function commandPreview(task: TaskDefinition): string {
  return [task.command, ...task.args].join(" ");
}

function taskTerminalTitle(task: TaskDefinition): string {
  return `Task: ${task.label}`;
}

export function useTaskActions(workspaceId: string) {
  const t = useTranslation();
  const dispatch = useAtomValue(dispatchCommandAtom);
  const wsClient = useAtomValue(wsClientAtom);
  const pushToast = useSetAtom(pushToastAtom);
  const store = useStore();
  const themeBackground = useTerminalThemeBackground();
  const [state, setState] = useAtom(taskStateAtomFamily(workspaceId));

  const load = useCallback(async () => {
    setState((previous) => ({ ...previous, loading: true, error: undefined }));
    const [tasksResult, historyResult] = await Promise.all([
      dispatch<TaskDefinition[]>("task.list", { workspaceId }),
      dispatch<TaskRun[]>("task.history", { workspaceId }),
    ]);

    if (!tasksResult.ok || !tasksResult.data) {
      const message = tasksResult.error?.message ?? t("tasks.load_failed_body");
      setState((previous) => ({ ...previous, loading: false, error: message }));
      pushToast({ kind: "error", title: t("tasks.load_failed_title"), body: message });
      return;
    }

    setState({
      tasks: tasksResult.data,
      runs: historyResult.ok && historyResult.data ? historyResult.data : [],
      loading: false,
    });
  }, [dispatch, pushToast, setState, t, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!wsClient) {
      return;
    }
    return wsClient.subscribe([Topics.workspaceTasksAll(workspaceId)], (_topic, payload) => {
      const data = payload as { tasks?: TaskDefinition[]; run?: TaskRun };
      if (data.tasks) {
        setState((previous) => ({ ...previous, tasks: data.tasks }));
      }
      if (data.run) {
        setState((previous) => ({
          ...previous,
          runs: [data.run!, ...previous.runs.filter((run) => run.id !== data.run!.id)],
        }));
      }
    });
  }, [setState, workspaceId, wsClient]);

  const activateRunTerminal = useCallback(
    (task: TaskDefinition, run: TaskRun) => {
      store.set(terminalMetaAtomFamily(run.terminalId), {
        id: run.terminalId,
        workspaceId,
        kind: "task",
        alive: run.status === "running" || run.status === "queued",
        exitCode: run.exitCode,
        title: taskTerminalTitle(task),
      });
      store.set(terminalIdsAtomFamily(workspaceId), (current) =>
        current.includes(run.terminalId) ? current : [...current, run.terminalId]
      );
      store.set(terminalActiveIdAtomFamily(workspaceId), run.terminalId);
      store.set(bottomPanelActiveTabAtomFamily(workspaceId), "terminal");
    },
    [store, workspaceId]
  );

  const runTask = useCallback(
    async (task: TaskDefinition) => {
      const result = await dispatch<TaskRun>("task.run", {
        workspaceId,
        taskId: task.id,
        themeBackground,
      });
      if (!result.ok || !result.data) {
        pushToast({
          kind: "error",
          title: t("tasks.run_failed_title"),
          body: result.error?.message ?? t("tasks.run_failed_body"),
        });
        return null;
      }
      activateRunTerminal(task, result.data);
      setState((previous) => ({
        ...previous,
        runs: [result.data!, ...previous.runs.filter((run) => run.taskId !== task.id)],
      }));
      return result.data;
    },
    [activateRunTerminal, dispatch, pushToast, setState, t, themeBackground, workspaceId]
  );

  const rerunTask = useCallback(
    async (task: TaskDefinition) => {
      const result = await dispatch<TaskRun>("task.rerun", {
        workspaceId,
        taskId: task.id,
        themeBackground,
      });
      if (!result.ok || !result.data) {
        pushToast({
          kind: "error",
          title: t("tasks.run_failed_title"),
          body: result.error?.message ?? t("tasks.run_failed_body"),
        });
        return null;
      }
      activateRunTerminal(task, result.data);
      return result.data;
    },
    [activateRunTerminal, dispatch, pushToast, t, themeBackground, workspaceId]
  );

  const stopTask = useCallback(
    async (run: TaskRun) => {
      const result = await dispatch<TaskRun>("task.stop", { workspaceId, runId: run.id });
      if (!result.ok || !result.data) {
        pushToast({
          kind: "error",
          title: t("tasks.stop_failed_title"),
          body: result.error?.message ?? t("tasks.stop_failed_body"),
        });
        return null;
      }
      setState((previous) => ({
        ...previous,
        runs: [result.data!, ...previous.runs.filter((candidate) => candidate.id !== run.id)],
      }));
      return result.data;
    },
    [dispatch, pushToast, setState, t, workspaceId]
  );

  return {
    ...state,
    commandPreview,
    load,
    runTask,
    rerunTask,
    stopTask,
  };
}
```

- [ ] **Step 5: Add TasksPanel UI**

Create `packages/web/src/features/tasks/views/shared/tasks-panel.tsx`:

```tsx
import type { TaskDefinition, TaskRun } from "@coder-studio/core";
import { Button, EmptyState, ThemedIcon } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { useTaskActions } from "../../actions/use-task-actions";

interface TasksPanelProps {
  workspaceId: string;
}

function formatDuration(run: TaskRun | undefined): string {
  if (!run?.finishedAt) {
    return "";
  }
  const seconds = Math.max(1, Math.round((run.finishedAt - run.startedAt) / 1000));
  return `${seconds}s`;
}

function statusLabel(t: ReturnType<typeof useTranslation>, run: TaskRun | undefined): string {
  if (!run) return t("tasks.status_not_run");
  if (run.status === "running") return t("tasks.status_running");
  if (run.status === "queued") return t("tasks.status_queued");
  if (run.status === "passed") return t("tasks.status_passed");
  if (run.status === "failed") return t("tasks.status_failed");
  return t("tasks.status_stopped");
}

function latestRunFor(task: TaskDefinition, runs: TaskRun[]): TaskRun | undefined {
  return runs.find((run) => run.taskId === task.id);
}

export function TasksPanel({ workspaceId }: TasksPanelProps) {
  const t = useTranslation();
  const { tasks, runs, loading, error, commandPreview, runTask, rerunTask, stopTask } =
    useTaskActions(workspaceId);

  return (
    <div className="tasks-panel">
      <div className="tasks-panel-header">
        <div>
          <span className="terminal-kicker">{t("tasks.kicker")}</span>
          <h2 className="tasks-panel-title">{t("tasks.title")}</h2>
        </div>
        <div className="tasks-panel-quick-actions">
          {tasks
            .filter((task) => task.kind === "verify" || task.kind === "test" || task.kind === "lint")
            .slice(0, 3)
            .map((task) => (
              <Button key={task.id} size="sm" onClick={() => void runTask(task)}>
                {t("tasks.run_label", { label: task.label })}
              </Button>
            ))}
        </div>
      </div>

      {error ? <div className="tasks-panel-error">{error}</div> : null}

      {tasks.length === 0 && !loading ? (
        <EmptyState
          className="tasks-empty"
          icon={<ThemedIcon semantic="terminal.action.new" size={28} />}
          title={<p>{t("tasks.empty_title")}</p>}
          description={<p>{t("tasks.empty_body")}</p>}
        />
      ) : (
        <div className="tasks-list">
          {tasks.map((task) => {
            const run = latestRunFor(task, runs);
            const running = run?.status === "running" || run?.status === "queued";
            return (
              <div key={task.id} className={`tasks-row tasks-row--${run?.status ?? "not-run"}`}>
                <div className="tasks-row-main">
                  <span className="tasks-row-label">{task.label}</span>
                  <span className="tasks-row-command">{commandPreview(task)}</span>
                </div>
                <span className="tasks-row-status">{statusLabel(t, run)}</span>
                <span className="tasks-row-duration">{formatDuration(run)}</span>
                <div className="tasks-row-actions">
                  {running && run ? (
                    <Button size="sm" variant="secondary" onClick={() => void stopTask(run)}>
                      {t("tasks.stop_label", { label: task.label })}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant={run ? "secondary" : "primary"}
                      onClick={() => void (run ? rerunTask(task) : runTask(task))}
                    >
                      {run
                        ? t("tasks.rerun_label", { label: task.label })
                        : t("tasks.run_label", { label: task.label })}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Add translations**

Add these keys under the root object in `packages/web/src/locales/en.json`:

```json
"tasks": {
  "kicker": "Managed commands",
  "title": "Tasks",
  "empty_title": "No tasks found",
  "empty_body": "Add .coder-studio/tasks.json or package scripts to run verification here.",
  "load_failed_title": "Failed to load tasks",
  "load_failed_body": "Task discovery failed.",
  "run_failed_title": "Failed to run task",
  "run_failed_body": "The task could not be started.",
  "stop_failed_title": "Failed to stop task",
  "stop_failed_body": "The task could not be stopped.",
  "run_label": "Run {label}",
  "rerun_label": "Rerun {label}",
  "stop_label": "Stop {label}",
  "status_not_run": "Not run",
  "status_queued": "Queued",
  "status_running": "Running",
  "status_passed": "Passed",
  "status_failed": "Failed",
  "status_stopped": "Stopped"
}
```

Add these keys under the root object in `packages/web/src/locales/zh.json`:

```json
"tasks": {
  "kicker": "托管命令",
  "title": "任务",
  "empty_title": "未发现任务",
  "empty_body": "添加 .coder-studio/tasks.json 或 package scripts 后可在这里运行验证。",
  "load_failed_title": "任务加载失败",
  "load_failed_body": "任务发现失败。",
  "run_failed_title": "任务运行失败",
  "run_failed_body": "无法启动该任务。",
  "stop_failed_title": "任务停止失败",
  "stop_failed_body": "无法停止该任务。",
  "run_label": "运行 {label}",
  "rerun_label": "重新运行 {label}",
  "stop_label": "停止 {label}",
  "status_not_run": "未运行",
  "status_queued": "排队中",
  "status_running": "运行中",
  "status_passed": "通过",
  "status_failed": "失败",
  "status_stopped": "已停止"
}
```

- [ ] **Step 7: Run TasksPanel tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/tasks/__tests__/tasks-panel.test.tsx
pnpm --filter @coder-studio/web exec tsc -p tsconfig.json --noEmit
```

Expected: PASS for tests and no TypeScript errors.

- [ ] **Step 8: Commit TasksPanel**

Run:

```bash
git add packages/web/src/features/tasks packages/web/src/locales/en.json packages/web/src/locales/zh.json
git commit -m "feat: add managed tasks panel"
```

### Task 8: Surface Latest Verification in Agent and Git Contexts

**Files:**
- Modify: `packages/web/src/features/agent-panes/views/shared/session-card.tsx`
- Modify: `packages/web/src/features/agent-panes/components/session-card.test.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/git-panel.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/git-panel.test.tsx`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`

- [ ] **Step 1: Write failing context tests**

In `packages/web/src/features/agent-panes/components/session-card.test.tsx`, seed `taskStateAtomFamily("ws-test")` with a failed verify run and assert:

```ts
expect(screen.getByText("Last verify: Failed")).toBeInTheDocument();
expect(screen.getByRole("button", { name: "View output" })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "Rerun Verify" })).toBeInTheDocument();
```

In `packages/web/src/features/workspace/views/shared/git-panel.test.tsx`, seed the same task state and assert:

```ts
expect(screen.getByText("Verification: Failed")).toBeInTheDocument();
expect(screen.getByRole("button", { name: "View Tasks" })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "Rerun Verify" })).toBeInTheDocument();
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/agent-panes/components/session-card.test.tsx src/features/workspace/views/shared/git-panel.test.tsx
```

Expected: FAIL because no verification context UI exists.

- [ ] **Step 3: Add compact agent verify status**

In `session-card.tsx`, read:

```ts
const latestVerifyRun = useAtomValue(latestVerifyRunAtomFamily(session.workspaceId));
const setBottomPanelTab = useSetAtom(bottomPanelActiveTabAtomFamily(session.workspaceId));
const setActiveTerminalId = useSetAtom(terminalActiveIdAtomFamily(session.workspaceId));
```

Render a compact block near the session status area:

```tsx
{latestVerifyRun ? (
  <div className={`session-card-verify session-card-verify--${latestVerifyRun.status}`}>
    <span>
      {t("tasks.last_verify", {
        status: t(`tasks.status_${latestVerifyRun.status}`),
      })}
    </span>
    <span className="session-card-verify-command">
      {[latestVerifyRun.command, ...latestVerifyRun.args].join(" ")}
      {latestVerifyRun.exitCode !== undefined ? ` · exit ${latestVerifyRun.exitCode}` : ""}
    </span>
    <button
      type="button"
      onClick={() => {
        setActiveTerminalId(latestVerifyRun.terminalId);
        setBottomPanelTab("terminal");
      }}
    >
      {t("tasks.view_output")}
    </button>
    <button type="button" onClick={() => void rerunVerify()}>
      {t("tasks.rerun_verify")}
    </button>
  </div>
) : null}
```

Use the existing button component if `session-card.tsx` already uses shared UI buttons.

- [ ] **Step 4: Add compact Git verify banner**

In `git-panel.tsx`, read `latestVerifyRunAtomFamily(workspaceId)` and `bottomPanelActiveTabAtomFamily(workspaceId)`.

Render near the top of the Git panel body:

```tsx
{latestVerifyRun ? (
  <div className={`git-verification-banner git-verification-banner--${latestVerifyRun.status}`}>
    <span>
      {t("tasks.verification_status", {
        status: t(`tasks.status_${latestVerifyRun.status}`),
      })}
    </span>
    <button type="button" onClick={() => setBottomPanelTab("tasks")}>
      {t("tasks.view_tasks")}
    </button>
    <button type="button" onClick={() => void rerunVerify()}>
      {t("tasks.rerun_verify")}
    </button>
  </div>
) : null}
```

The `rerunVerify` helper must find the discovered task with `kind === "verify"` from `taskStateAtomFamily(workspaceId)` and call `task.rerun` with that task id. If no verify task exists, show an info toast using `tasks.no_verify_task`.

- [ ] **Step 5: Add translations**

Add these keys to the existing `tasks` object in `en.json`:

```json
"last_verify": "Last verify: {status}",
"verification_status": "Verification: {status}",
"view_output": "View output",
"view_tasks": "View Tasks",
"rerun_verify": "Rerun Verify",
"no_verify_task": "No Verify task is available for this workspace."
```

Add these keys to the existing `tasks` object in `zh.json`:

```json
"last_verify": "最近验证：{status}",
"verification_status": "验证：{status}",
"view_output": "查看输出",
"view_tasks": "查看任务",
"rerun_verify": "重新验证",
"no_verify_task": "当前工作区没有可用的 Verify 任务。"
```

- [ ] **Step 6: Run focused context tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/agent-panes/components/session-card.test.tsx src/features/workspace/views/shared/git-panel.test.tsx
pnpm --filter @coder-studio/web exec tsc -p tsconfig.json --noEmit
```

Expected: PASS for tests and no TypeScript errors.

- [ ] **Step 7: Commit context integration**

Run:

```bash
git add packages/web/src/features/agent-panes packages/web/src/features/workspace/views/shared/git-panel.tsx packages/web/src/features/workspace/views/shared/git-panel.test.tsx packages/web/src/locales/en.json packages/web/src/locales/zh.json
git commit -m "feat: show latest verification context"
```

### Task 9: Verify Milestone A End-to-End

**Files:**
- No new files.

- [ ] **Step 1: Run focused Milestone A validation**

Run:

```bash
pnpm --filter @coder-studio/core exec tsc -p tsconfig.json --noEmit
pnpm --filter @coder-studio/server exec vitest run src/tasks/discovery.test.ts src/tasks/manager.test.ts src/__tests__/task-commands.test.ts src/__tests__/terminal-commands.test.ts
pnpm --filter @coder-studio/web exec vitest run src/features/tasks/__tests__/tasks-panel.test.tsx src/features/terminal-panel/__tests__/terminal-panel.test.tsx src/features/workspace/views/desktop/workspace-desktop-view.test.tsx src/features/agent-panes/components/session-card.test.tsx src/features/workspace/views/shared/git-panel.test.tsx
pnpm --filter @coder-studio/web exec tsc -p tsconfig.json --noEmit
pnpm --filter @coder-studio/server exec tsc -p tsconfig.json --noEmit
```

Expected: all commands complete successfully.

- [ ] **Step 2: Manual smoke test**

Run:

```bash
pnpm dev
```

Expected manual checks:

- Desktop bottom panel shows `Terminal` and `Tasks`.
- `Tasks` lists `Verify` as `pnpm ci:verify` in this repository.
- Clicking `Run Verify` switches to `Terminal` and selects `Task: Verify`.
- Stopping a running task marks it `Stopped`.
- A non-zero exit marks it `Failed` and shows a short tail summary in task state.
- Git panel shows latest verification status after a verify run.

- [ ] **Step 3: Commit any smoke-test fixes**

If the smoke test required fixes, run:

```bash
git add packages/core packages/server packages/web
git commit -m "fix: stabilize tasks verification flow"
```

If no fixes were needed, do not create an empty commit.

## Milestone B: Git Hunk Review

### Task 10: Parse Git Diff Hunks Server-Side

**Files:**
- Create: `packages/server/src/git/hunks.ts`
- Create: `packages/server/src/git/hunks.test.ts`
- Modify: `packages/server/src/git/diff.ts`

- [ ] **Step 1: Write failing hunk parser tests**

Create `packages/server/src/git/hunks.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { buildSingleHunkPatch, parseDiffHunks } from "./hunks.js";

const SAMPLE_DIFF = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,5 +1,6 @@
 import { boot } from "./boot";

-boot("old");
+boot("new");
+console.log("ready");
 export {};
@@ -20,3 +21,4 @@ export function label() {
   return "label";
 }
+export const ready = true;
`;

describe("parseDiffHunks", () => {
  it("returns stable hunk descriptors with patch text", () => {
    const hunks = parseDiffHunks({
      diff: SAMPLE_DIFF,
      path: "src/app.ts",
      staged: false,
    });

    expect(hunks).toHaveLength(2);
    expect(hunks[0]).toMatchObject({
      header: "@@ -1,5 +1,6 @@",
      oldStart: 1,
      oldLines: 5,
      newStart: 1,
      newLines: 6,
      lines: [
        " import { boot } from \"./boot\";",
        " ",
        "-boot(\"old\");",
        "+boot(\"new\");",
        "+console.log(\"ready\");",
        " export {};",
      ],
    });
    expect(hunks[0]!.id).toMatch(/^hunk_/);
    expect(hunks[0]!.patch).toContain("@@ -1,5 +1,6 @@");
  });

  it("builds a single-hunk patch with the file header", () => {
    const [hunk] = parseDiffHunks({ diff: SAMPLE_DIFF, path: "src/app.ts", staged: false });
    const patch = buildSingleHunkPatch(SAMPLE_DIFF, hunk!.id, {
      path: "src/app.ts",
      staged: false,
    });

    expect(patch).toContain("diff --git a/src/app.ts b/src/app.ts");
    expect(patch).toContain("--- a/src/app.ts");
    expect(patch).toContain("+++ b/src/app.ts");
    expect(patch).toContain("@@ -1,5 +1,6 @@");
    expect(patch).not.toContain("@@ -20,3 +21,4 @@");
  });

  it("returns null when the requested hunk is stale", () => {
    const patch = buildSingleHunkPatch(SAMPLE_DIFF, "hunk_missing", {
      path: "src/app.ts",
      staged: false,
    });

    expect(patch).toBeNull();
  });
});
```

- [ ] **Step 2: Run hunk parser tests and confirm failure**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/git/hunks.test.ts
```

Expected: FAIL because `packages/server/src/git/hunks.ts` does not exist.

- [ ] **Step 3: Implement hunk parsing**

Create `packages/server/src/git/hunks.ts` with:

```ts
import { createHash } from "node:crypto";
import type { GitDiffHunk } from "@coder-studio/core";

interface ParseDiffHunksInput {
  diff: string;
  path: string;
  staged: boolean;
}

const HUNK_HEADER_PATTERN = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function hunkId(input: ParseDiffHunksInput, header: string, lines: string[]): string {
  const hash = createHash("sha256")
    .update(input.path)
    .update(input.staged ? "staged" : "unstaged")
    .update(header)
    .update(lines.join("\n"))
    .digest("hex")
    .slice(0, 16);
  return `hunk_${hash}`;
}

function parseCount(value: string | undefined): number {
  return value ? Number.parseInt(value, 10) : 1;
}

function diffFileHeader(diffLines: string[]): string[] {
  const header: string[] = [];
  for (const line of diffLines) {
    if (line.startsWith("@@ ")) {
      break;
    }
    header.push(line);
  }
  return header;
}

export function parseDiffHunks(input: ParseDiffHunksInput): GitDiffHunk[] {
  const lines = input.diff.split("\n");
  const hunks: GitDiffHunk[] = [];
  let current:
    | {
        header: string;
        oldStart: number;
        oldLines: number;
        newStart: number;
        newLines: number;
        lines: string[];
      }
    | null = null;

  const flush = () => {
    if (!current) return;
    const id = hunkId(input, current.header, current.lines);
    hunks.push({
      id,
      header: current.header,
      oldStart: current.oldStart,
      oldLines: current.oldLines,
      newStart: current.newStart,
      newLines: current.newLines,
      patch: [current.header, ...current.lines].join("\n"),
      lines: current.lines,
    });
  };

  for (const line of lines) {
    const match = HUNK_HEADER_PATTERN.exec(line);
    if (match) {
      flush();
      current = {
        header: line,
        oldStart: Number.parseInt(match[1]!, 10),
        oldLines: parseCount(match[2]),
        newStart: Number.parseInt(match[3]!, 10),
        newLines: parseCount(match[4]),
        lines: [],
      };
      continue;
    }
    if (current) {
      current.lines.push(line);
    }
  }
  flush();

  return hunks;
}

export function buildSingleHunkPatch(
  diff: string,
  requestedHunkId: string,
  input: ParseDiffHunksInput
): string | null {
  const lines = diff.split("\n");
  const header = diffFileHeader(lines);
  const hunk = parseDiffHunks(input).find((candidate) => candidate.id === requestedHunkId);
  if (!hunk) {
    return null;
  }
  return [...header, hunk.patch, ""].join("\n");
}
```

- [ ] **Step 4: Include hunks in text diff payloads**

In `packages/server/src/git/diff.ts`, import:

```ts
import { parseDiffHunks } from "./hunks.js";
```

In `buildTextDiffResult`, add:

```ts
hunks: parseDiffHunks({ diff: payload.diff, path: filePath, staged }),
```

to the returned object.

- [ ] **Step 5: Run hunk parser tests**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/git/hunks.test.ts
pnpm --filter @coder-studio/server exec tsc -p tsconfig.json --noEmit
```

Expected: PASS for tests and no TypeScript errors.

- [ ] **Step 6: Commit hunk parser**

Run:

```bash
git add packages/server/src/git/hunks.ts packages/server/src/git/hunks.test.ts packages/server/src/git/diff.ts
git commit -m "feat: parse git diff hunks"
```

### Task 11: Apply Git Hunk Operations Server-Side

**Files:**
- Create: `packages/server/src/git/hunk-operations.ts`
- Create: `packages/server/src/git/hunk-operations.test.ts`
- Modify: `packages/server/src/commands/git.ts`
- Modify: `packages/server/src/__tests__/git-commands.test.ts`

- [ ] **Step 1: Write failing hunk operation tests**

Create `packages/server/src/git/hunk-operations.test.ts` with real temporary Git repositories:

```ts
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getFileDiff } from "./diff.js";
import { applyGitHunkOperation } from "./hunk-operations.js";
import { runGit } from "./cli.js";

describe("applyGitHunkOperation", () => {
  let root: string;

  beforeEach(async () => {
    root = join(tmpdir(), `coder-studio-hunk-op-${Date.now()}-${Math.random()}`);
    await mkdir(root, { recursive: true });
    await runGit(root, ["init"]);
    await runGit(root, ["config", "user.email", "test@example.com"]);
    await runGit(root, ["config", "user.name", "Test User"]);
    await writeFile(join(root, "file.txt"), "one\ntwo\nthree\nfour\nfive\n");
    await runGit(root, ["add", "file.txt"]);
    await runGit(root, ["commit", "-m", "initial"]);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("stages one unstaged hunk", async () => {
    await writeFile(join(root, "file.txt"), "ONE\ntwo\nthree\nfour\nFIVE\n");
    const diff = await getFileDiff(root, "file.txt", false);
    const hunkId = diff.hunks![0]!.id;

    await applyGitHunkOperation(root, {
      workspaceId: "ws-1",
      path: "file.txt",
      staged: false,
      hunkId,
      operation: "stage",
    });

    const staged = await runGit(root, ["diff", "--staged", "--", "file.txt"]);
    const unstaged = await runGit(root, ["diff", "--", "file.txt"]);
    expect(staged.stdout).toContain("ONE");
    expect(unstaged.stdout).toContain("FIVE");
  });

  it("unstages one staged hunk", async () => {
    await writeFile(join(root, "file.txt"), "ONE\ntwo\nthree\nfour\nFIVE\n");
    await runGit(root, ["add", "file.txt"]);
    const diff = await getFileDiff(root, "file.txt", true);
    const hunkId = diff.hunks![0]!.id;

    await applyGitHunkOperation(root, {
      workspaceId: "ws-1",
      path: "file.txt",
      staged: true,
      hunkId,
      operation: "unstage",
    });

    const staged = await runGit(root, ["diff", "--staged", "--", "file.txt"]);
    const unstaged = await runGit(root, ["diff", "--", "file.txt"]);
    expect(staged.stdout).not.toContain("ONE");
    expect(unstaged.stdout).toContain("ONE");
  });

  it("discards one unstaged hunk", async () => {
    await writeFile(join(root, "file.txt"), "ONE\ntwo\nthree\nfour\nFIVE\n");
    const diff = await getFileDiff(root, "file.txt", false);
    const hunkId = diff.hunks![0]!.id;

    await applyGitHunkOperation(root, {
      workspaceId: "ws-1",
      path: "file.txt",
      staged: false,
      hunkId,
      operation: "discard",
    });

    const unstaged = await runGit(root, ["diff", "--", "file.txt"]);
    expect(unstaged.stdout).not.toContain("ONE");
    expect(unstaged.stdout).toContain("FIVE");
  });

  it("rejects stale hunk ids", async () => {
    await writeFile(join(root, "file.txt"), "ONE\ntwo\nthree\nfour\nfive\n");

    await expect(
      applyGitHunkOperation(root, {
        workspaceId: "ws-1",
        path: "file.txt",
        staged: false,
        hunkId: "hunk_stale",
        operation: "stage",
      })
    ).rejects.toMatchObject({
      code: "git_hunk_stale",
    });
  });
});
```

- [ ] **Step 2: Run hunk operation tests and confirm failure**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/git/hunk-operations.test.ts
```

Expected: FAIL because `packages/server/src/git/hunk-operations.ts` does not exist.

- [ ] **Step 3: Implement hunk operations**

Create `packages/server/src/git/hunk-operations.ts`:

```ts
import type { GitHunkOperation } from "@coder-studio/core";
import { getFileDiff } from "./diff.js";
import { buildSingleHunkPatch } from "./hunks.js";
import { runGit } from "./cli.js";

function gitApplyArgs(operation: GitHunkOperation["operation"], staged: boolean): string[] {
  if (operation === "stage" && !staged) {
    return ["apply", "--cached", "--unidiff-zero"];
  }
  if (operation === "unstage" && staged) {
    return ["apply", "--cached", "--reverse", "--unidiff-zero"];
  }
  if (operation === "discard" && !staged) {
    return ["apply", "--reverse", "--unidiff-zero"];
  }
  throw {
    code: "git_hunk_operation_invalid",
    message: `Invalid hunk operation ${operation} for ${staged ? "staged" : "unstaged"} diff`,
  };
}

export async function applyGitHunkOperation(
  cwd: string,
  operation: GitHunkOperation
): Promise<void> {
  const diff = await getFileDiff(cwd, operation.path, operation.staged);
  if (diff.renderAs !== "text") {
    throw { code: "git_hunk_not_text", message: "Hunk operations are only available for text diffs" };
  }

  const patch = buildSingleHunkPatch(diff.diff, operation.hunkId, {
    path: operation.path,
    staged: operation.staged,
  });
  if (!patch) {
    throw {
      code: "git_hunk_stale",
      message: "Diff changed. Refresh and try again.",
    };
  }

  const args = gitApplyArgs(operation.operation, operation.staged);
  await runGit(cwd, [...args, "--check"], { stdin: patch });
  await runGit(cwd, args, { stdin: patch });
}
```

`runGit` already accepts `stdin` in `packages/server/src/git/cli.ts`, so do not add a second option name for patch input.

- [ ] **Step 4: Register `git.hunk` command**

In `packages/server/src/commands/git.ts`, import:

```ts
import { applyGitHunkOperation } from "../git/hunk-operations.js";
```

Add this command:

```ts
registerCommand(
  "git.hunk",
  z.object({
    workspaceId: z.string(),
    path: z.string(),
    staged: z.boolean(),
    hunkId: z.string(),
    operation: z.enum(["stage", "unstage", "discard"]),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
    }

    await applyGitHunkOperation(workspace.path, args);
    emitGitStateChanged(ctx, args.workspaceId, {
      worktreeChanged: true,
    });
    return {};
  }
);
```

- [ ] **Step 5: Add command test**

In `packages/server/src/__tests__/git-commands.test.ts`, add a mocked command test that dispatches `git.hunk` and asserts `workspaceMgr.get` and event emission behavior. The expected dispatch args are:

```ts
{
  workspaceId: "ws-1",
  path: "src/app.ts",
  staged: false,
  hunkId: "hunk_abc",
  operation: "stage"
}
```

The expected successful result is `{ ok: true, data: {} }`.

- [ ] **Step 6: Run hunk operation tests**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/git/hunks.test.ts src/git/hunk-operations.test.ts src/__tests__/git-commands.test.ts
pnpm --filter @coder-studio/server exec tsc -p tsconfig.json --noEmit
```

Expected: PASS for tests and no TypeScript errors.

- [ ] **Step 7: Commit hunk operations**

Run:

```bash
git add packages/server/src/git/hunk-operations.ts packages/server/src/git/hunk-operations.test.ts packages/server/src/commands/git.ts packages/server/src/__tests__/git-commands.test.ts packages/server/src/git/cli.ts
git commit -m "feat: apply git hunk operations"
```

### Task 12: Add Git Diff Review Actions in the Web UI

**Files:**
- Modify: `packages/web/src/features/workspace/actions/use-git-actions.ts`
- Modify: `packages/web/src/features/workspace/views/shared/git-diff-viewer.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/git-diff-viewer.test.tsx`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`

- [ ] **Step 1: Write failing diff viewer tests**

In `packages/web/src/features/workspace/views/shared/git-diff-viewer.test.tsx`, add a preview with `hunks`:

```ts
store.set(gitDiffPreviewAtomFamily("ws-test"), {
  kind: "worktree-file-diff",
  path: "src/app.ts",
  staged: false,
  diff: "diff --git a/src/app.ts b/src/app.ts\n@@ -1 +1 @@\n-old\n+new\n",
  renderAs: "text",
  status: "modified",
  hunks: [
    {
      id: "hunk_abc",
      header: "@@ -1 +1 @@",
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 1,
      patch: "@@ -1 +1 @@\n-old\n+new",
      lines: ["-old", "+new"],
    },
  ],
});
```

Add assertions:

```ts
expect(screen.getByRole("button", { name: "Stage hunk" })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "Stage file" })).toBeInTheDocument();
```

Click `Stage hunk` and expect dispatch:

```ts
expect(sendCommand).toHaveBeenCalledWith("git.hunk", {
  workspaceId: "ws-test",
  path: "src/app.ts",
  staged: false,
  hunkId: "hunk_abc",
  operation: "stage",
});
```

Add a stale error test where `git.hunk` returns:

```ts
{
  ok: false,
  error: {
    code: "git_hunk_stale",
    message: "Diff changed. Refresh and try again."
  }
}
```

Expected UI: an error toast or inline alert with `Diff changed. Refresh and try again.` and the preview remains selected.

- [ ] **Step 2: Run diff viewer tests and confirm failure**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/workspace/views/shared/git-diff-viewer.test.tsx
```

Expected: FAIL because hunk action UI does not exist.

- [ ] **Step 3: Add Git hunk actions**

In `packages/web/src/features/workspace/actions/use-git-actions.ts`, add a hunk operation helper in `useGitDiffViewerActions`:

```ts
const runHunkOperation = useCallback(
  async (input: {
    path: string;
    staged: boolean;
    hunkId: string;
    operation: "stage" | "unstage" | "discard";
  }) => {
    const result = await dispatch("git.hunk", {
      workspaceId,
      path: input.path,
      staged: input.staged,
      hunkId: input.hunkId,
      operation: input.operation,
    });

    if (!result.ok) {
      pushToast({
        kind: "error",
        title: t("git.hunk_failed_title"),
        body: result.error?.message ?? t("git.hunk_failed_body"),
      });
      return false;
    }

    const refreshed = await dispatch<GitFileDiffPayload>("git.diff", {
      workspaceId,
      path: input.path,
      staged: input.staged,
    });
    if (refreshed.ok && refreshed.data) {
      setPreview((current) =>
        current?.kind === "worktree-file-diff" && current.path === input.path
          ? { ...current, ...refreshed.data }
          : current
      );
    }
    await refreshGitState();
    return true;
  },
  [dispatch, pushToast, refreshGitState, setPreview, t, workspaceId]
);
```

Return `runHunkOperation` from `useGitDiffViewerActions`.

If `refreshGitState` is scoped inside another hook, extract a small shared helper in the same file that dispatches `git.status` and writes `gitStateAtomFamily(workspaceId)`.

- [ ] **Step 4: Add diff viewer hunk and file actions**

In `git-diff-viewer.tsx`, use `preview.kind === "worktree-file-diff"` to render file actions:

```tsx
{preview?.kind === "worktree-file-diff" ? (
  <div className="git-diff-actions">
    <IconButton aria-label={preview.staged ? t("git.unstage_file") : t("git.stage_file")} ... />
    {!preview.staged ? <IconButton aria-label={t("git.discard_file")} ... /> : null}
    <IconButton aria-label={t("git.refresh_diff")} ... />
  </div>
) : null}
```

Render hunk action rows before each hunk header:

```tsx
{preview?.kind === "worktree-file-diff" && preview.hunks?.map((hunk) => (
  <div key={hunk.id} className="git-diff-hunk">
    <div className="git-diff-hunk-toolbar">
      <span>{hunk.header}</span>
      {preview.staged ? (
        <Button size="sm" onClick={() => void runHunkOperation({
          path: preview.path,
          staged: true,
          hunkId: hunk.id,
          operation: "unstage",
        })}>
          {t("git.unstage_hunk")}
        </Button>
      ) : (
        <>
          <Button size="sm" onClick={() => void runHunkOperation({
            path: preview.path,
            staged: false,
            hunkId: hunk.id,
            operation: "stage",
          })}>
            {t("git.stage_hunk")}
          </Button>
          <Button size="sm" variant="danger" onClick={() => void runHunkOperation({
            path: preview.path,
            staged: false,
            hunkId: hunk.id,
            operation: "discard",
          })}>
            {t("git.discard_hunk")}
          </Button>
        </>
      )}
    </div>
    {hunk.lines.map((line, index) => (
      <div key={`${hunk.id}:${index}:${line}`} className={`code-line git-diff-line git-diff-line-${getDiffLineTone(line)}`}>
        <span className="code-line-num">{index + 1}</span>
        <span className="git-diff-line-text">{line || " "}</span>
      </div>
    ))}
  </div>
))}
```

For previews without `hunks`, keep the existing flat diff line rendering as a fallback.

- [ ] **Step 5: Add translations**

Add to `packages/web/src/locales/en.json` under `git`:

```json
"stage_file": "Stage file",
"unstage_file": "Unstage file",
"discard_file": "Discard file",
"refresh_diff": "Refresh diff",
"stage_hunk": "Stage hunk",
"unstage_hunk": "Unstage hunk",
"discard_hunk": "Discard hunk",
"hunk_failed_title": "Hunk operation failed",
"hunk_failed_body": "The selected hunk could not be applied."
```

Add to `packages/web/src/locales/zh.json` under `git`:

```json
"stage_file": "暂存文件",
"unstage_file": "取消暂存文件",
"discard_file": "放弃文件改动",
"refresh_diff": "刷新差异",
"stage_hunk": "暂存此段",
"unstage_hunk": "取消暂存此段",
"discard_hunk": "放弃此段",
"hunk_failed_title": "Hunk 操作失败",
"hunk_failed_body": "无法应用选中的改动段。"
```

- [ ] **Step 6: Run diff viewer tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/workspace/views/shared/git-diff-viewer.test.tsx src/features/workspace/views/shared/git-panel.test.tsx
pnpm --filter @coder-studio/web exec tsc -p tsconfig.json --noEmit
```

Expected: PASS for tests and no TypeScript errors.

- [ ] **Step 7: Commit Git diff actions**

Run:

```bash
git add packages/web/src/features/workspace/actions/use-git-actions.ts packages/web/src/features/workspace/views/shared/git-diff-viewer.tsx packages/web/src/features/workspace/views/shared/git-diff-viewer.test.tsx packages/web/src/locales/en.json packages/web/src/locales/zh.json
git commit -m "feat: add git hunk review actions"
```

### Task 13: Verify Milestone B and Full Plan

**Files:**
- No new files.

- [ ] **Step 1: Run focused Git validation**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/git/hunks.test.ts src/git/hunk-operations.test.ts src/__tests__/git-commands.test.ts
pnpm --filter @coder-studio/web exec vitest run src/features/workspace/views/shared/git-diff-viewer.test.tsx src/features/workspace/views/shared/git-panel.test.tsx
pnpm --filter @coder-studio/server exec tsc -p tsconfig.json --noEmit
pnpm --filter @coder-studio/web exec tsc -p tsconfig.json --noEmit
```

Expected: all commands complete successfully.

- [ ] **Step 2: Run repository verification**

Run:

```bash
pnpm ci:verify
```

Expected: command completes successfully.

- [ ] **Step 3: Manual smoke test**

Run:

```bash
pnpm dev
```

Expected manual checks:

- Modify a file in two separate hunks.
- Open Git panel and select the unstaged diff.
- `Stage hunk` stages only the selected hunk.
- `Discard hunk` discards only the selected unstaged hunk.
- Stage the file, open staged diff, and `Unstage hunk` unstages only the selected hunk.
- If the file changes between opening a diff and clicking a hunk action, the UI shows `Diff changed. Refresh and try again.` and keeps the file selected.

- [ ] **Step 4: Commit smoke-test fixes**

If fixes were required, run:

```bash
git add packages/core packages/server packages/web
git commit -m "fix: stabilize git hunk review"
```

If no fixes were needed, do not create an empty commit.

## Final Acceptance Criteria

- `Tasks` appears beside `Terminal` in the desktop bottom panel.
- `Verify` is discovered as `pnpm ci:verify` for this repository.
- Running a task creates a `task` terminal, switches to the Terminal tab, and selects that terminal.
- Task rows show `Not run`, `Running`, `Passed`, `Failed`, and `Stopped` states.
- Task runs track duration, exit code, and capped tail output summary.
- Agent and Git contexts show latest verification state without becoming secondary task managers.
- Git text diffs include server-generated hunk IDs.
- Hunk stage, unstage, and discard actions validate against current diff state server-side.
- Stale hunk operations show a clear refresh error and do not apply arbitrary client patch text.

## Self-Review Checklist

- Spec coverage:
  - Managed Tasks MVP is covered by Tasks 1 through 7.
  - Agent and Git latest verification context is covered by Task 8.
  - Hunk-level Git staging, unstaging, discard, and diff-local actions are covered by Tasks 10 through 12.
  - Non-goals are explicitly excluded in Execution Rules.
- Placeholder scan:
  - This plan contains no deferred placeholder markers.
  - Each code-changing task includes concrete file paths, public contracts, test commands, and expected outcomes.
- Type consistency:
  - `TerminalKind` is the single shared terminal-kind source.
  - `TaskDefinition`, `TaskRun`, `GitDiffHunk`, and `GitHunkOperation` names are consistent across core, server, and web.
  - Task event names match `DomainEvent`, `WsHub`, and topic usage.
