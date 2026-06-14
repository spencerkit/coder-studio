# Dev Browser Multi-Tab Design

> Status: Draft for user review
> Date: 2026-06-12
> Scope: `packages/core`, `packages/server`, `packages/web` dev browser editor-tab state and refresh recovery

## Goal

Allow the built-in dev browser to behave like ordinary editor tabs:

- the user can open multiple browser tabs
- the same URL can be opened multiple times
- each browser tab is independently closable and activatable
- refreshing the page restores all browser tabs
- opening a URL inside a browser tab replaces that tab's URL instead of creating another tab

This change is limited to tab modeling, persistence, and browser-session recovery. It does not add new proxy capabilities.

## Current Problem

The current implementation still models the dev browser as a singleton tab:

- browser tab identity is fixed to `id: "dev-browser"`
- opening the browser focuses the existing singleton tab instead of creating a new instance
- duplicate URLs are impossible because there is only one browser tab
- refresh persistence uses one global `devBrowserTargetUrl`
- the surface restores only one browser session

That model conflicts with the editor mental model. Browser tabs need instance identity, not feature identity.

## User-Approved Interaction Rules

These rules are fixed by user decision and should drive the implementation:

1. Clicking the editor-header browser action creates a new browser tab instance.
2. Duplicate URLs are allowed. URL is display data, not identity.
3. Browser tab labels should just show the URL.
4. Inside a browser tab, submitting the URL form with `Open` replaces that tab's current URL.
5. Refresh should restore all browser tabs, not only the active one.

## In Scope

- per-instance browser tab modeling
- browser-tab persistence in workspace UI state
- duplicate same-URL browser tabs
- restore all browser tabs after refresh
- lazy browser-session recreation for restored tabs
- per-tab close and activation behavior
- test updates covering these behaviors

## Out Of Scope

- WebSocket proxy support
- HMR support
- changes to the dev proxy HTTP feature set
- special browser tab naming beyond showing the URL
- cross-workspace browser sharing

## Design

## 1. Browser Tabs Become Instance Records

Replace the singleton browser tab model with a browser tab record that carries a unique instance id and its current URL.

Target shape:

```ts
export interface WorkspaceBrowserEditorTab {
  kind: "browser";
  id: string;
  url: string | null;
}
```

Rules:

- `id` is a generated stable instance id used for tab identity, activation, replacement, and close.
- `url` is nullable so a newly created browser tab can exist before the user opens a target.
- file tabs remain path-based and continue to deduplicate by path.
- browser tabs do not deduplicate by URL.

`WorkspaceEditorTab` stays the shared union for file and browser tabs.

## 2. Persist Browser Tabs in the Tab List, Not in a Global Browser Field

The persisted browser state should move from the singleton field:

```ts
devBrowserTargetUrl?: string | null;
```

to the browser entries inside:

- `openEditorTabs`
- `activeEditorTab`

The browser tab's `url` becomes the persisted source of truth for restore and label rendering.

`devBrowserTargetUrl` should be removed from the persisted workspace UI contract once the client and server both understand the new browser tab shape.

## 3. New-Tab vs Replace-Current Behavior

Two entrypoints have different behavior:

- editor-header browser action: create a new browser tab with a fresh `id` and `url: null`
- browser-surface `Open`: replace the current browser tab's `url`

Replacing means:

- update the active browser tab record in `openEditorTabs`
- keep the same browser tab `id`
- persist the updated tab list and active tab
- recreate the browser proxy session for that tab

This preserves the expected meaning of "I am editing the current tab's address bar".

## 4. Browser Session State Is Local and Rebuilt from URL

Proxy session ids should remain runtime-local UI state and should not be persisted in workspace UI state.

Each rendered browser tab surface should derive its live session from:

- workspace id
- browser tab id
- browser tab url

Recommended behavior:

- if a browser tab has no URL, show the empty state
- if a browser tab has a URL and becomes active without a live session, create one
- if a browser tab URL changes, delete the old live session and create a new one
- if a browser tab closes, delete its live session if present
- if the whole app unmounts, best-effort delete active live sessions

This keeps persisted data stable and avoids persisting short-lived server session ids that are invalid after refresh anyway.

## 5. Refresh Recovery Restores All Tabs but Rebuilds Sessions Lazily

Refresh recovery should restore the editor tab list first, then rebuild browser sessions on demand.

Behavior after refresh:

1. hydrate `openEditorTabs` and `activeEditorTab`
2. render all restored tabs in the tab strip
3. if the active tab is a browser tab with a URL, recreate its proxy session immediately
4. if an inactive restored browser tab is later activated, recreate its session then

This is the right tradeoff:

- all tabs visually come back after refresh
- duplicate same-URL tabs stay distinct
- startup work stays bounded because hidden browser tabs do not all open sessions at once

## 6. Tab Rendering and Activation Rules

The tab header should render browser tabs from `tab.url`:

- `url` present: show the URL text
- `url` absent: show the existing browser fallback label

Activation and close logic should match other editor tabs:

- activating one browser tab does not affect sibling browser tabs except switching focus
- closing one browser tab removes only that tab instance
- closing the active browser tab falls back using the existing editor-tab close policy

No special singleton branch should remain in tab rendering or tab state normalization.

## 7. Normalization and Backward Compatibility

The normalization layer should accept both old and new browser shapes during rollout, then produce only the new shape in client state.

Compatibility behavior:

- legacy `{ kind: "browser", id: "dev-browser" }` normalizes to one browser tab with a generated deterministic migration id and `url` from `devBrowserTargetUrl` when available
- legacy `devBrowserTargetUrl` is read only for migration during hydration/normalization
- newly persisted state writes only browser tabs with `{ kind, id, url }`

This lets existing saved workspaces recover cleanly after upgrade without keeping the legacy singleton model alive in runtime logic.

## 8. Package Boundaries

### `packages/core`

- update `WorkspaceBrowserEditorTab`
- update `WorkspaceEditorTab`
- update `UiState` to remove the long-term dependency on `devBrowserTargetUrl`

### `packages/server`

- accept and persist the new `openEditorTabs` and `activeEditorTab` browser records
- keep normalization compatible with older saved singleton browser state during transition

### `packages/web`

- replace singleton browser tab assumptions in atoms, normalization, actions, and surface rendering
- open new browser tabs from the header action
- replace the current browser tab URL from the in-tab toolbar
- rebuild sessions per browser tab instance

## Testing Strategy

Add focused tests before implementation for these behaviors:

1. opening the browser action twice creates two distinct browser tabs
2. opening the same URL in two different browser tabs keeps both tabs
3. using `Open` inside a browser tab replaces only that tab's URL
4. closing one browser tab does not close sibling browser tabs
5. refresh hydration restores multiple browser tabs and the active browser tab
6. legacy singleton browser persistence still hydrates into one browser tab after migration
7. restored inactive browser tabs defer session creation until activation

Keep existing refresh-recovery tests green and update them to the new per-instance model where needed.

## Acceptance Criteria

- the user can open multiple browser tabs from the editor header
- the same URL can appear in multiple browser tabs at the same time
- tab labels display the URL and do not collapse same-URL tabs into one instance
- using `Open` inside a browser tab updates that tab instead of creating a new one
- refreshing the page restores all browser tabs and the previously active tab
- restored browser tabs reopen successfully when activated
- old persisted singleton browser state migrates without data loss

## Risks and Tradeoffs

- removing the singleton assumption touches shared editor-tab code, so focused regression tests are required around activate/close behavior
- lazy session recreation means an inactive restored browser tab may show a short loading interval the first time it is revisited after refresh
- migration logic must stay narrowly scoped so legacy `devBrowserTargetUrl` support does not keep leaking into new runtime code
