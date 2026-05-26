# Git History Commit File Diff Design

> Date: 2026-05-26
> Status: Approved for planning
> Scope: History commit file-list preview, per-file diff, and image diff hardening

## 1. Goal

Enhance the existing Git history surface so a user can click a historical commit, see the files changed by that commit, and then open a per-file diff from that list inside the same editor surface already used for normal file and diff review.

This design also fixes a current image-diff weakness: when one side of the diff does not exist or the image asset cannot be loaded, the UI currently degrades into a broken image instead of a clear empty or error state.

The result should make history review feel like an extension of the current editor workflow rather than a separate patch viewer.

## 2. Current State

Today the repo already has partial building blocks:

- `git.log` returns recent history entries for the Git panel
- clicking a history row triggers `git.show`
- `git.show` returns a raw unified patch for the whole commit
- worktree file diffs already use structured payloads that can render in the shared editor surface
- image diffs already have a dedicated `ImageDiffPreview`, but it only handles the "URL missing" case well

This leaves three product gaps:

1. History review opens a whole-commit patch immediately instead of a changed-file list
2. History review cannot open structured per-file diffs through the shared editor pipeline
3. Image diff panes do not distinguish "no image on this side" from "image failed to load"

## 3. In Scope

- Clicking a history commit opens a commit-scoped changed-file list in the main preview/editor area
- Clicking a file inside that list opens a per-file diff for that historical commit
- Historical file diff rendering reuses the existing shared editor surface
- Text commit diffs render through the existing Monaco diff flow
- Image commit diffs render through the existing image diff flow
- Image diff panes show explicit empty/error states instead of broken images
- Server APIs and types needed to support structured historical commit review
- Regression coverage for desktop and mobile history review behavior

## 4. Out of Scope

This design does not include:

- commit search, filtering, or pagination beyond the existing history limit model
- a side-by-side whole-commit patch viewer
- inline comments or review annotations
- blame, author drill-down, or parent/merge graph navigation
- arbitrary Git revision browsing outside recent commit history
- opening arbitrary non-image file bytes through `/api/file`
- free-form revision selectors such as `HEAD~1`, branch names, or object expressions on the file asset route

## 5. Design Constraints

- Reuse the existing editor shell and avoid adding a second runtime diff UI
- Avoid parsing raw patch text in the client for file list extraction
- Preserve current worktree diff behavior
- Preserve desktop and mobile "unified detail view" behavior already built around `gitDiffPreview`
- Keep image asset loading scoped and safe; do not turn `/api/file` into a general Git object browser
- Avoid regressions for commit previews that remain reachable without an active file

## 6. Approaches Considered

### 6.1 Structured Commit Detail + Structured Commit File Diff (Recommended)

Add a commit-detail API that returns metadata plus changed files, and a commit-file-diff API that returns structured data matching the existing editor diff model.

Advantages:

- clean server/client contract
- no fragile patch parsing in the browser
- easy reuse of existing Monaco and image diff rendering
- rename handling can be explicit
- supports future extension without redesign

Tradeoff:

- requires new server commands, type additions, and editor-state expansion

### 6.2 Structured Commit Detail + Raw Patch File Diff

Return file lists structurally, but still return raw patch text for file diffs.

Advantages:

- slightly smaller server change

Tradeoff:

- text diff can work, but image/history parity with existing editor diff cannot
- likely creates follow-up rework

### 6.3 Raw Patch Parsing in the Client

Keep `git.show` and parse file sections in the web client.

Advantages:

- minimal server work

Tradeoff:

- brittle for rename, binary diffs, patch headers, and future maintenance
- duplicates Git parsing logic in the wrong layer

### 6.4 Final Choice

Use approach 6.1.

The design should add explicit structured history-review APIs and route both worktree and commit diffs through the same editor experience.

## 7. User Experience

### 7.1 History Commit Entry

When the user clicks a commit in the Git history section:

- do not open the whole raw patch
- open a commit-scoped changed-file list in the main preview area
- show a header title based on `shortSha + subject`

This preview becomes the root state for that commit review session.

### 7.2 Commit File List

The commit file list should show one row per changed file with:

- filename
- parent directory
- status badge or semantic icon
- optional rename source path when relevant

Expected statuses:

- `added`
- `modified`
- `deleted`
- `renamed`

The list exists inside the same main editor/detail surface used elsewhere in the workspace, not inside the left Git sidebar.

### 7.3 Commit File Diff Navigation

When the user clicks a file in the commit file list:

- switch the right-side detail surface from `commit-file-list` to `commit-file-diff`
- render text diffs with the existing Monaco diff path
- render image diffs with the existing image diff path

When the user closes a `commit-file-diff` preview:

- return to the parent `commit-file-list`

When the user closes the `commit-file-list` preview:

- clear the history preview entirely

This backstep behavior is required so history review feels navigable rather than disposable.

### 7.4 Worktree Diff Parity

Worktree file diffs should keep their current behavior, but share the same rendering path as historical commit file diffs. The editor surface should not need to care whether a diff came from the worktree or a historical commit beyond the preview kind and data source.

## 8. State Model

### 8.1 Single Preview Entry Point

Keep `gitDiffPreview` as the single preview entry point for Git-related detail content.

Do not create a second history-only preview atom or panel state model.

### 8.2 Preview Kinds

Expand the preview state into a discriminated union with explicit kinds:

- `worktree-file-diff`
- `commit-file-list`
- `commit-file-diff`

Representative shape:

```ts
type GitDiffPreview =
  | WorktreeFileDiffPreview
  | CommitFileListPreview
  | CommitFileDiffPreview;
```

`worktree-file-diff` keeps the existing current-file diff semantics.

`commit-file-list` contains:

- commit identity (`sha`, `shortSha`, `subject`)
- title for the editor header
- changed files array

`commit-file-diff` contains:

- commit identity
- parent commit identity if needed by image/history resolution
- file identity (`path`, `oldPath?`)
- structured diff payload for the editor renderer
- enough backlink context to return to the parent file list on close

### 8.3 Editor Mode Interaction

Do not expand `editorMode` into history-specific modes.

The commit file list is not a Monaco mode; it is just another content branch rendered inside the existing editor shell.

The editor surface should branch on preview kind:

- file editor / preview behavior for normal files
- diff behavior for worktree file diffs
- list behavior for `commit-file-list`
- diff behavior for `commit-file-diff`

## 9. Server Design

### 9.1 New Command: `git.commitDetail`

Input:

- `workspaceId`
- `sha`

Output:

- `commit`
  - `sha`
  - `shortSha`
  - `subject`
  - `authorName`
  - `authoredAt`
  - `parentSha?`
- `files[]`
  - `path`
  - `oldPath?`
  - `status`
  - `renderAs`

Purpose:

- provide the changed-file list for a historical commit
- avoid browser-side patch parsing

Implementation should derive this data directly from Git in the server layer.

### 9.2 New Command: `git.commitFileDiff`

Input:

- `workspaceId`
- `sha`
- `path`
- `oldPath?`

Output should align with the existing `git.diff` payload model as much as possible:

- `renderAs`
- `status`
- `diff`
- `originalContent?`
- `modifiedContent?`
- `originalRevision?`
- `modifiedRevision?`
- `originalPath?`
- `modifiedPath?`

Text files should provide `originalContent` and `modifiedContent` so Monaco can render the diff directly.

Image files should provide enough revision/path metadata for the existing image diff component to build the correct `beforeUrl` and `afterUrl`.

### 9.3 Rename Handling

Rename support must be explicit.

The file list should display the current path and preserve `oldPath` for context. The diff command should compare:

- old path at the parent revision
- new path at the selected commit revision

This avoids history diff failures caused by assuming the same path exists on both sides.

## 10. File Asset Revision Model

### 10.1 Current Limitation

`/api/file` currently accepts `HEAD` and `INDEX` image revisions only. That is enough for worktree image diff, but not enough for historical commit image diff.

### 10.2 Required Expansion

Extend the image asset route to accept a restricted commit SHA selector in addition to `HEAD` and `INDEX`.

Allowed revisions after this change:

- `HEAD`
- `INDEX`
- full or short commit SHA that passes the same strict revision validation used by Git commands

Explicitly do not allow:

- `HEAD~1`
- branch names
- tags
- free-form object expressions
- arbitrary `rev:path` input

This keeps the route narrow and predictable while still enabling historical image diff rendering.

### 10.3 Historical Image Diff Resolution

For historical image diffs:

- base image should resolve from `oldPath or path` at `parentSha`
- current image should resolve from `path` at `sha`

For an added image:

- base side should be absent
- current side should point at `path + sha`

For a deleted image:

- base side should point at `oldPath or path + parentSha`
- current side should be absent

## 11. Image Diff Hardening

### 11.1 Current Problem

`ImageDiffPreview` currently handles a missing URL by rendering a simple empty state, but a URL that resolves to an error still results in a broken image element. This is especially visible when one side of a historical or worktree image diff no longer exists.

### 11.2 Required Behavior

Each image diff pane should manage three distinct states:

1. `empty`
   - no URL should exist for this side
2. `loaded`
   - image loaded successfully
3. `error`
   - URL exists but the image could not be loaded

### 11.3 Pane Messaging

Expected pane copy:

- added image, base side missing: `No base image`
- deleted image, current side missing: `No current image`
- URL present but failed to load: `Preview unavailable`

The failure copy can share the same visual treatment already used by `ImagePreview`.

### 11.4 Styling

Keep the current image-diff panel layout and visual framing, but ensure empty and error states fill the pane cleanly instead of exposing browser-native broken image UI.

This is a correctness and polish fix, not a layout redesign.

## 12. Frontend Rendering Plan

### 12.1 Shared Editor Surface

The main runtime path should move fully onto the shared editor surface used by `CodeEditorHost` and `EditorSurface`.

Historical commit review should not depend on the legacy raw patch viewer for the main application flow.

### 12.2 Commit File List Renderer

Add a commit-file-list content renderer inside the shared editor surface. It should reuse existing row semantics where practical:

- path splitting logic
- semantic icons
- keyboard-accessible row buttons

### 12.3 Legacy Raw Patch Viewer

`GitDiffViewer` should no longer be the primary runtime path for commit history review.

After the new flow lands:

- either keep it only for UI preview scenes
- or remove it once no runtime path depends on it

The important constraint is avoiding two parallel runtime diff experiences.

## 13. Testing Strategy

### 13.1 Server Coverage

Add tests for:

- `git.commitDetail` returning file lists and commit metadata
- `git.commitDetail` including rename information
- `git.commitFileDiff` returning text diff content
- `git.commitFileDiff` returning image diff metadata
- `/api/file` allowing restricted commit SHA revisions
- `/api/file` rejecting invalid revision selectors

### 13.2 Frontend Coverage

Add tests for:

- clicking a history commit opens a commit file list
- clicking a file opens a commit file diff
- closing a commit file diff returns to the parent commit file list
- closing a commit file list clears the preview
- commit previews remain reachable without an active file
- mobile detail views continue to route history previews through the same unified surface

### 13.3 Image Diff Coverage

Add tests for:

- added image shows `No base image`
- deleted image shows `No current image`
- load failure shows `Preview unavailable`
- no broken-image fallback leaks into the rendered UI state

## 14. Risks and Mitigations

### Risk 1: Preview state becomes harder to reason about

Mitigation:

- use an explicit discriminated union for `gitDiffPreview`
- keep one preview entry point instead of multiple partially overlapping atoms

### Risk 2: Historical image diff broadens file-route attack surface

Mitigation:

- accept only image paths
- allow only `HEAD`, `INDEX`, or strict commit SHA revisions
- reuse existing workspace path safety checks

### Risk 3: Runtime diff UI forks between old and new viewers

Mitigation:

- route the new feature through the shared editor surface only
- shrink `GitDiffViewer` to non-runtime usage or remove it after migration

### Risk 4: Rename handling fails for historical paths

Mitigation:

- include `oldPath` in commit detail results
- compare parent revision old path against commit revision new path explicitly

## 15. Implementation Order

Recommended implementation sequence:

1. extend core Git preview types for commit file list/diff states
2. add server Git helpers plus `git.commitDetail`
3. add `git.commitFileDiff`
4. extend `/api/file` to accept restricted commit SHA image revisions
5. add frontend commit-file-list preview rendering
6. route commit-file-diff through the shared editor surface
7. harden image diff pane empty/error states
8. retire or reduce the runtime role of `GitDiffViewer`
9. run focused and regression tests

This order keeps the data contract in place before the UI depends on it.

## 16. Verification Expectations

Before implementation is considered complete, verification should include:

- focused server tests for Git commands and file asset revisions
- focused web tests for Git panel, editor surface, and image diff behavior
- lint on touched files
- relevant full test suites for server and web layers if the targeted tests pass

## 17. Summary

This design replaces the current whole-commit raw patch jump with a structured, editor-native history review flow:

- click commit
- inspect changed files
- open a file diff in the existing editor surface

It also hardens image diff behavior so missing or failed image sides produce explicit UI states rather than broken images.

The core decision is to keep one Git preview system and make history review a first-class extension of it, not a separate viewer.
