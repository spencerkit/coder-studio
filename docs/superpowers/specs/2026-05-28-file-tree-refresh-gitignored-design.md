# File Tree Refresh Stability and Gitignored Styling Design

> Status: Draft
> Date: 2026-05-28
> Scope: `packages/web/src/features/workspace/*`, `packages/web/src/app/providers.tsx`, `packages/server/src/fs/*`, `packages/server/src/commands/file.ts`, `packages/core/src/domain/types.ts`

## Goal

Improve the workspace file tree in two specific ways:

- keep directory expansion and collapse state visually stable when filesystem changes trigger a tree refresh
- visually distinguish gitignored files and directories in the normal file tree by reducing label opacity

The file tree should continue to show fresh directory contents after edits, creates, deletes, and renames, but it should no longer flash through a collapse-and-reopen feeling for directories that were already expanded.

## Non-Goals

This design does not include:

- changing file search result rows to show gitignored styling
- hiding gitignored files or directories from the tree
- replacing the current lazy-loading tree model with a fully recursive tree fetch
- adding inline git status badges or other source-control metadata to the tree
- supporting full Git ignore semantics across nested `.gitignore`, `.git/info/exclude`, and global excludes in the first release
- redesigning tree layout, typography, or iconography beyond the new subdued state

## Problem

The current file tree keeps expansion state in `expandedDirs`, but refreshes still feel unstable during `fs.dirty` handling.

The root cause is structural:

- `file.readTree` is called again for the workspace root
- the client replaces the entire `fileTree` map with a new map containing only `"."`
- previously loaded child directory entries disappear temporarily
- expanded directories then trigger child reloads again because the expansion state still says they are open

This produces a visible flash where expanded directories appear to collapse and reopen even though the underlying expansion state was not actually cleared.

Separately, the tree currently provides no visual distinction for files or directories that are matched by the workspace `.gitignore`. Users can see ignored content in the tree, but cannot tell which entries are intentionally ignored by Git.

## User Decisions Captured

- The gitignored distinction applies only to the normal directory tree.
- Search result rows do not need gitignored styling in this change.
- Refreshing the tree is still required when filesystem changes occur.
- Expanded directories must stay expanded, and collapsed directories must stay collapsed, across refreshes.

## Approaches Considered

### Option A: Preserve loaded subtrees and refresh expanded directories in place (recommended)

Keep the existing lazy tree model and `expandedDirs` state, but change refresh behavior:

- refresh root entries without discarding already loaded descendant maps
- preserve loaded data for directories that remain expanded
- silently re-read currently expanded directories after the root refresh
- prune stale loaded and expanded state for paths that no longer exist

Advantages:

- minimal surface-area change
- fits the current `Map<parentPath, FileNode[]>` store shape
- directly targets the flash without redesigning the tree model

Disadvantages:

- refresh can trigger multiple `file.readTree` calls when many directories are expanded
- the client must explicitly prune stale descendant state

### Option B: Build a path-level diff and reconcile the entire tree graph

Replace the current refresh behavior with a more elaborate reconciliation algorithm that computes insertions, removals, and updates across the loaded tree.

Advantages:

- potentially more elegant long-term tree state model

Disadvantages:

- significantly more complex than the current need
- higher risk of introducing stale node or descendant mismatch bugs
- unnecessary for solving the reported UX problem

### Option C: Move all refresh stability to the server

Have the server emit richer incremental tree update payloads so the client no longer refetches root and child directories independently.

Advantages:

- could reduce duplicate reads and centralize tree reconciliation

Disadvantages:

- requires a broader protocol redesign
- much larger scope than the requested optimization

## Final Choice

Adopt Option A.

This keeps the current lazy directory tree contract intact while removing the visible refresh flash. It also allows gitignored styling to be added as a small protocol extension on `FileNode` instead of requiring a separate metadata channel.

## Final Design

### 1. Refresh Stability Model

The tree remains a lazy-loaded `Map<string, FileNode[]>` where:

- `"."` stores root entries
- a directory path such as `src` stores direct children of that directory

The refresh flow changes from full root replacement to staged in-place reconciliation.

#### 1.1 Root Refresh

When `fs.dirty` marks the tree stale and the panel reloads:

- request `file.readTree` for the workspace root as today
- replace only `treeMap.get(".")`
- do not discard other loaded directory entries immediately
- do not reset `loadedDirs`

This ensures that already-expanded directories keep their rendered child content while refresh work continues.

#### 1.2 Expanded Directory Revalidation

After the new root entries are stored:

- compute the set of currently expanded directory paths from `expandedDirs`
- intersect that set with directories that still exist in the refreshed tree
- for each remaining expanded directory, issue `file.readTree({ subPath })`
- update `treeMap.get(subPath)` in place as responses return

This keeps the visible subtree content fresh without forcing a visual reset of the directory row itself.

#### 1.3 Stale Path Pruning

After root refresh and during descendant refresh reconciliation:

- if a previously expanded directory no longer exists, remove it from `expandedDirs`
- remove nonexistent paths and their descendants from `loadedDirs`
- delete `treeMap` entries for removed directories and their descendants

This prevents stale descendant content from surviving after a delete or rename.

#### 1.4 Loading Semantics

The existing lazy-load behavior remains:

- expanding a directory that has never been loaded still triggers `file.readTree({ subPath })`
- collapsing a directory only changes expansion state and does not delete loaded child data

Refresh-specific descendant revalidation should be treated as background work. It should not force the row through a temporary closed-looking state.

### 2. Gitignored Metadata

Extend `FileNode` with:

- `isGitIgnored?: boolean`

This field is populated by `file.readTree` for both files and directories.

#### 2.1 First-Release Semantics

For this change, `isGitIgnored` is based on the workspace root `.gitignore` rules plus the existing always-hidden tree rules already applied elsewhere for `.git`.

Behavior:

- `.git` remains hidden as today and never appears in the tree
- entries matched by the workspace root `.gitignore` are still shown in the tree
- those shown entries receive `isGitIgnored: true`
- entries not matched by those rules receive `isGitIgnored: false`

This intentionally does not attempt full Git parity for nested `.gitignore` files or user-global excludes in the first release.

### 3. Server Responsibilities

#### 3.1 `readTree`

`packages/server/src/fs/tree.ts`

- continue returning direct children only
- continue including hidden files except `.git`
- determine `isGitIgnored` for each entry while building `FileNode`

Implementation direction:

- build or reuse a root-level ignore matcher once per `readTree` call
- compute each entry's relative path from workspace root
- test that relative path against the matcher
- assign `isGitIgnored` on both file and directory nodes

#### 3.2 Shared Ignore Helpers

`packages/server/src/fs/gitignore.ts`

Add a helper focused on metadata inspection rather than filtering, for example:

- creating a reusable matcher for root `.gitignore`
- testing whether a relative path is ignored

This avoids duplicating path normalization logic inside `tree.ts`.

### 4. Client Responsibilities

#### 4.1 File Tree Refresh Logic

`packages/web/src/features/workspace/actions/use-file-actions.ts`

Refactor root reload logic so it:

- merges the refreshed root children into the existing tree map
- preserves descendant map entries for currently loaded paths
- revalidates expanded directories after root refresh
- prunes removed directory state

The refresh algorithm should be driven by current `expandedDirs`, `loadedDirs`, and the refreshed root snapshot, not by UI remounts.

#### 4.2 Tree Rendering

`packages/web/src/features/workspace/views/shared/file-tree-panel.tsx`

The component keeps the existing expansion source of truth:

- expanded state comes from `expandedDirs`
- default auto-expand behavior for initial roots remains unchanged

Rendering changes:

- if a tree node has `isGitIgnored`, add a dedicated modifier class on the row or label
- apply the subdued style only in the normal tree row renderer
- do not apply the subdued style to `FileSearchResultRow`

### 5. Visual Treatment

Add a file-tree-specific subdued style in `packages/web/src/styles/components.css`.

Requirements:

- the distinction should be visible but not make names unreadable
- target the file name first
- optionally include the icon if it still reads cleanly with the current theme tokens
- selected rows must remain clearly selected even when gitignored

Recommended baseline:

- reduce label opacity modestly rather than aggressively
- keep hover and selected backgrounds unchanged

### 6. Testing Strategy

#### 6.1 Server Tests

Update `packages/server/src/__tests__/fs/tree.test.ts` to cover:

- ignored files are still present in tree results
- ignored directories are still present in tree results
- returned nodes include `isGitIgnored: true` when matched
- returned nodes include `isGitIgnored: false` when not matched

Add focused helper tests in `packages/server/src/__tests__/fs/gitignore.test.ts` for the new metadata matcher behavior.

#### 6.2 Client Tests

Update `packages/web/src/features/workspace/views/shared/file-tree-panel.test.tsx` and related file-tree action tests to cover:

- expanded directories remain rendered after a stale refresh
- root refresh preserves loaded descendants until replacement data arrives
- deleted or renamed expanded directories are pruned from persisted expansion state
- gitignored nodes render with the subdued class
- search result rows do not render with the subdued class

#### 6.3 Regression Focus

Pay special attention to:

- create file
- create folder
- rename file
- rename folder
- delete file
- delete folder
- external file content changes that emit `fs.dirty`

The success condition is that the tree content updates correctly without the previously expanded directories flashing through an apparent close-and-reopen cycle.

## Risks and Mitigations

### Risk: stale subtree data remains after path removal

Mitigation:

- explicitly prune descendant entries from `treeMap`, `loadedDirs`, and `expandedDirs`
- cover removal and rename cases in tests

### Risk: refresh issues too many child reads

Mitigation:

- only revalidate currently expanded directories
- keep the first release simple and measure behavior before optimizing further

### Risk: subdued styling harms readability or selected-state contrast

Mitigation:

- scope the opacity reduction to the name and possibly icon only
- keep selected row background and active state unchanged
- verify in existing theme tests if selector changes affect token expectations

## Open Tradeoff Chosen Explicitly

This design intentionally chooses pragmatic first-release gitignored semantics:

- show ignored entries
- mark them using the root `.gitignore`
- defer full Git parity

That tradeoff is acceptable because the user request is visual distinction, not Git-authoritative ignore introspection.
