# Open Editors Actions Design

## Goal

Bring the `Open Editors` section on desktop and mobile to feature parity with a shared interaction model for:

- expand and collapse
- file count display
- close current file from the list
- close all open files
- deterministic active-file switching when closing files

## Problem

The current `Open Editors` section is only a simple list of open file paths.

It is missing the controls that users expect from the desktop-style workspace model:

- no expand and collapse control
- no file count in the section header
- no per-file close action
- no close-all action
- no guaranteed rule for which file becomes active after closing from the list

The current editor-header close flow also clears the active file without selecting the next sensible editor target. That creates an inconsistent experience between the editor surface and the sidebar list.

## Desired Behavior

### Shared section structure

Desktop and mobile must render the same `Open Editors` control model.

- left side: expand/collapse button
- center/primary label: `Open Editors` title followed by file count
- right side: `Close all` action

Example structure:

- `打开的编辑器 (3)` or `Open Editors (3)` depending on locale

### List rows

Each open file row must contain:

- a selectable file target on the left
- a single-file close action on the right

The row label must stay on one line and truncate with ellipsis when space is limited. This applies to desktop and mobile.

### Close behavior

Closing a file must follow one shared rule everywhere the workspace closes open editors, including:

- the `Open Editors` list
- the existing editor header close button

Behavior:

1. Closing a non-active file removes it from `openFiles` and keeps the current editor selection unchanged.
2. Closing the active file selects the next open file if one exists later in the rendered order.
3. If the active file is the last item, closing it selects the previous open file if one exists.
4. If the last remaining open file is closed, the editor state is cleared and the main area returns from `editor` mode to the session/agent view.
5. `Close all` clears all open files, clears the active file, resets editor-only state that depends on an active file, and returns the main area to the session/agent view.

### Expand/collapse behavior

- expand/collapse only affects visibility of the list rows
- collapsing does not change the active file
- collapsing does not switch the main area away from the editor
- the section may remain visible when empty so the header actions stay discoverable, but the empty list body should not render row chrome

## Scope

This change covers the workspace UI in `packages/web`.

### In scope

- shared `Open Editors` layout and actions
- desktop explorer panel integration
- mobile explorer panel integration
- shared close behavior used by sidebar list and editor header
- file count display in the section title
- truncation and layout updates needed for the row/action chrome

### Out of scope

- changing how files are opened
- adding persistence for expanded/collapsed state across reloads
- reordering open editors
- changing search, quick jump, git, or file tree behavior beyond what is needed for shared layout consistency

## Architecture

### 1. Centralize close-open-editor decisions

Introduce a shared close helper in the workspace/editor action layer so all close entry points use the same logic.

The helper must accept:

- current `openFiles`
- current `activeFilePath`
- a target path or a `closeAll` intent

The helper must produce the next editor selection decision:

- which file to remove
- which file should become active next, if any
- whether the editor surface should exit back to the session/agent view

This keeps the behavior consistent between:

- editor header close button
- desktop `Open Editors` rows
- mobile `Open Editors` rows
- `Close all`

### 2. Expand the shared `OpenEditorsSection`

`OpenEditorsSection` should remain the shared rendering primitive used by both desktop and mobile explorer panels.

It should take responsibility for:

- rendering the header chrome
- showing the count next to the title
- managing section-local expand/collapse UI state
- wiring row click to open/select an editor
- wiring row close and close-all actions to shared close helpers

Desktop and mobile containers should continue to provide navigation-specific callbacks such as mobile detail routing where needed.

### 3. Preserve existing main-area mode derivation

The workspace already derives `mainAreaMode` from whether an active file exists.

This change should preserve that model instead of introducing a second visibility state for the editor:

- if a close action leaves another active file, `mainAreaMode` remains `editor`
- if a close action clears the final active file, `mainAreaMode` naturally falls back to `agent`

This keeps the “last file closes editor and returns to session” rule aligned with the existing screen model.

## File Boundaries

Primary files expected to change:

- `packages/web/src/features/workspace/views/shared/open-editors-section.tsx`
- `packages/web/src/features/code-editor/actions/use-code-editor-actions.ts`
- `packages/web/src/features/workspace/views/shared/explorer-panel.tsx`
- `packages/web/src/features/workspace/views/mobile/mobile-explorer-panel.tsx`

Likely supporting files:

- shared styling for `workspace-open-editors`
- tests covering desktop workspace behavior
- tests covering editor close behavior
- tests covering mobile explorer rendering

## Testing Strategy

1. Add or update editor-action tests for close sequencing:
   - closing a non-active file keeps the active file
   - closing the active file switches to the next file
   - closing the last active file with earlier files switches to the previous file
   - closing the final remaining file clears the editor selection
   - `Close all` clears all open files and active file
2. Add or update component tests for `OpenEditorsSection`:
   - header shows file count
   - expand/collapse toggles row visibility without changing selection
   - each row exposes a close button
   - long paths truncate instead of wrapping
3. Add or update integration coverage for desktop and mobile:
   - desktop explorer shows the new controls
   - mobile explorer shows the same controls
   - closing the last open file causes the workspace to render the session/agent surface instead of the editor

## Acceptance Criteria

- desktop and mobile both show `Open Editors` with expand/collapse, file count, and `Close all`
- each open file row shows a single-file close action on the right
- row labels do not wrap and truncate with ellipsis when needed
- closing a non-active file does not change the active editor
- closing the active file selects the next file when possible
- closing the active last item selects the previous file when possible
- closing the final remaining open file exits the editor and returns the main area to the session/agent view
- `Close all` exits the editor and returns the main area to the session/agent view
- editor-header close and sidebar-list close use the same selection rules
