# Mobile Workspace Drawer Design

> Status: Draft
> Date: 2026-06-20
> Scope: `packages/web` mobile workspace shell, mobile topbar, mobile workspace drawer, mobile empty-state entry flow

## Goal

Rework the mobile workspace shell so the bottom `Agent / 文件 / 终端` dock is removed, file and terminal entry points move into the topbar, and agent switching is folded into the workspace drawer as a flat tree rooted at the active workspace.

The goal is not to redesign the mobile file sheet, terminal sheet, or active agent surface. The goal is to simplify mobile navigation and make the workspace-to-agent hierarchy explicit.

## Final Direction

Use a flatter mobile shell with three navigation regions:

1. a lighter topbar with left-aligned title
2. a workspace drawer that owns workspace and agent switching
3. the main content area showing only the active agent session

Key decisions:

- remove the bottom mobile dock entirely
- keep the top-left workspace/drawer affordance
- move `文件` and `终端` entry points to the top-right of the mobile topbar
- keep files and terminal on their existing sheet flows rather than redesigning those surfaces
- change the mobile workspace drawer into a flat tree where only the active workspace expands
- render agent rows under the active workspace using the existing mobile agent information density, including provider and runtime state
- use a flatter visual language with weaker card treatment, tighter type, and lower roundness

## In Scope

- mobile topbar layout and action placement
- removal of the bottom mobile dock from the workspace shell
- mobile workspace drawer information architecture and interaction model
- agent switching from the drawer
- placing `+ 新建 Agent` inside the active workspace subtree
- mobile empty-state entry changes so agent creation is consistent with the new drawer model
- mobile tests covering the new navigation model

## Out Of Scope

- redesigning the internal file explorer, file detail, or terminal sheet content
- redesigning the active `SessionCard` content for the current agent
- changing desktop workspace behavior
- changing provider launch logic beyond where the entry point lives
- redesigning global `/more` navigation

## Existing Context

The current mobile workspace shell is organized around:

- a topbar with workspace switcher, `/more`, and fullscreen actions
- a main area that shows the active agent session or an empty state
- a bottom dock with `Agent`, `文件`, and `终端`
- a separate mobile agent sheet used for session switching and session creation
- a workspace drawer used only for workspace switching

This structure creates a split navigation model:

- workspace switching lives in one place
- agent switching lives in another place
- files and terminal live in a third place

The approved redesign collapses those concerns into a clearer hierarchy: workspace and agent switching share the drawer, while files and terminal become topbar actions.

## Navigation Model

### Topbar

The mobile topbar keeps the left-side workspace trigger but changes its visual hierarchy:

- title is left-aligned
- title sizing and weight should be lighter than the approved mockup's first pass and closer to existing product UI density
- the right side shows two lighter action triggers for `文件` and `终端`

Topbar behavior rules:

- tapping the left workspace area opens or closes the workspace drawer
- tapping `文件` opens the existing mobile files sheet flow
- tapping `终端` opens the existing mobile terminal sheet flow
- opening files or terminal should close the drawer and any agent-selection overlay state

The previous `/more` action is not part of the approved topbar layout for this screen. Fullscreen behavior is also not part of the approved topbar action set for this flow.

### Main Content Area

The main area continues to render only the active mobile agent session.

Rules:

- do not introduce an inline agent list into the main content area
- do not turn the main area into a split workspace-and-agent layout
- keep the current active session presentation path centered on the existing `SessionCard`

If there is an active session, the shell should behave as it does today aside from the navigation changes around it.

### Workspace Drawer

The drawer becomes the primary mobile navigation surface for workspaces and agents.

Drawer hierarchy rules:

- show all workspaces in a single list
- only the active workspace expands
- inactive workspaces remain collapsed to a single row
- the active workspace row expands inline to show child agent rows
- child agent rows appear visually subordinate through indentation, smaller type, and lighter separators rather than through heavy nested cards

Agent row behavior rules:

- each row shows the agent title as the primary line
- each row shows provider and session state as the secondary line
- the secondary line should follow the existing mobile agent panel pattern, such as `CODEX · IDLE`
- selected agent state should be visible but restrained; avoid heavy card fills or oversized pills
- tapping an agent row immediately switches the active agent session
- after switching, the drawer closes and the main content updates to that session

Workspace row behavior rules:

- the active workspace row acts as the expanded section header and should not trigger a workspace switch or close the drawer when tapped
- tapping an inactive workspace switches to that workspace and closes the drawer
- after switching workspace, the newly active workspace becomes the only expanded node

### New Agent Entry

`+ 新建 Agent` moves into the active workspace subtree.

Rules:

- render it after the active workspace's agent rows
- it should read as part of that workspace's hierarchy, not as a global floating action
- tapping it should enter the existing mobile agent creation flow
- the creation flow continues to use the current provider-selection sheet implementation

## Empty State

The mobile no-session state should stop teaching users to use a separate agent dock entry, because that entry no longer exists.

Approved empty-state rules:

- keep the main area empty state lightweight
- remove copy that depends on a bottom `Agent` entry
- the primary action should still let the user create a session quickly
- that action should conceptually align with the new drawer tree model rather than teaching an obsolete navigation pattern

It is acceptable for the empty state CTA to open the existing create-agent flow directly, as long as the copy no longer describes a removed bottom dock.

## Visual Direction

The approved visual direction is flatter and more product-like than the first mockup draft.

Required styling characteristics:

- reduce headline size and weight in the mobile topbar and drawer rows
- weaken card treatment or remove it where plain rows and separators are sufficient
- reduce roundness compared with the current mockup direction
- prefer borders, dividers, indentation, and subtle fills over stacked rounded cards
- keep selected-agent emphasis visible but restrained
- keep agent metadata legible without making the drawer visually noisy

This change should preserve the product's current mobile IDE feel rather than drifting into a marketing-style visual hierarchy.

## Implementation Constraints

The approved implementation should reuse existing mobile workspace state where possible.

Preferred reuse points:

- `useWorkspaceScreenModel` for workspace list, mobile agent sessions, current mobile session selection, and mobile sheet opening
- existing `MobileFilesSheet` and terminal-sheet presentation
- existing session selection and session creation behavior

Avoid introducing a parallel cross-feature data model just for the drawer tree. The drawer should derive its hierarchy from the current active workspace plus existing session data.

A local expanded-workspace rule is sufficient because the approved interaction only allows the active workspace to expand.

## Testing

The implementation should add or update tests for the following behaviors:

- mobile workspace topbar renders `文件` and `终端` actions instead of the removed bottom dock model
- the bottom mobile dock is no longer rendered in the workspace shell
- the workspace drawer shows all workspaces but expands only the active workspace
- expanded active workspace rows include agent items
- agent items render both title and `provider · state` metadata
- selecting an agent item switches the active session and closes the drawer
- selecting an inactive workspace switches workspace and preserves the rule that only the active workspace expands
- the empty state no longer references the removed bottom `Agent` entry
- the empty state still provides a working path to create a session

## Risks

The main risk is replacing a three-entry bottom navigation model with a drawer-plus-topbar model without preserving fast access or clear orientation.

The design addresses that risk by:

- keeping files and terminal as single-tap topbar actions
- limiting drawer expansion to one workspace at a time
- preserving current session information density in agent rows
- keeping the active agent surface unchanged so the navigation refactor does not also rewrite the work surface
