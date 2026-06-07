# Tasks Verification And Git Review Design

## Summary

This design defines a staged upgrade for Coder Studio's post-agent development workflow.

The first track adds a `Tasks` surface beside the existing terminal panel. It provides managed project commands such as `Verify`, `Test`, `Lint`, and `Build`, while still using terminal output as the source of truth.

The second track upgrades Git review with hunk-level staging and stronger diff actions. Together, these features create a tighter loop:

1. an agent changes code
2. the user runs a managed verification task
3. the result is visible next to terminal output
4. the user reviews and stages only the intended Git changes

This design intentionally does not pursue VS Code extension compatibility, Debug Adapter Protocol support, or a full Problems panel in this phase.

## Problem

Coder Studio already combines agent sessions, terminals, files, and Git review in one browser workspace. The remaining workflow gap is not "more IDE surface area" in general. The sharper gap is that users still have to manually coordinate verification and fine-grained Git cleanup after an agent finishes work.

Current friction points:

- verification commands are run manually in shell terminals
- the UI does not track whether the current workspace last verified successfully
- terminal output is available, but task intent, duration, exit code, and rerun state are not modeled
- Git review supports file-level staging and diff viewing, but not hunk-level staging
- users must switch context to decide what should be staged, discarded, or kept for follow-up

The product should optimize for the agent workflow before adding broader IDE features such as debugger support or extension-host compatibility.

## Goals

- Add a bottom-panel `Tasks` tab beside `Terminal`.
- Automatically discover common project verification commands.
- Provide a default `Run Verify` action when a likely verification command exists.
- Run tasks through managed terminal sessions so output remains live and inspectable.
- Track task status, duration, exit code, and last run metadata.
- Support stop and rerun for managed task runs.
- Show the latest verification result in lightweight agent and Git review contexts.
- Add hunk-level Git staging and unstaging.
- Add common review actions directly inside the diff surface.

## Non-Goals

- Full VS Code Tasks compatibility.
- Debugging, breakpoints, variables, call stack, or `launch.json`.
- A complete Problems panel.
- VS Code extension host or Marketplace compatibility.
- CI service integration.
- Cross-machine task history sync.
- Full Git graph, pull request, or issue integration.
- Three-way merge conflict editor in the first Git review pass.

## Approaches Considered

### 1. Put verification actions in the workspace top bar

This gives high visibility, but it separates the command from its output. Users would still need to move to the terminal panel to understand what happened.

This approach is rejected as the primary surface. A compact top-level status can be added later, but not as the main interaction model.

### 2. Put verification in the Git panel

This aligns with pre-commit review, but verification is not only a Git action. Users often run tests while an agent is still working or before they inspect the diff.

This approach is useful as a secondary shortcut only.

### 3. Put `Tasks` beside `Terminal`

This keeps the feature close to its natural output surface. Tasks are managed commands, not debugger sessions. The existing terminal infrastructure can own process output, resizing, replay, snapshots, and mobile behavior.

This is the recommended approach.

## Recommended Scope

### Phase 1: Managed Tasks MVP

The first phase adds task discovery, task execution, status tracking, and the bottom-panel UI.

#### Task Surface

Add a new bottom-panel tab beside `Terminal`:

```text
Bottom Panel
[Terminal] [Tasks]                         [Run Verify] [Run Test] [Run Lint]
```

The `Tasks` tab lists discovered tasks for the active workspace:

```text
Tasks
  Verify    pnpm ci:verify    Failed   42s   [Rerun]
  Test      pnpm ci:test      Passed   18s   [Run]
  Lint      pnpm lint         Not run        [Run]
  Build     pnpm build        Not run        [Run]
```

Each row should show:

- task label
- command preview
- status: `not_run`, `queued`, `running`, `passed`, `failed`, `stopped`
- duration for completed runs
- active action: `Run`, `Stop`, or `Rerun`

#### Task Discovery

The server should discover tasks from workspace files in this order:

1. explicit Coder Studio task config
2. package scripts
3. repository conventions
4. language ecosystem files

Supported first-pass sources:

- `.coder-studio/tasks.json`
- `package.json`
- `pnpm-workspace.yaml`
- `Cargo.toml`
- `go.mod`
- `pyproject.toml`
- `Makefile`

Default inferred task kinds:

- `verify`
- `test`
- `lint`
- `build`
- `dev`
- `custom`

For this repository, discovery should prefer `pnpm ci:verify` as the default `Verify` task because it is the documented repository validation command.

#### Task Execution

Task runs should be managed server-side. A run creates or reuses a terminal with a task identity.

Task terminals should be distinct from shell terminals and agent terminals:

```ts
type TerminalKind = "shell" | "agent" | "task";
```

The terminal remains responsible for:

- live output
- replay
- snapshot hydration
- resize
- close behavior
- mobile terminal rendering

The task layer is responsible for:

- task definition
- run id
- status
- start and finish timestamps
- exit code
- command preview
- terminal id
- last output summary

#### Task Commands

Add command-level operations:

- `task.discover`
- `task.list`
- `task.run`
- `task.stop`
- `task.rerun`
- `task.history`

`task.run` should return a `TaskRun` immediately after the managed terminal has been created. The run then updates over workspace events.

#### Task Events

Add workspace-scoped task events:

- `task.discovered`
- `task.run.started`
- `task.run.updated`
- `task.run.finished`
- `task.run.stopped`

The web client should subscribe to active workspace task events in the same way it subscribes to terminal and Git events.

#### Failure Summary

The MVP should not parse every compiler and test output. It should still record enough failure context to be useful:

- command
- cwd
- exit code
- duration
- last non-empty output lines
- linked terminal id

The last output summary should be capped to avoid storing full logs in task state. The terminal replay remains the source for full output.

### Phase 2: Agent And Git Context Integration

Once task execution is reliable, surface the latest verification result in the workflows where it matters.

#### Agent Context

Agent panes should show a compact latest verification state for the workspace:

```text
Last verify: Failed
pnpm ci:verify · exit 1 · 42s
[View output] [Rerun]
```

This should be read-only context plus navigation. Agent panes should not become a second task manager.

#### Git Review Context

The Git panel or diff review header should show:

```text
Verification: Failed    [View Tasks] [Rerun Verify]
```

This helps users avoid committing unverified agent output.

#### Supervisor Context

Supervisor can consume task result metadata later, but automatic repair loops are not part of the MVP. The first integration should only expose enough state for a human to rerun and inspect verification.

### Phase 3: Git Review Upgrade

After managed tasks are usable, Git review should gain fine-grained staging.

#### Hunk-Level Staging

The diff viewer should allow:

- stage hunk
- unstage hunk
- discard hunk

For staged diffs:

- `unstage hunk` applies the reverse patch from index to working tree staging state

For unstaged diffs:

- `stage hunk` applies the selected patch to the index
- `discard hunk` applies the reverse patch to the working tree

The server should execute these operations with `git apply`-based patch application rather than ad hoc text editing. If patch application fails because the file changed, the UI should show a stale diff error and offer refresh.

#### Line-Level Staging

Line-level staging is valuable, but it is more complex than hunk staging because it requires constructing valid partial patches.

Recommended sequence:

1. implement hunk staging first
2. add selected-line staging once the diff model can generate stable patch slices

#### Diff Review Actions

Add direct actions to the diff surface:

- stage file
- unstage file
- discard file
- stage hunk
- unstage hunk
- discard hunk
- open file
- copy path
- refresh diff

This reduces movement between the Git tree and the central editor surface.

#### Commit Assistance

Add commit message assistance after hunk staging exists.

Recommended first version:

- generate a commit message from staged diff
- keep the result editable
- do not auto-commit
- do not require an AI provider if no provider is configured

If no provider is available, the action can be hidden or disabled with a clear message.

## Data Model

### TaskDefinition

```ts
interface TaskDefinition {
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
}
```

### TaskRun

```ts
interface TaskRun {
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
}
```

### Git Hunk Operation

```ts
interface GitHunkOperation {
  workspaceId: string;
  path: string;
  staged: boolean;
  hunkId: string;
  operation: "stage" | "unstage" | "discard";
}
```

The client should not send arbitrary patch text as the primary API contract. Prefer sending a stable hunk id derived from the current diff payload, then let the server validate it against a fresh or cached diff. This reduces the risk of applying stale or tampered patches.

## UI Placement

### Bottom Panel

The bottom panel becomes the primary home for command execution:

- `Terminal` remains manual shell terminal management
- `Tasks` manages discovered and recent task commands

The active task output should still open in an xterm surface. The `Tasks` tab can either show output below the task list or jump to the terminal tab with the task terminal selected. The MVP should prefer jumping to the terminal tab to avoid duplicating terminal rendering.

### Agent Pane

Agent panes get compact task status only:

- latest verify state
- view output
- rerun verify

### Git Panel And Diff Surface

Git panel gets verification status as a compact banner. The diff surface gets review actions local to the current file or hunk.

## Error Handling

### Task Discovery

If discovery fails for one source, it should not fail all discovery.

Example:

- invalid `package.json` should report a source warning
- valid `Makefile` and inferred commands should still appear

### Task Run

Task run errors should map to clear states:

- failed to create terminal: `failed`
- command exits non-zero: `failed`
- user stops run: `stopped`
- process exits zero: `passed`

### Stale Git Diff

If hunk staging fails because the diff changed:

- show `Diff changed. Refresh and try again.`
- keep the file selected
- refresh Git status after the user confirms or clicks refresh

## File Boundaries

Expected primary areas:

- `packages/core/src/domain/types.ts`
- `packages/server/src/commands/terminal.ts`
- `packages/server/src/commands/git.ts`
- `packages/server/src/git/diff.ts`
- `packages/server/src/terminal/manager.ts`
- `packages/web/src/features/terminal-panel/*`
- `packages/web/src/features/workspace/actions/use-git-actions.ts`
- `packages/web/src/features/workspace/views/shared/git-diff-viewer.tsx`
- `packages/web/src/features/workspace/views/shared/git-panel.tsx`

Likely new server files:

- `packages/server/src/tasks/discovery.ts`
- `packages/server/src/tasks/manager.ts`
- `packages/server/src/commands/task.ts`
- `packages/server/src/git/hunk-operations.ts`

Likely new web files:

- `packages/web/src/features/tasks/actions/use-task-actions.ts`
- `packages/web/src/features/tasks/atoms.ts`
- `packages/web/src/features/tasks/views/shared/tasks-panel.tsx`

## Testing Strategy

### Task Tests

Server tests:

- discovers `pnpm ci:verify` as the preferred verify task in this repository
- discovers `package.json` scripts
- handles invalid project files without failing all discovery
- creates a task terminal on `task.run`
- marks run passed on exit code `0`
- marks run failed on non-zero exit
- marks run stopped when stopped by user

Web tests:

- renders `Tasks` tab beside `Terminal`
- lists discovered tasks
- starts a task from the task row
- shows running and completed state
- exposes rerun after completion

### Git Tests

Server tests:

- stages one hunk from an unstaged text diff
- unstages one hunk from a staged text diff
- discards one hunk from an unstaged text diff
- rejects stale hunk operations
- refreshes Git state after successful hunk operation

Web tests:

- renders hunk actions in diff view
- calls the expected Git hunk operation
- shows stale diff error
- keeps file selection stable after refresh

## Rollout Plan

### Milestone 1

Deliver:

- task type definitions
- task discovery
- `Tasks` tab
- `task.run`
- task terminal output
- basic status tracking

Success criterion:

- a user can open the bottom `Tasks` tab and run `Verify` for the active workspace.

### Milestone 2

Deliver:

- stop and rerun
- run history for the latest run per task
- failure summary
- compact latest verify state in Agent and Git review contexts

Success criterion:

- a user can tell whether the latest verification passed without manually scanning terminal tabs.

### Milestone 3

Deliver:

- hunk-level stage, unstage, and discard
- diff-local review actions

Success criterion:

- a user can stage only part of an agent-generated file change from the diff surface.

### Milestone 4

Deliver:

- optional line-level staging
- commit message assistance from staged diff

Success criterion:

- a user can prepare a clean commit from partial agent output without leaving Code Studio.

## Implementation Defaults

The first implementation should use these defaults.

### Task Terminals

Task terminals are visible in the existing terminal selector and visually marked as managed.

The `Tasks` tab does not embed a second xterm instance. Selecting `View output` or starting a task switches to the existing terminal tab with the managed task terminal selected.

### Task Run Retention

Keep the latest run per task in memory for the MVP.

Do not persist task history to SQLite in the first pass. If users need longer history after the MVP, add persistence as a separate follow-up.

### Task Config Schema

The first `.coder-studio/tasks.json` schema is:

```json
{
  "version": 1,
  "tasks": [
    {
      "id": "verify",
      "label": "Verify",
      "kind": "verify",
      "command": "pnpm",
      "args": ["ci:verify"],
      "cwdPath": "."
    }
  ]
}
```

Schema rules:

- `version` must be `1`.
- `tasks` must be an array.
- `id`, `label`, `kind`, and `command` are required.
- `args` defaults to an empty array.
- `cwdPath` defaults to the workspace root.
- config-defined tasks override discovered tasks with the same `kind` and `id`.

### Hunk Identity

Hunk ids are generated server-side when building Git diff payloads.

The client sends only:

- workspace id
- file path
- staged flag
- hunk id
- operation

The server validates the hunk id against the current diff before applying any patch. If validation fails, the operation returns a stale-diff error.
