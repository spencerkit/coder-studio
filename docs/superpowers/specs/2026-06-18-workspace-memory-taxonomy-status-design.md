# Workspace Memory Taxonomy And Status Design

> Date: 2026-06-18
> Status: Draft for user review
> Owner: Codex

## Problem

Workspace memory currently uses five string literal types:

```ts
feature | todo | bugfix | project | note
```

Those values have become ambiguous:

- `project` sounds narrower than the actual use case, which includes reusable
  project knowledge, commands, conventions, architecture notes, and stable
  operating context.
- `bugfix` describes an implementation action, while users need a category for
  the underlying problem.
- `feature` can mean either an already existing capability or a future request.
  The product direction is to avoid that split for now.
- A single progress/status field should not apply to informational memory such
  as wiki notes.

There are also two nearby UI issues in the active memory todo set:

- On desktop, selecting a type in the create-memory dropdown does not close the
  dropdown.
- The draggable split line can sit above the editor and should not remain
  visually prominent.

## Goal

Simplify memory taxonomy to four durable categories and add progress only where
progress has clear meaning:

```ts
wiki | issue | todo | note
```

The final user-facing order is:

1. Wiki
2. Issue / 问题
3. Todo / 待办
4. Note / 备注

Only `issue` and `todo` entries can carry progress. `wiki` and `note` are
informational and do not expose or persist progress.

## Non-Goals

- Do not add separate `capability`, `feature`, `request`, or `improvement`
  categories in this iteration.
- Do not build a dedicated migration command or startup migration pass.
- Do not introduce tags, title, hierarchy, assignees, due dates, or priority.
- Do not change memory storage from workspace-scoped JSON files.
- Do not redesign the whole memory panel layout.
- Do not add mobile-specific memory UI beyond keeping shared behavior valid.

## Decisions

Use a constant object plus ordered arrays instead of a TypeScript `enum`.

```ts
export const WorkspaceMemoryType = {
  Wiki: "wiki",
  Issue: "issue",
  Todo: "todo",
  Note: "note",
} as const;

export const WORKSPACE_MEMORY_TYPES = [
  WorkspaceMemoryType.Wiki,
  WorkspaceMemoryType.Issue,
  WorkspaceMemoryType.Todo,
  WorkspaceMemoryType.Note,
] as const;
```

This keeps centralized named values, preserves ordering, works with existing
`z.enum(WORKSPACE_MEMORY_TYPES)`, and makes legacy alias handling explicit.

Add a status field for actionable entries:

```ts
export const WorkspaceMemoryStatus = {
  NotStarted: "not_started",
  InProgress: "in_progress",
  PendingVerification: "pending_verification",
  Completed: "completed",
} as const;
```

Status applies only to `issue` and `todo`.

## Legacy Type Compatibility

Old stored values and temporary API/CLI inputs map to the new taxonomy:

```text
project -> wiki
bugfix  -> issue
feature -> wiki
todo    -> todo
note    -> note
```

The `feature -> wiki` mapping is intentional. The existing workspace memory
entries using `feature` are mostly stable facts about existing product behavior.
Since the product is not keeping a separate capability/improvement split in this
iteration, `wiki` is the least ambiguous destination.

Compatibility behavior:

- Reading old JSON normalizes legacy types before returning runtime entries.
- API and CLI may accept legacy type aliases during this transition.
- New command responses and new writes return only `wiki`, `issue`, `todo`, or
  `note`.
- The next create, update, or delete for a workspace rewrites the whole memory
  file in normalized form through the existing repository write path.
- Invalid unknown types still fail validation or are skipped during legacy file
  normalization, matching the current repository tolerance.

## Status Semantics

Valid statuses:

```text
not_started
in_progress
pending_verification
completed
```

Rules:

- New `issue` and `todo` entries default to `not_started` when no status is
  provided.
- New `wiki` and `note` entries have no `status`.
- Updating an entry from `issue` or `todo` to `wiki` or `note` clears `status`.
- Updating an entry from `wiki` or `note` to `issue` or `todo` defaults status
  to `not_started` unless a valid status is provided.
- Search remains content/type-based. Status does not need search matching in
  this iteration.

The intended workflow is:

- Agents or users mark work as `in_progress` when actively handling it.
- Agents may mark finished work as `pending_verification` so the user can
  verify it.
- Users can mark verified work as `completed`.

## Core Contract

`packages/core/src/domain/memory.ts` should expose:

- `WorkspaceMemoryType` constant object
- `WORKSPACE_MEMORY_TYPES` ordered array
- `WorkspaceMemoryStatus` constant object
- `WORKSPACE_MEMORY_STATUSES` ordered array
- `WorkspaceMemoryEntry.status?: WorkspaceMemoryStatus`
- validation helpers that normalize legacy type aliases and enforce status
  applicability

The validated create/update result should never contain legacy types. It should
also omit status for non-actionable types.

## Server Behavior

`packages/server/src/commands/memory.ts` should:

- validate `memory.create`, `memory.update`, `memory.list`, and `memory.search`
  against the new canonical type set plus accepted legacy aliases
- accept optional `status` for create/update
- reject invalid statuses
- normalize legacy types before reaching storage

`packages/server/src/storage/repositories/memory-repo.ts` should:

- normalize legacy stored types while reading files
- normalize or clear status according to type during create/update
- write only canonical types and valid statuses
- keep sorting, soft delete, workspace file naming, and missing-file behavior
  unchanged

## CLI And Automation Metadata

Automation capability descriptions and CLI help/examples should list only:

```text
wiki | issue | todo | note
```

During the compatibility window, callers using `project`, `bugfix`, or
`feature` should still work, but docs and examples should not encourage those
values.

## Web UI

`MemoryPanel` should:

- show type options in the order Wiki, Issue, Todo, Note
- use localized labels:
  - English: Wiki, Issue, Todo, Note
  - Chinese: Wiki, 问题, 待办, 备注
- show status controls only for `issue` and `todo`
- hide status controls for `wiki` and `note`
- clear local draft status when the selected type becomes `wiki` or `note`
- default local draft status to `not_started` when the selected type becomes
  `issue` or `todo`
- render status badges or metadata for actionable entries only

The existing content-only memory shape remains unchanged otherwise.

## Adjacent UI Fixes

### Desktop Select Close

The desktop select/listbox behavior should close after selecting an option. The
fix should live in the shared select component if the broken behavior is generic;
otherwise it can be scoped to the memory type select. Tests should prove that a
desktop option click updates the value and closes the listbox.

### Split Handle Layering

The draggable split handle should remain usable but not visually cover the
editor:

- lower the handle overlay z-index relative to editor content where possible
- make the visible divider transparent or effectively invisible
- preserve the pointer target size so resizing remains ergonomic
- avoid broad layout refactors in pane or editor rendering

## Testing

Focused tests should cover:

- core memory type/status constants and validation
- legacy type normalization:
  - `project -> wiki`
  - `bugfix -> issue`
  - `feature -> wiki`
- status applicability:
  - `issue`/`todo` keep or default status
  - `wiki`/`note` omit status
  - changing to a non-actionable type clears status
- server command schemas accept canonical types and temporary legacy aliases
- repository reads old files without dropping valid entries
- memory panel renders the four type options in order
- memory panel only shows status controls for actionable types
- desktop select closes after an option selection

For handoff, run the relevant package tests first, then repository verification
if time permits:

```bash
pnpm --filter @coder-studio/core test
pnpm --filter @coder-studio/server test
pnpm --filter @coder-studio/web test
pnpm ci:verify
```

## Risks

- Existing user data with old type strings must not disappear. This is addressed
  by read-time normalization.
- Agents or scripts may still send `project`, `bugfix`, or `feature`. Temporary
  command-level aliases reduce breakage while docs move to canonical names.
- Status can become misleading if exposed on informational entries. The schema
  and UI both avoid status for `wiki` and `note`.
- Changing shared select behavior may affect other desktop selects. The test
  should check the shared expectation and implementation should preserve current
  mobile sheet behavior.

## Validation

The feature is complete when:

- `memory.list` returns only `wiki`, `issue`, `todo`, or `note` types.
- Old memory files containing `project`, `bugfix`, or `feature` still load.
- New writes persist only canonical types.
- `issue` and `todo` can display and update status.
- `wiki` and `note` do not display or persist status.
- The desktop memory type dropdown closes on selection.
- The split drag handle no longer visibly covers editor content while remaining
  draggable.
