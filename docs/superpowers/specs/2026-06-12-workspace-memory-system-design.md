# Workspace Memory System Design

> Status: Draft for user review
> Date: 2026-06-12
> Scope: `packages/core`, `packages/server`, `packages/cli`, `packages/web`, built-in skills

## Goal

Add a project-scoped memory system for Coder Studio. Users, agents, and skills can
store structured project memory for a workspace; agents can read and write it on
demand through a built-in skill and CLI/API commands; users can inspect, edit, and
delete entries from the existing desktop side panel.

The memory content must not be injected into every agent session by default.
Instead, Coder Studio will provide a default built-in Memory Skill that tells the
agent when and how to read or write memory.

## Decisions

- Memory scope for v1 is one workspace. The schema may reserve future extension
  points, but v1 does not expose global or session-scoped memory.
- Memory entries are structured records, not a single Markdown document.
- Entries use a fixed `type` plus free-form `tags`.
- Agents and skills may write directly. User confirmation is not required before
  the entry is saved.
- Users can edit and delete entries in the UI after any user, agent, or skill
  write.
- Memory is stored in Coder Studio state, not in the workspace Git tree.
- Storage is one JSON file per workspace.
- Deletion is soft delete via `archivedAt`; default lists hide archived entries.
- No memory content is automatically inserted into agent startup context.
- A built-in Memory Skill is default-mounted for providers that support skills.
- The desktop side panel gets the first UI. Mobile integration is deferred.

## Non-Goals

- Do not build vector search, embedding storage, or semantic retrieval in v1.
- Do not sync memory to Git or cloud storage in v1.
- Do not add a review queue for agent-written memory in v1.
- Do not build global user preference memory in v1.
- Do not expose archived entry restore UI in v1, beyond keeping the data model
  ready for it.
- Do not replace `.coder-studio/agent.md` or provider-specific agent instruction
  files.
- Do not use memory as a hard instruction channel. Long-lived instructions remain
  in agent instructions; memory is project knowledge the agent may consult.

## Existing Context

Relevant existing project structure:

- `packages/web/src/features/workspace/views/shared/workspace-activity-bar.tsx`
  owns desktop side panel activity entries.
- `packages/web/src/features/workspace/atoms/layout.ts` defines
  `DesktopSidebarView` and validates persisted sidebar view state.
- `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx`
  renders the active sidebar panel.
- `packages/web/src/features/workspace/actions/use-agent-instructions-actions.ts`
  is the closest existing example of a workspace side panel calling server
  commands.
- `packages/server/src/ws/dispatch.ts` registers command handlers and injects
  repositories through `CommandContext`.
- `packages/server/src/storage/repositories/json-file-store.ts` provides atomic
  JSON writes.
- `packages/server/src/server.ts` wires state-root-backed repositories into the
  command context.
- `packages/cli/src/automation-command-client.ts` already calls server commands
  over WebSocket and uses `CODER_STUDIO_API_URL`.
- `packages/server/src/session/manager.ts` injects `CODER_STUDIO`,
  `CODER_STUDIO_WORKSPACE_ID`, `CODER_STUDIO_SESSION_ID`,
  `CODER_STUDIO_PROVIDER_ID`, and `CODER_STUDIO_API_URL` into agent sessions.
- `packages/server/src/skills/builtin/*` can materialize and mount built-in
  skills.

## Core Domain Model

Create `packages/core/src/domain/memory.ts` and export it from
`packages/core/src/index.ts`.

```ts
export const WORKSPACE_MEMORY_TYPES = [
  "project_fact",
  "decision",
  "task_context",
  "preference",
  "workflow",
  "note",
] as const;

export type WorkspaceMemoryType = (typeof WORKSPACE_MEMORY_TYPES)[number];

export const WORKSPACE_MEMORY_SOURCE_KINDS = ["user", "agent", "skill"] as const;

export type WorkspaceMemorySourceKind =
  (typeof WORKSPACE_MEMORY_SOURCE_KINDS)[number];

export interface WorkspaceMemorySource {
  kind: WorkspaceMemorySourceKind;
  providerId?: string;
  sessionId?: string;
  skillSlug?: string;
}

export interface WorkspaceMemoryEntry {
  id: string;
  workspaceId: string;
  type: WorkspaceMemoryType;
  title: string;
  content: string;
  tags: string[];
  source: WorkspaceMemorySource;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
}

export interface WorkspaceMemoryListFilter {
  workspaceId: string;
  query?: string;
  type?: WorkspaceMemoryType;
  tag?: string;
  includeArchived?: boolean;
}
```

Validation rules:

- `title`: trim, 1-160 characters.
- `content`: trim, 1-20,000 characters.
- `tags`: lowercase normalized strings, max 20 tags, each 1-40 characters.
- `type`: one of `WORKSPACE_MEMORY_TYPES`.
- `source.kind`: defaults to `user` for web UI calls and `agent` for CLI calls
  that run inside an agent session.
- `skillSlug`: display/source hint only in v1. It is not an authorization
  boundary.

## Server Storage

Add `packages/server/src/storage/repositories/memory-repo.ts`.

Each workspace has its own file:

```text
<stateRoot>/state/memory/workspaces/<encodedWorkspaceId>.json
```

Use `encodeURIComponent(workspaceId)` for the filename to avoid path traversal or
separator issues. The stored JSON still includes the original `workspaceId`.

File format:

```json
{
  "version": 1,
  "workspaceId": "ws_123",
  "entries": {
    "mem_abc": {
      "id": "mem_abc",
      "workspaceId": "ws_123",
      "type": "decision",
      "title": "Store memory in Coder Studio state",
      "content": "Project memory is server-owned and should not dirty the Git workspace by default.",
      "tags": ["architecture", "memory"],
      "source": { "kind": "user" },
      "createdAt": 1779120000000,
      "updatedAt": 1779120000000
    }
  }
}
```

Repository behavior:

- Missing file means empty memory list.
- Reads return entries sorted by `updatedAt` descending.
- `list` hides entries with `archivedAt` unless `includeArchived` is true.
- `create` generates `mem_<timestamp>_<random>` ids.
- `update` is last-write-wins for v1.
- `delete` sets `archivedAt` and updates `updatedAt`.
- `removeWorkspace(workspaceId)` deletes that workspace memory file; wire this
  into workspace teardown only if the existing workspace close/delete semantics
  already remove other workspace-local state. Otherwise keep memory when a
  workspace is closed.

## Server Commands

Create `packages/server/src/commands/memory.ts` and import it from
`packages/server/src/commands/index.ts`.

Commands:

- `memory.list`
  - args: `workspaceId`, optional `query`, `type`, `tag`, `includeArchived`
  - returns: `WorkspaceMemoryEntry[]`
- `memory.get`
  - args: `workspaceId`, `id`
  - returns: `WorkspaceMemoryEntry`
- `memory.create`
  - args: `workspaceId`, `type`, `title`, `content`, `tags`, optional
    `sourceHint`
  - returns: created `WorkspaceMemoryEntry`
- `memory.update`
  - args: `workspaceId`, `id`, optional `type`, `title`, `content`, `tags`,
    `archivedAt`
  - returns: updated `WorkspaceMemoryEntry`
- `memory.delete`
  - args: `workspaceId`, `id`
  - returns: archived `WorkspaceMemoryEntry`
- `memory.search`
  - args: same as `memory.list`, with required `query`
  - returns: `WorkspaceMemoryEntry[]`

`memory.search` can call the same repository filter as `memory.list`. Search is
case-insensitive substring matching across `title`, `content`, `tags`, and
`type`.

Workspace validation:

- Every command must require an existing workspace through `ctx.workspaceMgr.get`.
- Unknown workspace returns `workspace_not_found`.
- Unknown memory id returns `memory_not_found`.

Broadcast:

- After create/update/delete, broadcast:

```text
workspace.<workspaceId>.memory.changed
```

The payload should include `{ workspaceId, entryId, action }` where action is
`created`, `updated`, or `deleted`.

`CommandContext` additions:

- Add `memoryRepo?: MemoryRepo` or required `memoryRepo: MemoryRepo`.
- Instantiate it in `packages/server/src/server.ts` with:

```ts
new MemoryRepo({
  rootDir: join(stateRoot, "state", "memory", "workspaces"),
})
```

## CLI Automation

Extend `packages/cli/src/parse-args.ts` and `packages/cli/src/cli.ts` with a
`memory` command family.

Commands:

```bash
coder-studio memory list --workspace ws_123 --json
coder-studio memory get mem_abc --workspace ws_123 --json
coder-studio memory search "testing" --workspace ws_123 --json
coder-studio memory add --workspace ws_123 --type decision --title "..." --content "..." --tag testing --json
coder-studio memory update mem_abc --workspace ws_123 --title "..." --content "..." --tag pnpm --json
coder-studio memory delete mem_abc --workspace ws_123 --json
```

Agent-session ergonomics:

- `--workspace` is optional when `CODER_STUDIO_WORKSPACE_ID` is present.
- `--api-url` reuses existing automation URL resolution.
- `memory add` and `memory update` support repeated `--tag`.
- `memory add` accepts `--skill <slug>` as a display/source hint. The built-in
  Memory Skill should pass `--skill coder-studio-memory` when it asks an agent
  to write through the CLI.

Automation domain:

- Add `memory:read` and `memory:write` to the automation permission vocabulary.
- Include both in `DEFAULT_AGENT_AUTOMATION_PERMISSIONS`.
- Add `memory.list`, `memory.search`, `memory.get`, `memory.add`,
  `memory.update`, and `memory.delete` entries to `automation.capabilities`.

## Built-In Memory Skill

Add a built-in skill definition in `packages/server/src/skills/builtin/registry.ts`:

- slug: `coder-studio-memory`
- display name: `Coder Studio Memory`
- source: `builtin`
- default enabled: true
- auto mount: true

The skill content must not contain actual memory entries. It should teach the
agent to use Coder Studio memory only when useful:

- Read memory when the project background, prior decisions, user preferences, or
  workflow expectations are relevant.
- Prefer targeted reads by type, tag, or query over reading everything.
- Write memory only for stable project facts, explicit user preferences,
  durable decisions, or reusable workflow notes.
- Do not write transient reasoning or one-off task scratch notes as long-term
  memory.
- Use the CLI examples from the CLI Automation section.
- Mention that users can edit or delete entries from the Memory side panel.

Example skill guidance:

```md
When you need durable project context, run:

coder-studio memory list --workspace "$CODER_STUDIO_WORKSPACE_ID" --json

When you learn a stable project fact or the user states a persistent preference,
write it with:

coder-studio memory add \
  --type project_fact \
  --title "..." \
  --content "..." \
  --tag architecture \
  --skill coder-studio-memory \
  --json
```

## Web UI

Add a new desktop side panel view named `memory`.

Files:

- Modify `packages/web/src/features/workspace/atoms/layout.ts`
  - Add `"memory"` to `DesktopSidebarView`.
  - Add it to the sanitizer allowlist.
- Modify
  `packages/web/src/features/workspace/views/shared/workspace-activity-bar.tsx`
  - Add Memory activity entry.
  - Place it after Agent Instructions and before Skills.
- Modify
  `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx`
  - Render `MemoryPanel` when `activeSidebarView === "memory"`.
- Create `packages/web/src/features/workspace/actions/use-memory-panel.ts`.
- Create `packages/web/src/features/workspace/views/shared/memory-panel.tsx`.
- Update `packages/web/src/locales/en.json` and
  `packages/web/src/locales/zh.json`.
- Add theme/icon semantic support for `nav.memory`, using the existing icon
  theme system. A notebook or brain semantic is acceptable if it matches the
  current icon theme.

Panel layout:

- Use the existing `workspace-sidebar-view`,
  `workspace-sidebar-panel__body`, and related workspace sidebar conventions.
- Header shows `Project Memory` and active entry count.
- Top controls:
  - search input for filtering existing memory entries by title, content, or
    tags; this is not the create-entry input
  - type filter segmented/chip control
  - `New` action
- List:
  - title
  - type badge
  - short content preview
  - tags
  - source summary
  - updated time
- Detail editor:
  - type select
  - title input
  - content textarea
  - tag editor
  - save action
  - delete action
  - source and updated metadata

Interaction:

- Load list on mount.
- Refresh on `workspace.<workspaceId>.memory.changed`.
- Optimistically keep local edits in a draft state until saved.
- After create, select the created entry.
- After delete, remove the entry from the visible list and select the next entry
  if available.
- Show a `Notice` for command failures.
- Disable save while request is in flight.

## Visual And Typography Constraints

The Memory panel should feel like a native Coder Studio workbench panel, not a
new feature landing page.

Visual direction:

- Flat, low-decoration workbench UI.
- No decorative gradients, glow, glass, floating cards, or heavy shadows.
- Prefer divider rows for the memory list over card stacks.
- Use a low-contrast selected row background and a narrow neutral indicator.
- Keep badges restrained and small.
- Do not use large hero-style headings inside the side panel.
- Avoid nested cards.

Typography:

- Follow existing typography tokens in `packages/web/src/styles/tokens.css`.
- Panel header and selected-entry title should use existing
  sidebar/workbench title styles. If a new class is needed, cap it at
  `var(--type-heading-6-size)` or `var(--type-body-3-size)`.
- Entry titles should use `var(--type-body-4-size)` or `var(--text-base)`.
- Entry previews, form controls, footer metadata, and secondary helper text
  should use `var(--type-body-5-size)` or `var(--text-sm)` unless the existing
  input/button component already defines a tokenized size.
- Labels, badges, compact counts, tag metadata, and row meta text should use
  `var(--type-body-6-size)` or `var(--text-xs)`.
- Do not use hard-coded `18px`, `20px`, or larger typography inside the Memory
  side panel unless reusing an existing workspace component class that already
  applies that size in the same context.
- Inputs, buttons, chips, badges, and row text must use existing component
  tokens or nearby workspace-sidebar styles instead of ad hoc font sizes.
- Text must not overflow its parent at desktop side panel widths; use truncation
  for list titles and wrapping for detail content.

The temporary local HTML mockup is a visual reference only. Implementation must
adapt the idea to existing CSS tokens and current workbench visual rules.

## Data Flow

User-created memory:

```text
MemoryPanel form
  -> dispatchCommand("memory.create" | "memory.update" | "memory.delete")
  -> MemoryRepo writes workspace file
  -> server broadcasts workspace.<id>.memory.changed
  -> MemoryPanel refreshes list
```

Agent/skill-created memory:

```text
Agent reads built-in Memory Skill
  -> runs coder-studio memory add/search/list
  -> CLI calls server WebSocket command
  -> MemoryRepo writes workspace file
  -> MemoryPanel receives memory.changed and refreshes
```

Agent read flow:

```text
Agent decides memory may help
  -> coder-studio memory search/list/get
  -> CLI returns JSON
  -> agent uses relevant entries in current reasoning
```

No automatic startup injection occurs.

## Error Handling

Server errors:

- `workspace_not_found`
- `memory_not_found`
- `memory_validation_failed`
- `memory_storage_unavailable`

UI behavior:

- Loading state while fetching.
- Empty state when no entries exist.
- Search empty state when filters match nothing.
- Inline notice for failures.
- Retry by re-running the failed action or refreshing the panel.

CLI behavior:

- Non-zero exit with readable error for failed command.
- `--json` prints structured command result or error text consistent with
  existing CLI behavior.
- Missing workspace outside an agent session reports that `--workspace` is
  required.

## Testing

Core:

- `WorkspaceMemoryType` and source constants are exported.
- Type guards or validators accept only supported memory types.

Server:

- `MemoryRepo` returns empty list for missing workspace file.
- `MemoryRepo` creates one file per workspace.
- `MemoryRepo` uses encoded workspace ids for filenames.
- Create/update/delete persist atomically.
- Soft-deleted entries are hidden by default and visible with
  `includeArchived`.
- Search filters title, content, tags, and type case-insensitively.
- Commands reject unknown workspaces.
- Commands reject invalid type, empty title, empty content, or invalid tags.
- Commands broadcast `workspace.<workspaceId>.memory.changed` after writes.
- Server assembly injects `memoryRepo` into `CommandContext`.

CLI:

- Parser accepts all memory subcommands.
- `memory list/search/get/add/update/delete` map to the correct server op.
- `--workspace` falls back to `CODER_STUDIO_WORKSPACE_ID`.
- Repeated `--tag` values are passed as an array.
- `--skill` is passed as a source hint on writes.

Built-in skill:

- Materialization writes `coder-studio-memory/SKILL.md`.
- Built-in sync auto-mounts the skill for eligible providers.
- Skill text contains CLI read/write examples.
- Skill text does not contain actual workspace memory content.

Web:

- `memory` is accepted by `sanitizeDesktopSidebarView`.
- Workspace activity bar renders the Memory entry.
- Desktop workspace renders `MemoryPanel` for the memory view.
- `MemoryPanel` loads entries and displays empty state.
- Search and type filters update visible entries.
- Create, edit, and delete dispatch the expected commands.
- The panel refreshes on `workspace.<workspaceId>.memory.changed`.
- Failure states render notices.
- Typography checks should assert the panel uses existing class names/tokens where
  practical rather than hard-coded large font sizes.

## Rollout

Recommended implementation order:

1. Core memory domain types.
2. Server `MemoryRepo`, commands, command context wiring, and tests.
3. CLI memory commands and automation capability entries.
4. Built-in `coder-studio-memory` skill and sync tests.
5. Web Memory side panel and UI tests.
6. Full verification with relevant package tests, then repository-level
   verification before handoff.

## Risks

- Direct agent writes can create noisy memory. Mitigation: source display,
  compact filters, and user edit/delete controls.
- Agents may forget to read memory because content is not injected. Mitigation:
  default-mounted Memory Skill and automation capability discovery.
- `skillSlug` source is not strongly authenticated in v1. Mitigation: treat it
  as a display hint, not a permission boundary.
- Last-write-wins can overwrite concurrent edits. Mitigation: acceptable for v1;
  optimistic locking is outside the v1 scope.
- State-owned memory does not follow the Git repo to another machine. Mitigation:
  future export/import or optional project-file mirror.

## Acceptance Criteria

- A user can open the desktop Memory side panel for a workspace.
- A user can create, edit, and delete structured memory entries.
- Entries support fixed type and free-form tags.
- Entries show source and update metadata.
- Memory persists in one JSON file per workspace under Coder Studio state.
- An agent can read memory with `coder-studio memory list/search/get`.
- An agent can write memory with `coder-studio memory add/update/delete`.
- The built-in Memory Skill is available to supported providers by default and
  explains how to use the CLI.
- Starting a new agent session does not inject memory entry content by default.
- The Memory panel follows existing workbench typography tokens and flat side
  panel styling.
