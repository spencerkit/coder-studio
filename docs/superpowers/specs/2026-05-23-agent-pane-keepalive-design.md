# Agent Pane Keepalive Design

> **Date:** 2026-05-23
> **Status:** Draft
> **Scope:** `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx`, `packages/web/src/features/workspace/actions/use-workspace-screen-model.ts`, `packages/web/src/features/agent-panes/*`, `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx`, related desktop workspace CSS

## 1. Goal

Stop desktop editor switches from destroying agent terminal runtime state.

The target outcome is:

- switching the desktop main area from agent view to editor view does not unmount `AgentPanes`
- switching back to the agent view reuses the original `xterm` instances instead of rebuilding them
- same-page editor switches do not trigger `terminal.replay` or `terminal.snapshot`
- terminal output, scrollback, cursor state, and websocket subscriptions remain continuous while the editor is in front
- existing server recovery remains the fallback for page refresh, reconnect, sequence gaps, and real cold starts

## 2. Current Problem

Today the desktop workspace main stage renders either the editor or the agent panes.

That conditional rendering couples view mode to terminal runtime lifetime:

- when `mainAreaMode === "editor"`, the desktop view unmounts `AgentPanes`
- unmounting `AgentPanes` unmounts `SessionCard` and `XtermHost`
- `XtermHost` cleanup disposes the `xterm` instance, removes terminal subscriptions, and drops component-local runtime state

This causes two user-visible problems:

- a simple editor switch behaves like a terminal cold start when the user comes back
- if the session or terminal changes state while the editor is in front, returning to the agent view can surface replay or closed-session UI that exists only because the terminal had to be rebuilt

## 3. Root Cause

The root cause is not terminal recovery itself. The root cause is that desktop view switching currently destroys the terminal host.

The architecture treats:

- "this layer is not visible right now"

as if it were:

- "this runtime is no longer needed"

That is the wrong boundary for long-lived interactive terminals.

View visibility and terminal runtime lifetime must be separated.

## 4. Decision Summary

Adopt a desktop-only keepalive model for agent panes.

### 4.1 Main Decision

- keep `AgentPanes` mounted at all times inside the desktop workspace main stage
- render the editor as a frontmost overlay layer when `mainAreaMode === "editor"`
- treat the agent layer as `covered`, not removed, while the editor is visible

### 4.2 Terminal Decision

- preserve existing `xterm` instances during desktop view switches
- add an `isVisible` signal to terminal hosts so they can downgrade interaction while covered
- do not introduce a new frontend terminal screen model or terminal snapshot cache in the first phase

### 4.3 Recovery Decision

- keep existing `terminal.replay` and `terminal.snapshot` flows for true recovery scenarios
- explicitly remove desktop editor switches from the set of events that imply terminal recovery

This is the recommended design because it fixes the actual regression boundary with the smallest change set. It avoids introducing a second terminal state model while preserving existing server recovery guarantees.

## 5. In Scope

This design includes:

- desktop workspace main-stage restructuring so `AgentPanes` remain mounted
- a covered/foreground visibility model for the desktop agent layer
- `XtermHost` visibility-aware interaction changes
- hydration priority changes for covered terminals
- overlay gating so covered terminals do not surface interactive dialogs behind the editor
- tests that prove editor switching no longer causes terminal remount or replay

## 6. Out of Scope

This design does not include:

- mobile workspace behavior changes
- editor keepalive behavior
- persistent frontend terminal snapshots across page reloads
- a new standalone terminal runtime manager
- a custom frontend terminal screen model
- removing or redesigning server-side replay and snapshot recovery
- optimizing hidden terminal DOM cost beyond basic interaction suppression

## 7. High-Level Architecture

### 7.1 Desktop Main Stage

`workspace-main-stage` becomes a layered stage rather than an either-or content slot.

The stage contains:

- an always-mounted agent layer
- an editor layer that mounts only when the editor is the active foreground surface

The editor layer visually covers the agent layer without changing the agent layer's layout box.

### 7.2 Agent Layer

The agent layer owns:

- `AgentPanes`
- `SessionCard`
- `XtermHost`
- the live `xterm` runtime and its subscriptions

The layer remains mounted even when the editor is in front.

### 7.3 Editor Layer

The editor layer remains view-owned rather than runtime-owned in phase 1.

It may still mount and unmount with `mainAreaMode`, because the regression being fixed is terminal destruction, not editor lifecycle.

### 7.4 CSS Strategy

The keepalive model depends on keeping the agent layer measurable.

The first phase must not hide the agent layer with `display: none`.

Instead:

- the stage becomes a relative positioning container
- the editor layer uses absolute positioning with `inset: 0`
- the agent layer continues to occupy the full stage dimensions underneath

This keeps terminal sizing stable and avoids zero-sized parent measurements.

## 8. State Model

### 8.1 Foreground Mode

The existing `mainAreaMode` stays as:

- `"agent"`
- `"editor"`

Its meaning changes slightly:

- it indicates which layer is in the foreground
- it does not determine whether the agent layer exists

### 8.2 Derived Visibility

Desktop agent visibility is derived, not independently stored:

- `agentLayerCovered = mainAreaMode === "editor"`
- `terminalIsVisible = mainAreaMode === "agent"`

The design does not require a new global atom for covered state in phase 1.

### 8.3 Covered State Semantics

When the editor is in front, the agent layer enters `covered` state.

Covered terminals:

- remain mounted
- continue receiving output
- continue updating scrollback and internal buffer state
- continue receiving terminal exit and session state changes

Covered terminals must not:

- accept stdin
- receive pointer interaction
- auto-focus
- render a blinking cursor
- promote themselves to focused hydration priority
- surface interactive replay or closed-session dialogs as frontmost UI

### 8.4 Focus Rules

When switching from agent view to editor view:

- focus moves to the editor layer
- covered terminals immediately disable input

When switching back to agent view:

- terminals become interactive again
- the active terminal may refit
- phase 1 does not automatically return focus to the terminal

That conservative focus rule avoids hidden-terminal keyboard capture and avoids introducing a new focus memory feature into the first release.

## 9. Component Responsibilities

### 9.1 `WorkspaceDesktopView`

`WorkspaceDesktopView` becomes the composition point for keepalive.

Responsibilities:

- always render the agent layer
- mount the editor layer only when needed
- apply visibility and interaction classes to the agent layer
- mark the covered agent layer as hidden from accessibility and pointer interaction

### 9.2 `useWorkspaceScreenModel`

The screen model continues to compute `mainAreaMode`.

Its responsibility remains product intent:

- determine whether agent or editor should be in front

It no longer implies that the other layer should be removed.

### 9.3 `AgentPanes` and `SessionCard`

The agent panes stack remains structurally the same.

Phase 1 changes are limited to threading a visibility signal downward so terminal hosts can distinguish:

- active and visible
- active but covered

### 9.4 `XtermHost`

`XtermHost` remains the owner of the live `xterm` instance.

Phase 1 changes:

- accept an `isVisible` input
- gate interaction behavior on `isVisible`
- keep mount lifetime independent from desktop main-area view changes

### 9.5 CSS Layer Classes

Desktop workspace CSS gains explicit layer classes for:

- stage container
- agent layer
- covered agent layer
- editor overlay layer

## 10. `XtermHost` Behavior Changes

### 10.1 New Visibility Input

`XtermHost` receives `isVisible: boolean`.

This flag does not affect:

- terminal identity
- terminal keys
- mount lifetime
- replay strategy

It only affects foreground interaction behavior.

### 10.2 Effective Interactivity

Current interactivity is driven by terminal liveness and read-only state.

Phase 1 adds visibility to that contract:

- visible terminal: existing interactivity rules still apply
- covered terminal: input is always disabled even if the session is otherwise interactive

Practical consequences:

- `disableStdin = true` while covered
- `cursorBlink = false` while covered

### 10.3 Hydration Priority

Covered terminals must not compete with visible terminals for visible hydration tiers.

Phase 1 rule:

- covered terminals request or promote to `background`
- visible terminals continue using existing `focused`, `visible-active`, and `visible-other` tiers

This preserves recovery and hydration fairness when the editor is in front.

### 10.4 Fit on Return

When `isVisible` transitions from `false` to `true`, the terminal schedules a refit.

The refit is a display correction, not a recovery action.

It exists to avoid stale row or column calculations after overlay transitions.

### 10.5 Overlay Gating

Interactive replay or closed-session overlays may still become internally relevant while a terminal is covered, but they must not become the foreground interactive surface.

Phase 1 rule:

- covered terminals may track degraded or closed state
- interactive overlay actions are only enabled when the terminal is visible

## 11. Recovery Semantics

### 11.1 Recovery Flows That Remain

The following scenarios continue to use existing recovery logic:

- real initial mount
- page refresh
- websocket reconnect
- terminal sequence gaps
- replay too old fallback
- snapshot rebuild fallback
- truly closed or unavailable terminals

### 11.2 Recovery Flows Removed From View Switching

The following transitions must no longer imply historical recovery:

- desktop `agent -> editor`
- desktop `editor -> agent`

After keepalive, those transitions are visibility updates only.

### 11.3 Consequence

Returning from the editor to the agent view must not:

- create a new `xterm` instance
- request replay because of the view switch itself
- request snapshot because of the view switch itself
- surface a replay loading overlay because of the view switch itself

If replay or snapshot occurs after this design lands, it must be explainable by a real recovery trigger rather than a foreground change.

## 12. Product Behavior

### 12.1 Switching to Editor

When the user opens a file or diff preview:

- the editor layer appears on top of the stage
- the agent layer remains mounted underneath
- terminal output continues to accumulate
- hidden terminals become non-interactive

### 12.2 Switching Back to Agent

When the editor closes and the user returns to the agent view:

- the editor layer unmounts
- the agent layer becomes visible again
- the existing terminal instance is still present
- the terminal may refit
- the terminal does not cold-start

### 12.3 Terminal Ends While Covered

If a session or terminal ends while the editor is in front:

- state updates continue flowing into the store
- the covered terminal may become ended or closed internally
- no hidden interactive dialog should take over the foreground

When the user returns to the agent layer, the resulting ended or closed state is shown as a normal foreground pane state.

## 13. Validation Strategy

The primary validation target is lifecycle, not recovery correctness.

### 13.1 Must-Prove Behaviors

- switching to the editor does not unmount `AgentPanes`
- switching to the editor does not unmount `XtermHost`
- switching back to agent view does not remount terminal hosts
- terminal output continues while the editor is visible
- returning to agent view does not trigger new `terminal.replay` or `terminal.snapshot` requests
- covered terminals cannot accept stdin
- returning to visibility performs a refit without a recovery overlay

### 13.2 Suggested Test Coverage

- component or integration coverage for desktop stage composition
- `XtermHost` visibility tests for input gating and fit-on-return behavior
- e2e coverage that runs a live session, switches to the editor, waits for more output, then returns to verify continuity without replay UI

## 14. Risks and Mitigations

### 14.1 Hidden-Terminal DOM Cost

Risk:

- covered terminals still render live output, which may cost CPU and memory

Mitigation:

- accept this cost in phase 1 as the price of preserving terminal continuity
- evaluate runtime/view separation only if measured cost becomes material

### 14.2 Focus Pollution

Risk:

- hidden terminals may continue to capture focus or keyboard input

Mitigation:

- disable stdin while covered
- suppress auto-focus while covered
- route foreground focus to the editor layer on mode switch

### 14.3 Overlay Leakage

Risk:

- interactive terminal overlays may exist behind the editor and still affect accessibility or focus

Mitigation:

- gate interactive overlay mode on terminal visibility
- mark the covered agent layer inaccessible to pointer and accessibility traversal

### 14.4 Hydration Priority Waste

Risk:

- covered terminals may still consume visible hydration priority

Mitigation:

- downgrade covered terminals to `background` hydration tier

## 15. Phasing

### 15.1 Phase 1

Implement desktop keepalive only:

- always-mounted agent layer
- editor overlay
- `XtermHost.isVisible`
- input and overlay gating
- fit on visibility return

### 15.2 Later Work

If needed after measurement:

- keepalive for editor
- terminal runtime/view separation
- persistent terminal snapshots across reloads
- hidden-terminal rendering optimizations

## 16. Why This Design

This design directly addresses the real failure boundary:

- the terminal should not die just because another desktop surface is temporarily in front of it

It keeps server recovery where it belongs:

- as fallback for true continuity problems

It also avoids the complexity of introducing a second frontend terminal state system before the product has exhausted the simpler option of preserving the original runtime.
