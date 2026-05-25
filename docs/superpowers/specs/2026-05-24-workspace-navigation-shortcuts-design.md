# Workspace Navigation Shortcuts Design

## Goal

Add keyboard navigation shortcuts for desktop workspace navigation so users can:

- switch between adjacent agent sessions inside the current workspace with `Ctrl+Arrow`
- switch between workspace tabs with `Ctrl+Shift+ArrowLeft/ArrowRight`

The feature should fit the existing shortcut customization model instead of becoming a one-off global listener.

## Problem

The current desktop workspace has no direct keyboard path for moving between split agent sessions or moving between workspace tabs with directional intent.

Relevant existing behavior already exists in pieces:

- workspace tabs already support keyboard movement when the tablist itself is focused
- session cards already persist active-session and last-viewed-target state when clicked
- the app already has a shortcut registry and settings UI for user-visible bindings

What is missing is a global, workspace-scoped navigation layer that:

- works without first focusing the topbar tablist
- understands the session pane layout instead of using an arbitrary list order
- persists navigation through the same state channels as pointer interaction

## Desired Behavior

### Shortcut bindings

Desktop runtime bindings:

- `Ctrl+ArrowLeft`: move to the session pane immediately to the left
- `Ctrl+ArrowRight`: move to the session pane immediately to the right
- `Ctrl+ArrowUp`: move to the session pane immediately above
- `Ctrl+ArrowDown`: move to the session pane immediately below
- `Ctrl+Shift+ArrowLeft`: select previous workspace tab
- `Ctrl+Shift+ArrowRight`: select next workspace tab

No action is bound for `Ctrl+Shift+ArrowUp` or `Ctrl+Shift+ArrowDown`.

Platform note:

- this feature is `best effort` on macOS
- if the OS consumes `Ctrl+Arrow` before the browser receives it, the app does nothing
- no macOS-specific remapping is introduced in this change

### Session navigation semantics

Session navigation uses spatial movement, not list order.

- the current origin is `workspace.uiState.activeSessionId`
- only real session panes are valid destinations
- draft panes are ignored
- if no pane exists in the requested direction, nothing changes

Example:

- in a left-right split, `Ctrl+ArrowUp` and `Ctrl+ArrowDown` do nothing
- in a 2x2 layout, movement follows the visible geometry, not creation order

### Workspace navigation semantics

Workspace navigation uses the existing workspace tab order.

- `Ctrl+Shift+ArrowLeft` selects the previous workspace in `workspaceOrder`
- `Ctrl+Shift+ArrowRight` selects the next workspace in `workspaceOrder`
- if there is no previous or next workspace, nothing changes

This change does not introduce wrap-around behavior.

### State persistence

When session navigation succeeds, the app must update both:

- `workspace.uiState.activeSessionId`
- `workspace.lastViewedTarget` with the same `workspaceId` and `sessionId`

When workspace navigation succeeds, the app must use the existing workspace-target selection path so the active workspace and persisted last-viewed target remain aligned with current topbar behavior.

### Focus and interception model

These shortcuts are intentionally global within the desktop workspace page.

- if the browser delivers the event to the page, the shortcut handler may intercept it even when focus is inside xterm or Monaco
- this is an explicit tradeoff for fast workspace navigation
- the feature does not attempt to preserve terminal or editor semantics for these exact key combinations

## Scope

### In scope

- desktop workspace runtime shortcut handling
- shortcut registry entries and settings visibility
- spatial session navigation derived from the pane layout tree
- workspace tab switching through existing selection actions
- unit and integration coverage for navigation behavior

### Out of scope

- mobile-specific keyboard navigation behavior
- macOS-specific fallback bindings
- wrap-around navigation
- navigating into draft panes
- broader shortcut-system refactors outside what is needed for these bindings

## Approaches Considered

### 1. Ad hoc global listeners

Add a new `window.keydown` handler directly in the desktop workspace view and hardcode the bindings there.

Pros:

- minimal code movement
- fastest initial implementation

Cons:

- bypasses the shortcut registry and settings UI
- creates another disconnected shortcut path
- makes customization and later maintenance worse

### 2. Extend the existing shortcut system

Add navigation actions to the shortcut registry, teach shortcut parsing/matching to handle explicit `Ctrl` and arrow keys, and bind runtime handling through a workspace-scoped navigation hook.

Pros:

- consistent with current settings and customization model
- keeps bindings user-visible
- creates one reusable runtime path for navigation actions

Cons:

- requires some shortcut-lib cleanup because current matching logic assumes mostly `Mod+letter` bindings

### 3. Full shortcut unification refactor

Refactor all existing keyboard listeners across workspace features behind one shared dispatcher before adding the new bindings.

Pros:

- cleanest long-term structure

Cons:

- far too broad for the current feature
- adds risk unrelated to navigation

## Recommendation

Use approach 2.

It preserves the current product direction:

- shortcuts remain visible in settings
- bindings can be customized later through the same storage model
- navigation behavior is implemented once using the same state transitions already used by pointer interactions

## Architecture

### 1. Extend shortcut definitions and matching

Update `packages/web/src/lib/shortcuts.ts` to support this feature as a first-class registry change.

Add shortcut definitions for:

- `session.navigate.left`
- `session.navigate.right`
- `session.navigate.up`
- `session.navigate.down`
- existing `workspace.previous`
- existing `workspace.next`

Default bindings:

- `Ctrl+ArrowLeft`
- `Ctrl+ArrowRight`
- `Ctrl+ArrowUp`
- `Ctrl+ArrowDown`
- `Ctrl+Shift+ArrowLeft`
- `Ctrl+Shift+ArrowRight`

The shortcut utility layer must be extended so it can:

- parse explicit modifiers beyond `Mod`
- distinguish `Ctrl` from `Mod`
- reject extra modifiers so `Ctrl+Shift+ArrowRight` does not also match `Ctrl+ArrowRight`
- correctly match arrow keys
- format arrow bindings for the settings UI
- preserve explicit `Ctrl+Arrow*` bindings when the settings UI records a shortcut while keeping existing `Mod+letter` behavior intact

This is a targeted extension, not a full keyboard abstraction rewrite.

### 2. Add a desktop workspace navigation hook

Introduce a dedicated hook in the workspace feature layer, for example:

- `packages/web/src/features/workspace/actions/use-workspace-navigation-shortcuts.ts`

Responsibilities:

- attach and detach one desktop workspace `keydown` listener
- resolve effective bindings from the shortcut registry and custom settings
- dispatch session-navigation or workspace-navigation actions
- call `preventDefault()` only when a configured binding matches

`WorkspaceDesktopView` should own mounting this hook because the behavior is page-scoped and desktop-specific.

### 3. Derive spatial neighbors from the pane layout

Session navigation must not use session creation order.

Instead, compute navigable pane geometry from the active workspace pane tree:

- walk the pane layout tree already used by agent panes
- treat each split as dividing a normalized rectangle
- assign each leaf pane a rectangle
- keep only leaves with a real `sessionId`

Then resolve directional targets from the active session leaf:

- left candidates must sit fully or partially to the left of the current pane
- right candidates must sit fully or partially to the right
- up candidates must sit above
- down candidates must sit below

Selection rule:

- prefer candidates that overlap on the perpendicular axis
- among those, pick the nearest candidate by edge distance
- if multiple candidates remain tied, use the smallest center-distance delta on the perpendicular axis

This keeps navigation intuitive for nested split layouts without needing live DOM measurement.

### 4. Reuse existing activation and persistence paths

When a target session is found:

- persist `workspace.lastViewedTarget` through the existing persistence helper
- persist `activeSessionId` through the existing workspace UI-state persistence helper

When a target workspace is found:

- use the existing workspace target selection action rather than duplicating topbar logic

This avoids creating a second state transition path for the same product behavior.

## File Boundaries

Primary files expected to change:

- `packages/web/src/lib/shortcuts.ts`
- `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx`
- new workspace shortcut hook under `packages/web/src/features/workspace/actions/`
- new pane-neighbor helper under `packages/web/src/features/agent-panes/` or `packages/web/src/features/workspace/actions/`

Likely supporting files:

- shortcut settings tests
- workspace desktop tests
- pane-layout navigation tests

Current state holders and actions to reuse:

- `packages/web/src/features/agent-panes/views/shared/session-card.tsx`
- `packages/web/src/features/workspace/actions/use-persist-workspace-last-viewed-target.ts`
- `packages/web/src/features/workspace/actions/use-select-workspace-target.ts`

## Testing Strategy

### Shortcut utility coverage

Add tests for:

- parsing explicit `Ctrl+Arrow*` bindings
- matching `Ctrl+Arrow*` and `Ctrl+Shift+Arrow*`
- formatting arrow-key bindings for settings display

### Session navigation coverage

Add focused tests for the spatial-neighbor helper:

- simple left-right split
- simple top-bottom split
- nested 2x2 split
- no-op when no candidate exists in the requested direction
- ignoring draft leaves
- deterministic tie-breaking when multiple candidates exist

### Workspace runtime coverage

Add desktop workspace integration tests for:

- `Ctrl+Arrow*` updating the active session when a neighbor exists
- `Ctrl+Arrow*` doing nothing at boundaries
- `Ctrl+Shift+ArrowLeft/ArrowRight` switching active workspaces
- session navigation persisting `workspace.lastViewedTarget`
- workspace navigation using the existing workspace-target path

### Settings coverage

Add settings tests verifying that:

- the new shortcuts appear in the shortcuts list
- default bindings render as expected

## Acceptance Criteria

- desktop users can move between adjacent session panes with `Ctrl+Arrow`
- navigation follows pane geometry, not session list order
- navigation never targets draft panes
- requesting a missing direction leaves the current session unchanged
- desktop users can move between previous and next workspaces with `Ctrl+Shift+ArrowLeft/ArrowRight`
- workspace navigation does not wrap
- successful session navigation updates both `activeSessionId` and `workspace.lastViewedTarget`
- the new bindings are represented in the shared shortcut registry and visible in settings
- the implementation remains `best effort` on macOS with no platform-specific remapping in this change
