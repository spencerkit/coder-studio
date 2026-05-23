# Workspace Sidebar, Search, and Quick Open Design

> Status: Draft
> Date: 2026-05-23
> Scope: `packages/web/src/features/workspace/*`, `packages/web/src/features/command-palette/*`, new workspace search and quick-open surfaces, `packages/server/src/commands/file.ts`, `packages/server/src/fs/*`

## Goal

Restructure the desktop workspace left rail to follow a VS Code style workbench model and add two missing navigation capabilities:

- a dedicated sidebar content search view for the current workspace
- a dedicated file jump surface similar to VS Code Quick Open

The product should:

- replace the current top-level `文件 / Git` tab switcher with an Activity Bar plus independent sidebar views
- keep file browsing, content search, and source control as separate mental models
- remove the current file-tree search field from Explorer because it currently behaves like file-name filtering but is presented like search
- add true file content search scoped to the active workspace
- add `Ctrl/Cmd+P` Quick Open for file jump scoped to the active workspace
- preserve the existing `Ctrl/Cmd+K` command palette for actions
- reuse as much of the existing file tree and git panel implementation as possible

## Non-Goals

This design does not include:

- cross-workspace search or cross-workspace Quick Open
- search-and-replace in the first release
- symbol search such as `@symbol` or `#symbol`
- VS Code command palette syntax such as `>` inside Quick Open
- line and column address syntax such as `file:12:3`
- changes to mobile workspace navigation in the first release
- a secondary right sidebar or panel docking model

## Problem

The current desktop workspace sidebar has two issues:

1. the information architecture is too flat because file browsing and Git are represented as top tabs inside a single panel
2. the only search affordance in the file tree is mislabeled for the intended job

Today, `file.search` is a filename and path match command. It is useful, but it is not content search.

That creates two product gaps:

- users do not have a way to search inside file contents from the workspace sidebar
- users do not have a dedicated file jump surface for quickly opening files by name

VS Code solves this by separating concerns:

- Explorer for files
- Search for content matches
- Source Control for Git state
- Quick Open for file navigation

That separation is the correct model here as well because it keeps each surface focused and avoids growing the file tree into a catch-all control area.

## Decision Summary

Adopt a three-view desktop workbench sidebar with a dedicated global Quick Open overlay.

### Sidebar Views

- `Explorer`
- `Search`
- `Source Control`

### Global Overlays

- keep `Command Palette` on `Ctrl/Cmd+K`
- add `Quick Open` on `Ctrl/Cmd+P`

### Search Responsibilities

- `Explorer` handles file tree browsing and file tree actions only
- `Search` handles file content search only
- `Source Control` handles Git status and related actions only
- `Quick Open` handles filename and path based file jump only

### Backend Responsibilities

- keep `file.search` for filename and path search
- add `file.searchContent` for true content search

This is the recommended design because it matches user expectations from modern editors while keeping implementation boundaries clean.

## Product Behavior

## Desktop Sidebar Layout

Replace the current desktop sidebar tabs with a workbench-style layout:

- far-left vertical `Activity Bar`
- main sidebar content area to the right

The Activity Bar controls which sidebar view is active. It should be visually lightweight and editor-like rather than decorative.

### Activity Bar Entries

First release entries:

- `Explorer`
- `Search`
- `Source Control`

Each entry shows:

- icon
- active state
- hover tooltip

The active item controls which sidebar view fills the content area.

Only one view is visible at a time.

## Explorer View

Explorer becomes a focused file-browsing surface.

### Explorer Contents

- panel header title: `Explorer`
- top-right actions:
  - new file
  - new folder
  - collapse all
- `Open Editors` section
- `Workspace` section containing the existing tree

`Open Editors` is in scope for the first release.

Its first-release behavior should stay intentionally small:

- render the currently open files from existing editor state
- clicking an entry activates that file
- no close buttons
- no dirty-state badges

### Explorer Search Removal

Remove the current search field from `FileTreePanel` in desktop Explorer mode.

Reasoning:

- it suggests content search but currently performs filename/path search
- once `Quick Open` exists, filename search belongs there
- once `Search` exists, content search belongs there

The Explorer tree should not keep a generic always-visible search input in the first release.

### File Tree Behavior

Keep existing tree behavior where possible:

- expand and collapse directories
- lazy child loading
- file selection and open behavior
- context menu actions
- create, rename, delete flows

No new file tree behavior changes are required beyond the layout and search field removal.

## Search View

Search is a dedicated sidebar view for file content search inside the active workspace.

### Search Contents

- panel header title: `Search`
- primary search input
- result summary line
- grouped result list by file

First release does not include replace controls.

### Search Query Behavior

- scope: active workspace only
- debounce: `250ms`
- empty query: no results list, show instructional empty state
- loading query: show compact loading state
- no matches: show compact empty state

### Search Results Structure

Results should be grouped by file.

Each file group shows:

- file name
- relative path
- match count in that file

Each match row shows:

- line number
- trimmed snippet
- highlighted matched text based on backend match columns

Clicking a match should:

- open the file in the editor
- navigate to the matching line
- keep Search view open so the user can continue stepping through results

### Search Result Ordering

Ordering:

- files in backend result order
- matches in ascending line order within a file

The backend should return stable ordering so the client does not have to reconstruct it.

### Search Result Size

The first release sets bounded result limits to protect sidebar performance:

- file group limit: `50`
- per-file match cap: `20`

If results are truncated, the UI should say so explicitly.

## Source Control View

Source Control becomes the third sidebar view and should reuse the existing shared Git panel as much as possible.

### Source Control Contents

- panel header title: `Source Control`
- existing Git status, changed files, history, and worktree related UI already present in `GitPanel`

This design changes placement and naming, not the core Git workflow.

## Quick Open

Quick Open is a new global overlay dedicated to opening files by name or path.

It is distinct from the existing command palette.

### Trigger

- `Ctrl+P` on Windows and Linux
- `Cmd+P` on macOS

### Scope

- active workspace only

### Query Model

Quick Open uses the existing filename/path search backend capability.

It should match:

- full file name
- basename without extension
- path segment prefix
- fuzzy subsequence matches

### Quick Open Results

Each result row should show:

- file name
- relative path

Ranking uses the existing backend filename search ordering:

- exact filename match
- basename match
- prefix match
- substring match
- subsequence match

The first release does not add recency or currently-open boosts on top of backend ordering.

### Quick Open Interactions

- typing updates results in place
- `ArrowUp` and `ArrowDown` move selection
- `Enter` opens selected file
- `Escape` closes overlay
- clicking a row opens the file

The overlay should close after a file opens.

### Empty and Loading States

- empty query: show instructional hint
- loading: compact loading row
- no results: compact empty row

## Command Palette Separation

Keep the existing command palette on `Ctrl/Cmd+K`.

Do not merge Quick Open into the command palette in the first release.

Reasoning:

- command lookup and file jump are different tasks
- the existing command palette already has action-oriented semantics
- a separate Quick Open keeps both systems simpler to reason about and test

## Frontend Architecture

## Sidebar Shell

Introduce a dedicated desktop sidebar shell that owns:

- Activity Bar
- active sidebar view state
- shared panel header layout for each view

Recommended structure:

- `WorkspaceSidebarShell`
  - `WorkspaceActivityBar`
  - `ExplorerPanel`
  - `SearchPanel`
  - `SourceControlPanel`

This separates global sidebar navigation from the content panels themselves.

## Explorer Panel

Create a thin Explorer wrapper that composes:

- panel header
- open editors section
- current `FileTreePanel` tree content

`FileTreePanel` should be narrowed toward tree responsibilities and no longer own the desktop search input.

- extract or disable the desktop search UI inside `FileTreePanel`
- keep tree rendering and tree actions in place

## Search Panel

Create a new `SearchPanel` component under the shared workspace view stack.

Responsibilities:

- own the content search input
- debounce queries
- call `file.searchContent`
- render grouped results
- call existing editor open/location helpers when a result is selected

This panel should not own file tree state.

## Source Control Panel

Wrap the current `GitPanel` inside the new sidebar shell with minimal changes.

Rename presentation text from generic `Git` tab wording toward `Source Control` where appropriate in desktop UI copy.

## Quick Open Overlay

Create a new overlay component parallel to `CommandPalette`.

Recommended structure:

- `QuickOpen`
  - reuses `WorkbenchLayer`
  - owns its own query state, keyboard navigation, and result list

Do not overload `CommandPalette` with file results and action results in one list for the first release.

## Shared Open File Behavior

Search result open and Quick Open open should both reuse existing file-open primitives so behavior stays consistent with:

- active file tracking
- editor mode selection
- open tabs state
- location targeting

Prefer reusing existing `useOpenLocation` and file-open actions rather than adding parallel open logic.

## State Model

Add separate UI state for:

- active desktop sidebar view
- Quick Open visibility

Do not overload the existing `sidebarTab` state because the previous `files / git` model no longer matches the new structure.

Recommended values:

- `explorer`
- `search`
- `source-control`

## Backend Architecture

## Keep `file.search`

Keep the current `file.search` command for filename and path search.

It already provides the right conceptual behavior for Quick Open and should remain lightweight.

The current command should no longer be used by Explorer search UI because that UI is being removed.

## Add `file.searchContent`

Add a new backend command dedicated to content search.

Command contract:

- input:
  - `workspaceId`
  - `query`
  - `maxFiles`
  - `maxMatchesPerFile`
- output:
  - grouped file match records containing file path and line matches

Recommended result shape:

- `files`
  - `path`
  - `name`
  - `matchCount`
  - `matches`
    - `line`
    - `columnStart`
    - `columnEnd`
    - `preview`

Exact field names can be adjusted during implementation, but grouped file-oriented results should be preserved.

The frontend should send explicit first-release caps:

- `maxFiles: 50`
- `maxMatchesPerFile: 20`

## Search Engine

Implementation uses `rg` when available.

Reasons:

- fast on large repositories
- naturally suited for workspace content search
- can return line numbers and preview text
- already respects `.gitignore` patterns well in common workflows

### Fallback

If `rg` is unavailable in the runtime environment, provide a Node fallback with tighter limits.

Fallback behavior should:

- skip binary files
- enforce maximum scanned file size
- enforce maximum result limits

The fallback is for compatibility, not parity on very large repositories.

## Ignore and Safety Rules

Content search must:

- stay within the active workspace root
- respect ignore behavior consistent with the existing workspace file visibility model as closely as practical
- skip binary files
- avoid unbounded memory growth on large files

Recommended additional protections:

- skip files above a size threshold such as `1MB` to `2MB` in the fallback scanner
- truncate preview snippets
- cap total matches

## Error Handling

## Search Panel Errors

If content search fails:

- keep the query in place
- show an inline error state with retry affordance
- do not collapse the Search panel

## Quick Open Errors

If filename search fails:

- show compact inline error row
- keep overlay open
- preserve the query so the user can retry or adjust input

## Empty States

Explorer empty states remain driven by existing file tree behavior.

Search needs dedicated empty states:

- no query entered
- searching
- no matches
- search failed

Quick Open needs dedicated overlay states:

- no query entered
- loading
- no files found
- search failed

## Accessibility and Keyboard Behavior

Desktop workbench navigation should remain keyboard reachable.

Required behaviors:

- Activity Bar items are focusable and announce active state
- Search input autofocuses when the Search view becomes active
- Quick Open autofocuses its input on open
- Quick Open result list is keyboard navigable
- selected Quick Open row is announced correctly

The first release does not need to replicate all VS Code keyboard shortcuts, only the core ones required by this design.

## Migration Strategy

## Step 1: Sidebar Structure

- introduce sidebar view state
- replace `文件 / Git` tab chrome with Activity Bar and dedicated panels
- move the existing Git panel into `Source Control`

## Step 2: Explorer Narrowing

- remove desktop file-tree search input
- wrap the file tree in Explorer sections
- add the first-release `Open Editors` section with activate-only behavior

## Step 3: Content Search

- add backend `file.searchContent`
- add frontend `SearchPanel`
- wire result click to open file at line

## Step 4: Quick Open

- add backend-backed file jump overlay on `Ctrl/Cmd+P`
- keep command palette on `Ctrl/Cmd+K`

This order reduces regression risk because each step preserves a working left sidebar while new capability is added incrementally.

## Testing

## Frontend Tests

Add or update tests for:

- Activity Bar view switching
- Explorer rendering without the old search field
- Search panel query lifecycle
- Search result click opens file at line
- Quick Open keyboard navigation and file open
- command palette shortcut remains on `Ctrl/Cmd+K`
- Quick Open shortcut opens independently on `Ctrl/Cmd+P`

## Backend Tests

Add tests for:

- `file.search` filename ranking remains stable
- `file.searchContent` grouped results and line metadata
- ignore handling
- binary file skipping
- result truncation
- fallback path when `rg` is unavailable if fallback is implemented

## Risks

1. `rg` availability may vary by user environment, so the fallback strategy must be decided early.
2. large repositories can make naive content search feel slow, so caps and debounce are required.
3. `Open Editors` can sprawl if it starts chasing full editor-tab parity. The first release must keep it activate-only with no close controls or badge system.
4. reusing existing file open primitives is important; parallel open logic would create subtle editor-state regressions.

## Open Questions Resolved

- Search scope: active workspace only
- Quick Open scope: active workspace only
- Sidebar direction: independent `Explorer / Search / Source Control` views, not a mixed single-panel design
- Search type: true content search in sidebar, filename/path search reserved for Quick Open

## Recommended Implementation Direction

Build this feature as a focused desktop workbench refactor rather than a one-off search feature.

The key product rule is:

- `Explorer` is for browsing
- `Search` is for contents
- `Source Control` is for Git
- `Quick Open` is for jumping

That boundary should remain explicit in both UI naming and code structure.
