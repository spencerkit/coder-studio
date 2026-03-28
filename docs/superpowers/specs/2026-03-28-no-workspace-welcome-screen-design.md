# No-Workspace Welcome Screen Design

## Goal

Improve the startup experience when there is no open workspace.

Today the app immediately opens the workspace launch overlay when no workspace exists. This creates a hard interruption before the user has any stable landing state. The new behavior should give the user a lightweight default home, while preserving the existing workspace launch flow.

## Decision

Adopt a lightweight welcome screen as the default empty state.

- If there is no open workspace, the app lands on a welcome screen instead of auto-opening the launch overlay.
- The existing workspace launch overlay remains the way to create or attach a workspace, but it becomes user-triggered.
- The workspace launch overlay must become dismissible.
- The history drawer remains available from the empty state so archived sessions can be restored without first creating a workspace.

This is intentionally smaller than a full home dashboard. It avoids introducing a new route or a second onboarding system.

## User Experience

### Empty startup state

When bootstrap completes and there are no open workspaces:

- show the top bar
- do not auto-open the workspace launch overlay
- render a centered welcome screen in the workspace content area

The welcome screen should present:

- a title focused on the Claude workflow
- one short description line
- a primary action to open the workspace picker
- a secondary action to open session history
- a low-emphasis action to open settings

Recommended copy direction:

- title: "Start a Claude workspace"
- body: "Open a local repository, connect a remote repo, or restore a previous Claude session."

### Launch overlay behavior

The workspace launch overlay should still open from:

- the top-bar add-workspace button
- the welcome screen primary action

The overlay must gain:

- a close button in the header
- `Esc` to close
- backdrop click to close

Closing the overlay returns the user to the welcome screen when no workspace exists.

### History behavior

From the welcome screen, the user can open the history drawer directly.

- If history exists, the drawer opens normally.
- If history is empty, the action may be hidden or disabled.

This preserves the new archive-and-restore workflow without forcing a new workspace first.

## State And Data Flow

### Workbench state normalization

Current normalization opens the overlay by default when there is no meaningful workspace history. That behavior should be removed.

Required change:

- `normalizeWorkbenchState` should no longer force `overlay.visible = true` for the empty state
- empty state should default to `overlay.visible = false`

### View state

Introduce a derived UI condition in `WorkspaceScreen`:

- welcome screen visible when `bootstrapReady` is true, `state.tabs.length === 0`, and `state.overlay.visible === false`

The workspace shell should be considered ready when either:

- there is at least one workspace tab
- the launch overlay is visible
- the welcome screen is visible

This prevents a blank screen while bootstrap is already complete.

### Runtime validation

Runtime validation should continue to happen only when the user actually begins workspace launch.

The welcome screen itself must not trigger runtime validation.

## Component Changes

### New welcome screen component

Add a small empty-state component, likely under workspace or components:

- receives translator and action callbacks
- visually simple, no new page route
- should match current flat, compact product styling

Suggested actions:

- `onOpenWorkspacePicker`
- `onOpenHistory`
- `onOpenSettings`

### Workspace launch overlay

Add:

- `onClose`
- top-right close affordance
- optional backdrop click close behavior

The component should remain otherwise unchanged to minimize risk.

### Top bar

When there are no workspace tabs:

- keep the top bar visible
- do not render an empty tab strip that implies a missing selected tab
- retain useful global actions such as settings and quick actions
- keep history entry available if desired by product styling

The add-workspace entry should remain a valid way to open the launch overlay.

## Error Handling

- If history loading fails, the empty state still renders and the user can open a workspace normally.
- If runtime validation fails after the user opens the picker, existing runtime validation overlay behavior remains unchanged.
- If the user closes the launch overlay after a runtime validation pass, they return to the welcome screen and can retry later.

## Testing

Add or update tests for:

1. no-workspace bootstrap shows welcome screen instead of auto-opening the launch overlay
2. clicking welcome-screen primary action opens the launch overlay
3. launch overlay close button hides the overlay and returns to welcome screen
4. closing the last workspace returns to the welcome screen
5. welcome-screen history action opens the history drawer
6. runtime validation still occurs only after user-initiated workspace launch

## Scope Boundaries

Included:

- empty-state welcome screen
- dismissible launch overlay
- welcome entry points into history and settings

Not included:

- a full dashboard homepage
- recent workspace cards
- onboarding tutorial flows
- changes to workspace creation backend behavior
- changes to history restore semantics

## Rationale

This design solves the immediate UX issue with minimal architecture churn.

- It removes the forced interruption at startup.
- It keeps the current workspace launch system intact.
- It gives the user a stable empty state.
- It supports the new session history feature as a first-class recovery path.

That makes it the smallest change that materially improves the product experience.
