# Unified Editor Surface Design

> Status: Draft
> Date: 2026-05-20
> Scope: `packages/web/src/features/code-editor/*`, `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx`, `packages/web/src/features/workspace/views/mobile/mobile-files-sheet.tsx`, `packages/web/src/features/workspace/actions/use-workspace-screen-model.ts`, `packages/web/src/features/workspace/actions/use-git-actions.ts`, `packages/web/src/features/workspace/atoms/*`, `packages/server/src/commands/git.ts`, `packages/server/src/git/diff.ts`, new image diff asset route or command surface

## Goal

Unify the current code viewer and git diff surfaces into a single editor shell with one persistent header and three explicit modes:

- `预览`
- `编辑`
- `Diff`

The user should stay inside the same editor region when switching modes. The product should stop treating file editing and diff inspection as two separate main-area pages.

## Problem

The current workspace UI splits file work across separate surfaces:

- [CodeEditorHost](/root/workspace/coder-studio/packages/web/src/features/code-editor/views/shared/code-editor-host.tsx:1) renders text editing and image preview
- [GitDiffViewer](/root/workspace/coder-studio/packages/web/src/features/workspace/views/shared/git-diff-viewer.tsx:1) renders raw patch output in a separate container
- [WorkspaceDesktopView](/root/workspace/coder-studio/packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx:1) switches the whole main area between `editor` and `diff`
- [useWorkspaceScreenModel](/root/workspace/coder-studio/packages/web/src/features/workspace/actions/use-workspace-screen-model.ts:1) models diff as a separate page mode rather than an editor mode

This creates four product problems:

- the header changes shape between file work and diff work
- `Diff` is not attached to the current open file
- view vs edit is implicit for text files and not represented as a first-class mode
- image preview already lives inside the editor chrome, but image diff does not

## Decision

Adopt a unified `EditorSurface` architecture now and keep the heavier tab/resource system as a future upgrade path.

This is the middle-ground option:

- not a small wrapper over the current split views
- not a full VS Code-style tab/resource rewrite yet

The first version should unify interaction semantics while keeping a single active resource model. A future upgrade can introduce tabbed editor resources without rewriting the shell again.

## Product Rules

### Primary Modes

The editor header exposes:

- `预览`
- `编辑`
- `Diff`

These are user-facing modes, not separate workspace pages.

### Current File Ownership

`Diff` always targets the current open file.

If there is no active file, `Diff` is disabled.

If the active file has no git change, `Diff` is disabled.

The git sidebar may still preview change status and allow staging actions, but it no longer owns the main editor surface for file diff viewing.

### Unsaved Changes

`Diff` is based on git state on disk, not the in-memory dirty buffer.

If the active file has unsaved changes:

- `Diff` still opens for the active file if git reports a saved-on-disk change
- the header shows a warning that unsaved edits are not included in the diff

This keeps behavior aligned with a source-control-first mental model while preserving a clear separation between edit mode and diff mode.

## Mode Availability Matrix

### Text Files

- `预览`: enabled, Monaco read-only
- `编辑`: enabled, Monaco editable
- `Diff`: enabled when git change exists for the current file

### SVG and Other Text-Backed Images

- `预览`: enabled, rendered image preview
- `编辑`: enabled, text editor mode
- `Diff`: enabled when git change exists for the current file

The existing text/image toggle for text-backed images remains useful, but its semantics move under the unified mode system:

- `预览` shows the rendered asset
- `编辑` shows the text source
- `Diff` shows text diff when git returns text

### Non-Text Images

- `预览`: enabled, rendered image preview
- `编辑`: disabled
- `Diff`: enabled when git change exists for the current file

For non-text images, `Diff` is not an editor. It is a comparison surface rendered inside the same editor shell.

## Diff Interpretation Rules

`Diff` follows this rule set:

1. Request diff for the current file.
2. If the diff is representable as text, render text diff.
3. Otherwise, render image diff for image types.

This rule is intentionally outcome-based:

- `text diff` if the backend provides a readable textual diff
- `image diff` if the backend does not provide text and the active file is an image type

For SVG in text mode, text diff remains the default because the underlying source is text and that is the higher-value review surface.

## Image Diff Behavior

For non-text images, `Diff` renders a vertical stacked comparison inside the unified editor body:

- top: base version
- bottom: current workspace version

This layout is chosen over side-by-side because it works better for tall screenshots, posters, and mobile capture assets.

### Image Diff States

#### Modified Image

- top: image from baseline revision
- bottom: current workspace image

#### Added Image

- top: empty state
- bottom: current workspace image

#### Deleted Image

- top: baseline image
- bottom: empty state

#### Unsupported Baseline

If the baseline asset cannot be loaded, the surface falls back to a clear non-fatal empty state explaining that visual diff is unavailable.

## UI Architecture

Introduce a new unified container, tentatively named `EditorSurface`.

### `EditorSurface`

Responsibilities:

- render the persistent header
- show file title, dirty indicator, unsupported-mode messaging, and unsaved-diff warning
- expose mode buttons and their disabled states
- own close behavior

This shell replaces the current split ownership between the code editor header and git diff header.

### `EditorSurfaceContent`

Responsibilities:

- render the active mode content
- choose among text preview, text edit, text diff, image preview, and image diff

Expected renderers:

- `TextPreviewRenderer`
- `TextEditRenderer`
- `TextDiffRenderer`
- `ImagePreviewRenderer`
- `ImageDiffRenderer`

The implementation does not need to create all of these as separate files immediately, but the boundary should be preserved conceptually.

### Mode-Specific Rendering

- `预览` + text -> Monaco read-only
- `编辑` + text -> Monaco editable
- `Diff` + text -> Monaco diff editor
- `预览` + image -> current image preview
- `Diff` + non-text image -> stacked image comparison

## State Model

The current state model mixes file selection and diff preview selection. The unified design should separate these concerns.

### New Primary UI State

Add workspace-scoped editor mode state:

- `preview`
- `edit`
- `diff`

This should live alongside active file state, not inside git panel state.

### File Identity

Keep `activeFilePath` as the single source of truth for the currently open file in v1.

Do not move to a multi-tab resource model yet.

### Diff Availability

Track derived capabilities for the active file:

- file kind
- can preview
- can edit
- can diff
- diff kind: `text` or `image`

This should be derived close to the editor state layer, not scattered between workspace page and git panel.

### Diff Data

The existing `gitDiffPreviewAtomFamily` should stop driving top-level page routing.

It can be repurposed into:

- cached diff payload for the active file
- resolved diff metadata
- loading and error state

The important change is conceptual: diff data becomes editor content state, not workspace navigation state.

## Desktop Behavior

The desktop main area should stop switching between `agent`, `editor`, and `diff`.

Instead:

- no active file -> agent panes remain visible
- active file -> unified editor surface appears
- mode changes happen inside the editor surface

This keeps the high-level workspace layout stable while removing the editor/diff split.

The git panel still controls git actions, staging, and history, but opening a changed file should focus that file and switch the editor mode to `diff` instead of replacing the main area with a dedicated diff page.

## Mobile Behavior

Mobile should follow the same semantic model.

The files sheet currently routes between root, editor, and diff. That route model should collapse into:

- root list state
- active file detail state with `preview | edit | diff`

The sheet header action area should read from unified editor mode state instead of special-casing editor vs diff pages.

This preserves alignment between desktop and mobile and avoids another layer of mode translation.

## Monaco Integration

The current [MonacoHost](/root/workspace/coder-studio/packages/web/src/features/code-editor/components/monaco-host.tsx:1) already supports editable text mode. It should be extended rather than replaced.

Changes needed:

- support explicit read-only mode for `预览`
- keep current editable mode for `编辑`
- add a dedicated diff host for textual diff rendering

This can be done with:

- extending `MonacoHost` for read-only support
- adding a sibling diff host instead of forcing diff behavior into the same component instance

That keeps text editing and diff composition from becoming tangled.

## Server Changes

The current git surface only returns textual patch output:

- [git.diff command](/root/workspace/coder-studio/packages/server/src/commands/git.ts:1)
- [getFileDiff](/root/workspace/coder-studio/packages/server/src/git/diff.ts:1)

That is insufficient for stacked image comparison because the client can only preview the current workspace asset, not the baseline git revision asset.

### Required Backend Capability

Add a way to load image assets from a baseline git revision, initially `HEAD`.

Possible shapes:

- extend the image asset route to support `revision`
- add a dedicated git image asset route
- add a command that returns signed or safe asset URLs for `before` and `after`

The implementation detail is flexible. The product requirement is not:

- the client must be able to fetch the current workspace image
- the client must be able to fetch the baseline image for the same relative path

### Suggested Metadata Payload

For image diff, the client needs:

- file status: modified / added / deleted
- current image URL when available
- baseline image URL when available
- mime type

The text diff payload can continue to use the existing textual diff command surface.

## Migration Plan

### Phase 1: Unified Mode State

- add workspace-scoped editor mode atom
- default text files to `编辑`
- default images to `预览`
- remove top-level diff page routing from workspace main area

### Phase 2: Unified Header

- create `EditorSurface`
- move current close, save, and file title behavior into it
- rename the user-facing view action to `预览`

### Phase 3: Text Diff Integration

- move current diff action to target the active file only
- replace raw patch list rendering with Monaco diff editor for textual diffs
- surface unsaved-change warning in header

### Phase 4: Image Diff Integration

- add baseline image asset loading
- render stacked image diff for non-text images
- add add/delete image empty states

### Phase 5: Mobile Alignment

- collapse mobile editor/diff route split into unified file detail mode state
- reuse the same mode button semantics as desktop

## Future Upgrade Path to Resource Tabs

This design intentionally leaves a clean path to a later tab/resource system.

Future `C` work should replace:

- single `activeFilePath`

with:

- active editor resource
- resource list or tabs

The key preservation points are:

- `EditorSurface` remains valid
- renderer selection remains valid
- mode semantics remain valid

The main upgrade cost later should be in resource management and tab history, not in rewriting preview/edit/diff behavior.

## Testing Strategy

### Unit Tests

Add or update tests for:

- mode availability by file type
- active-file-only diff enablement
- unsaved-change warning behavior
- SVG mode transitions
- image diff state resolution for modified, added, and deleted assets

### Integration Tests

Update desktop and mobile workspace tests to cover:

- switching between `预览`, `编辑`, and `Diff`
- preserving one editor shell while content changes
- opening a git-changed file into `Diff`
- falling back correctly between text diff and image diff

### Server Tests

Add tests for:

- baseline image asset fetch safety
- revision path validation
- added and deleted asset behavior

## Risks

### Mixing Resource Type and Mode

If file type checks are spread across multiple components, the unified model will become fragile. Mode and resource kind must stay separate.

### Over-Coupling Diff to Git Panel

If the git panel continues to own diff navigation, the architecture will remain half-split. The active file should own the diff target.

### Image Diff Asset Fetching

Revision-based asset loading adds a new server surface and must preserve the same path safety guarantees as the current image route.

## Out of Scope

This design does not include:

- multi-tab editor resources
- arbitrary file-to-file comparison
- visual pixel-diff overlays
- editable diff mode for the git review surface
- commit-history image diff beyond the current-file baseline requirement

## Summary

The unified editor surface should turn preview, edit, and diff into three modes of one shell instead of three separate pages.

Text files and SVG source use Monaco-based preview, edit, and text diff.

Non-text images use preview plus a stacked image diff when textual diff is not available.

This gives the product a cleaner and more extensible editor model now while keeping the later move to a full resource-tab architecture manageable.
