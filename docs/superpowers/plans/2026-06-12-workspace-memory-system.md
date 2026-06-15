# Workspace Memory System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build project-scoped structured memory that users can manage in the desktop side panel and agents can read/write on demand through a built-in skill and CLI commands.

**Architecture:** Core owns memory contracts and automation capabilities. Server owns a per-workspace JSON repository, command handlers, and broadcasts. CLI exposes the command family for agents, the built-in Memory Skill teaches the agent when to use it, and web renders a flat workbench-native Memory side panel.

**Tech Stack:** TypeScript, pnpm monorepo, Vitest, React 19, Jotai-free local state for panel drafts, existing WebSocket command dispatch, existing JSON atomic storage helpers.

---

## File Structure

- Create `packages/core/src/domain/memory.ts`: shared memory constants, types, validation helpers, and source normalization.
- Modify `packages/core/src/index.ts`: export memory domain.
- Modify `packages/core/src/domain/automation.ts`: add `memory:read` and `memory:write` automation permissions and memory capabilities.
- Create `packages/core/src/domain/memory.test.ts`: type/validator tests.
- Modify `packages/core/src/domain/automation.test.ts`: capability and default-permission tests.
- Create `packages/server/src/storage/repositories/memory-repo.ts`: per-workspace JSON storage and search/filter behavior.
- Create `packages/server/src/storage/repositories/memory-repo.test.ts`: repository persistence, validation, soft-delete, and search tests.
- Create `packages/server/src/commands/memory.ts`: `memory.list/get/create/update/delete/search` command handlers.
- Create `packages/server/src/commands/memory.test.ts`: command validation, workspace validation, and broadcast tests.
- Modify `packages/server/src/commands/index.ts`: register memory commands.
- Modify `packages/server/src/ws/dispatch.ts`: add `memoryRepo` to `CommandContext`.
- Modify `packages/server/src/server.ts`: instantiate `MemoryRepo`.
- Modify `packages/cli/src/parse-args.ts`: parse `coder-studio memory ...`.
- Modify `packages/cli/src/parse-args.test.ts`: parser tests for memory subcommands.
- Modify `packages/cli/src/cli.ts`: dispatch memory CLI commands.
- Create or modify `packages/cli/src/cli.test.ts`: command mapping tests if existing CLI tests provide a command-runner pattern; otherwise keep CLI mapping covered through parser plus focused helper tests.
- Modify `packages/server/src/skills/builtin/registry.ts`: register `coder-studio-memory`.
- Modify built-in skill tests under `packages/server/src/skills/builtin/*.test.ts`: assert materialization and auto-mount behavior.
- Modify `packages/web/src/features/workspace/atoms/layout.ts`: add `memory` sidebar view.
- Modify `packages/web/src/features/workspace/views/shared/workspace-activity-bar.tsx`: add Memory activity item.
- Modify `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx`: render `MemoryPanel`.
- Create `packages/web/src/features/workspace/actions/use-memory-panel.ts`: command-facing hook for list/create/update/delete/search refresh.
- Create `packages/web/src/features/workspace/views/shared/memory-panel.tsx`: flat list + detail editor UI.
- Create `packages/web/src/features/workspace/views/shared/memory-panel.test.tsx`: UI behavior tests.
- Modify `packages/web/src/locales/en.json` and `packages/web/src/locales/zh.json`: Memory labels.
- Modify icon/theme files only if `nav.memory` semantic cannot reuse an existing semantic.
- Modify `packages/web/src/styles/components.css`: tokenized flat panel styles if existing classes are insufficient.

## Tasks

### Task 1: Core Memory Domain And Automation Capabilities

**Files:**
- Create: `packages/core/src/domain/memory.ts`
- Create: `packages/core/src/domain/memory.test.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/domain/automation.ts`
- Modify: `packages/core/src/domain/automation.test.ts`

- [ ] **Step 1: Write failing core tests**

Add tests that prove supported memory types are exported, title/content/tags are normalized and rejected when invalid, source defaults can be derived, and automation capabilities include `memory.list`, `memory.search`, `memory.get`, `memory.add`, `memory.update`, and `memory.delete` when memory permissions are present.

- [ ] **Step 2: Run core tests to verify failure**

Run:

```bash
pnpm --filter @coder-studio/core test -- memory.test.ts automation.test.ts
```

Expected: FAIL because `domain/memory.ts` and memory automation capabilities do not exist yet.

- [ ] **Step 3: Implement core memory domain and automation updates**

Implement:

- `WORKSPACE_MEMORY_TYPES`
- `WORKSPACE_MEMORY_SOURCE_KINDS`
- `normalizeWorkspaceMemoryTags(tags: readonly string[]): string[]`
- `validateWorkspaceMemoryInput(input): { type; title; content; tags }`
- `resolveWorkspaceMemorySource(input): WorkspaceMemorySource`
- exports from `packages/core/src/index.ts`
- memory permissions in `DEFAULT_AGENT_AUTOMATION_PERMISSIONS`
- memory capabilities in `domain/automation.ts`

- [ ] **Step 4: Run core tests to verify pass**

Run:

```bash
pnpm --filter @coder-studio/core test -- memory.test.ts automation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/domain/memory.ts packages/core/src/domain/memory.test.ts packages/core/src/index.ts packages/core/src/domain/automation.ts packages/core/src/domain/automation.test.ts
git commit -m "feat(core): add workspace memory domain"
```

### Task 2: Server Memory Repository

**Files:**
- Create: `packages/server/src/storage/repositories/memory-repo.ts`
- Create: `packages/server/src/storage/repositories/memory-repo.test.ts`

- [ ] **Step 1: Write failing repository tests**

Cover empty missing-file reads, encoded workspace filenames, create persistence, update persistence, soft delete hidden by default, include archived, and case-insensitive search across title/content/tags/type.

- [ ] **Step 2: Run repository tests to verify failure**

Run:

```bash
pnpm --filter @coder-studio/server test -- memory-repo.test.ts
```

Expected: FAIL because `MemoryRepo` does not exist.

- [ ] **Step 3: Implement `MemoryRepo`**

Use `readJsonFile` and `writeJsonFileAtomic`. Store files at `<rootDir>/<encodeURIComponent(workspaceId)>.json`. Use `validateWorkspaceMemoryInput` and `resolveWorkspaceMemorySource` from core. Sort visible entries by `updatedAt` descending. Generate ids with `mem_${Date.now()}_${randomBytes(4).toString("hex")}`.

- [ ] **Step 4: Run repository tests to verify pass**

Run:

```bash
pnpm --filter @coder-studio/server test -- memory-repo.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/storage/repositories/memory-repo.ts packages/server/src/storage/repositories/memory-repo.test.ts
git commit -m "feat(server): add workspace memory repository"
```

### Task 3: Server Memory Commands And Wiring

**Files:**
- Create: `packages/server/src/commands/memory.ts`
- Create: `packages/server/src/commands/memory.test.ts`
- Modify: `packages/server/src/commands/index.ts`
- Modify: `packages/server/src/ws/dispatch.ts`
- Modify: `packages/server/src/server.ts`

- [ ] **Step 1: Write failing command tests**

Cover workspace validation, `memory.create`, `memory.list`, `memory.search`, `memory.get`, `memory.update`, `memory.delete`, invalid type/title/content/tag errors, `memoryRepo` missing error, and `workspace.<id>.memory.changed` broadcasts after writes.

- [ ] **Step 2: Run command tests to verify failure**

Run:

```bash
pnpm --filter @coder-studio/server test -- memory.test.ts
```

Expected: FAIL because memory command handlers are not registered.

- [ ] **Step 3: Implement command handlers and server wiring**

Register all memory commands with zod schemas. Add `memoryRepo?: MemoryRepo` to `CommandContext`. Throw `memory_storage_unavailable` if missing. Instantiate `new MemoryRepo({ rootDir: join(stateRoot, "state", "memory", "workspaces") })` in `server.ts`. Import `./memory.js` from command index.

- [ ] **Step 4: Run command tests to verify pass**

Run:

```bash
pnpm --filter @coder-studio/server test -- memory.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/commands/memory.ts packages/server/src/commands/memory.test.ts packages/server/src/commands/index.ts packages/server/src/ws/dispatch.ts packages/server/src/server.ts
git commit -m "feat(server): add workspace memory commands"
```

### Task 4: CLI Memory Commands

**Files:**
- Modify: `packages/cli/src/parse-args.ts`
- Modify: `packages/cli/src/parse-args.test.ts`
- Modify: `packages/cli/src/cli.ts`
- Modify or create: `packages/cli/src/cli.test.ts`

- [ ] **Step 1: Write failing CLI tests**

Cover parsing and command dispatch for `memory list/get/search/add/update/delete`, repeated `--tag`, `--type`, `--title`, `--content`, `--skill`, `--workspace`, workspace fallback from `CODER_STUDIO_WORKSPACE_ID`, and `--json`.

- [ ] **Step 2: Run CLI tests to verify failure**

Run:

```bash
pnpm --filter @spencer-kit/coder-studio test -- parse-args.test.ts cli.test.ts
```

Expected: FAIL because `memory` is not a known CLI command.

- [ ] **Step 3: Implement CLI parsing and dispatch**

Add `memory` command family and options. Map CLI commands to server ops:

- `list` -> `memory.list`
- `get` -> `memory.get`
- `search` -> `memory.search`
- `add` -> `memory.create`
- `update` -> `memory.update`
- `delete` -> `memory.delete`

Use `args.workspaceId` when set, otherwise fall back to
`process.env.CODER_STUDIO_WORKSPACE_ID`; throw `Missing workspace value` if
neither exists for memory operations. Pass `sourceHint` with `skillSlug` when
`--skill` is provided.

- [ ] **Step 4: Run CLI tests to verify pass**

Run:

```bash
pnpm --filter @spencer-kit/coder-studio test -- parse-args.test.ts cli.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/parse-args.ts packages/cli/src/parse-args.test.ts packages/cli/src/cli.ts packages/cli/src/cli.test.ts
git commit -m "feat(cli): add workspace memory commands"
```

### Task 5: Built-In Memory Skill

**Files:**
- Modify: `packages/server/src/skills/builtin/registry.ts`
- Modify: relevant tests under `packages/server/src/skills/builtin/`

- [ ] **Step 1: Write failing built-in skill tests**

Assert `coder-studio-memory` exists, is default enabled, auto mounts, materializes a `SKILL.md`, contains CLI list/search/add examples, and does not contain actual workspace memory entries.

- [ ] **Step 2: Run built-in skill tests to verify failure**

Run:

```bash
pnpm --filter @coder-studio/server test -- builtin
```

Expected: FAIL because `coder-studio-memory` is not registered.

- [ ] **Step 3: Implement built-in skill registration and content**

Add a built-in skill definition with the approved guidance:

- read when durable project context is useful
- prefer targeted reads
- write only stable project facts/preferences/decisions/workflows
- avoid transient scratch notes
- show CLI read/write examples
- mention users can edit/delete from Memory side panel

- [ ] **Step 4: Run built-in skill tests to verify pass**

Run:

```bash
pnpm --filter @coder-studio/server test -- builtin
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/skills/builtin/registry.ts packages/server/src/skills/builtin
git commit -m "feat(server): add built-in memory skill"
```

### Task 6: Web Memory Panel

**Files:**
- Modify: `packages/web/src/features/workspace/atoms/layout.ts`
- Modify: `packages/web/src/features/workspace/views/shared/workspace-activity-bar.tsx`
- Modify: `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx`
- Create: `packages/web/src/features/workspace/actions/use-memory-panel.ts`
- Create: `packages/web/src/features/workspace/views/shared/memory-panel.tsx`
- Create: `packages/web/src/features/workspace/views/shared/memory-panel.test.tsx`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`
- Modify: `packages/web/src/styles/components.css`
- Modify icon/theme files only if required by compile errors.

- [ ] **Step 1: Write failing web tests**

Cover `sanitizeDesktopSidebarView("memory")`, activity bar rendering Memory after Agent Instructions and before Skills, desktop view rendering `MemoryPanel`, loading entries through command dispatch, creating/selecting new entries, editing/saving, deleting/selecting next entry, search/type filter behavior, command failure notice, and tokenized CSS guard for Memory panel typography.

- [ ] **Step 2: Run web tests to verify failure**

Run:

```bash
pnpm --filter @coder-studio/web test -- memory-panel.test.tsx workspace-activity-bar
```

Expected: FAIL because the Memory view and panel do not exist.

- [ ] **Step 3: Implement Memory panel UI and hook**

Use existing workspace sidebar classes where practical. The panel has a header, search input, type filter, flat divider-row list, and detail editor. Keep all panel typography tokenized: selected title maxes at `var(--type-heading-6-size)` or an existing sidebar title class; list titles use body-4/text-base; metadata and badges use body-6/text-xs.

- [ ] **Step 4: Run web tests to verify pass**

Run:

```bash
pnpm --filter @coder-studio/web test -- memory-panel.test.tsx workspace-activity-bar
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/workspace/atoms/layout.ts packages/web/src/features/workspace/views/shared/workspace-activity-bar.tsx packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx packages/web/src/features/workspace/actions/use-memory-panel.ts packages/web/src/features/workspace/views/shared/memory-panel.tsx packages/web/src/features/workspace/views/shared/memory-panel.test.tsx packages/web/src/locales/en.json packages/web/src/locales/zh.json packages/web/src/styles/components.css
git commit -m "feat(web): add workspace memory panel"
```

### Task 7: Integration Verification

**Files:**
- Modify any failing tests or type errors in files touched by Tasks 1-6.

- [ ] **Step 1: Run targeted package tests**

Run:

```bash
pnpm --filter @coder-studio/core test
pnpm --filter @coder-studio/server test -- memory
pnpm --filter @spencer-kit/coder-studio test -- memory parse-args cli
pnpm --filter @coder-studio/web test -- memory-panel
```

Expected: PASS.

- [ ] **Step 2: Run typecheck for touched packages**

Run:

```bash
pnpm --filter @coder-studio/core exec tsc -p tsconfig.json --noEmit
pnpm --filter @coder-studio/server exec tsc -p tsconfig.json --noEmit
pnpm --filter @spencer-kit/coder-studio exec tsc -p tsconfig.json --noEmit
pnpm --filter @coder-studio/web exec tsc -p tsconfig.json --noEmit
```

Expected: PASS.

- [ ] **Step 3: Run lint/check on touched files**

Run:

```bash
pnpm exec biome check packages/core/src/domain/memory.ts packages/core/src/domain/memory.test.ts packages/core/src/domain/automation.ts packages/server/src/storage/repositories/memory-repo.ts packages/server/src/storage/repositories/memory-repo.test.ts packages/server/src/commands/memory.ts packages/server/src/commands/memory.test.ts packages/cli/src/parse-args.ts packages/cli/src/cli.ts packages/web/src/features/workspace/actions/use-memory-panel.ts packages/web/src/features/workspace/views/shared/memory-panel.tsx
```

Expected: PASS.

- [ ] **Step 4: Run repository verification if targeted checks pass**

Run:

```bash
pnpm ci:verify
```

Expected: PASS.

- [ ] **Step 5: Commit final fixes if any**

```bash
git status --short
git add <only files changed by memory-system work>
git commit -m "test: verify workspace memory system"
```

Only commit if Step 1-4 produced necessary fixes.
