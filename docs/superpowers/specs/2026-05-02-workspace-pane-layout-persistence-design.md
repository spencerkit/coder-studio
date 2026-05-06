# Workspace Pane Layout Persistence Design

## Summary

This design moves workspace agent-pane structure from browser-local storage into server-owned workspace state so session visibility and pane composition are consistent across desktop, mobile, reloads, and browser instances. The server will persist which panes exist, how they are split, and which session each pane references. Split ratios remain client-local so cross-browser restore can fall back to equal sizing without adding live resize synchronization complexity.

## Problem

The current implementation splits responsibility in a way that creates inconsistent behavior:

- Session truth lives on the server and can be recovered with `session.list`.
- Pane layout truth lives only in browser-local storage.
- Desktop mounts `AgentPanes`, which hydrates sessions from the server.
- Mobile workspace does not mount that hydration path, so a page reload can lose visible sessions even though the sessions still exist on the server.
- Opening the same workspace in another browser instance loses the pane composition because that browser has no local `paneLayout`.

As a result, pane visibility incorrectly depends on browser-local UI state instead of server-owned workspace state.

## Goals

- Persist pane structure on the server per workspace.
- Return enough data on workspace hydration so any client can reconstruct visible panes.
- Make desktop and mobile share the same session/layout hydration path.
- Keep pane sizes simple: use local ratios when present, otherwise fall back to equal splits.
- Make mobile-created panes append with a default vertical split when no more specific anchor/layout intent exists.

## Non-Goals

- Real-time multi-client collaborative pane resizing.
- Synchronizing drag-resize percentages across browsers.
- Introducing a new standalone pane-layout table if existing `workspace.uiState` can hold the data cleanly.

## Data Model

Extend `Workspace.uiState` with a server-persisted pane tree that represents structure only.

### Server-Persisted Pane Tree

- Each node has a stable `id`.
- `leaf` nodes reference `sessionId` or represent an empty draft slot.
- `split` nodes store `direction` and ordered `children`.
- `split` nodes do not need persisted ratio percentages for this change.

### Local-Only Split Ratios

- The client may keep a local map of split-node ratio overrides keyed by split node id.
- If no local ratio exists for a split, render it at an equal default (`0.5` for two-way splits).
- Because server layout remains structural, a new browser can reconstruct the correct pane/session composition without needing prior local state.

## Server Behavior

### Workspace Persistence

- `workspace.uiState` becomes the canonical storage for pane structure.
- Opening an existing workspace returns its saved pane tree as part of `workspace.meta`.
- New workspaces start with an empty root leaf pane.

### Session Hydration

- `session.list` continues to return workspace sessions from the server.
- The client reconstructs visible panes by combining:
  - server-returned workspace pane tree
  - server-returned session list

### Layout Sanitization

When hydrating:

- If a pane references an ended or missing session, convert that pane to a draft leaf instead of deleting structure.
- If the server layout is empty and live sessions exist, synthesize a layout that includes all live sessions.
- The synthesized fallback should preserve all live sessions instead of mounting only the first one.

### Default Synthesis Rules

- Desktop fallback: create a deterministic split tree containing all live sessions.
- Mobile fallback: when creating a new pane/session without prior layout intent, append it as a vertical split from the active session or from the root if no active session exists.

## Client Behavior

### Shared Hydration Hook

Create or refactor to a single workspace-session-layout hydration hook used by both desktop and mobile flows.

That hook is responsible for:

- fetching `session.list`
- reading the workspace pane tree from server-backed workspace metadata
- sanitizing pane/session references
- writing the resulting session projection into `sessionsAtom`
- writing the resulting pane tree into a shared pane-layout atom

Desktop and mobile should both consume this same hydrated state instead of having one path depend on `AgentPanes` mount behavior.

### Pane Layout Atom Role Change

The pane-layout atom should stop being the primary persistence source of truth.

- Server-backed pane structure becomes the canonical value.
- The atom becomes a client projection/cache of the current server layout.
- Optional local ratio storage can remain separate and keyed by split node id.

### Layout Mutations

Any user action that changes pane structure must update both:

- the in-memory pane-layout atom immediately for responsive UI
- the workspace `uiState` on the server

These mutations include:

- replace root with session
- append session
- split session pane
- split draft pane
- assign session to draft pane
- close session pane into draft pane
- close draft pane

## API Changes

### Recommended Approach

Use workspace metadata as the transport for persisted pane structure rather than modifying `Session`.

Reasoning:

- Pane structure belongs to workspace UI state, not to an individual session.
- Returning layout via workspace metadata avoids duplicating the same layout payload on every session row.
- This keeps `session.list` focused on sessions while still letting the shared hydration hook combine sessions and layout from the workspace record already present in app state.

### Required Command Support

Add a workspace UI-state update command for pane structure mutations if a sufficiently general one does not already exist.

Minimum capability:

- patch or replace persisted `workspace.uiState.paneLayout`

## Migration Strategy

### Existing Browsers With Local Layout

On first hydration after rollout:

- if server `uiState.paneLayout` is absent
- and the client still has an old local persisted pane layout
- migrate that local structure into server workspace state once
- then stop relying on local pane structure persistence

If neither exists, synthesize from live sessions.

### Existing Workspaces Without Layout

For workspaces that already have multiple live sessions but no server pane tree:

- create a fallback tree that includes every live non-ended session
- use deterministic ordering from `session.list`

## Testing

Add coverage for:

- mobile workspace reload restoring sessions via shared hydration
- desktop and mobile both hydrating from the same hook
- cross-browser/no-local-layout fallback including all live sessions
- sanitizing missing/ended session references into draft panes
- migrating old local pane layout into server `uiState`
- mobile append behavior defaulting to vertical split

## Acceptance Criteria

- Reloading mobile workspace no longer hides server-existing sessions.
- Desktop and mobile use the same session/layout hydration source.
- Opening a workspace in a different browser shows the same pane/session composition.
- Pane composition is server-persisted; split ratios may fall back to equal sizing in a fresh browser.
- Workspaces with multiple live sessions and no prior server layout do not collapse to a single visible session.
