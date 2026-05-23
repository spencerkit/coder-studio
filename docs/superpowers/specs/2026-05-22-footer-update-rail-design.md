# Footer Update Rail Design

> Status: Draft
> Date: 2026-05-22
> Scope: `packages/web` shared workspace status bar update entry and runtime status UX
> Depends on: `docs/superpowers/specs/2026-05-22-in-app-auto-update-design.md`

## Goal

Move update discovery and update execution visibility into the shared workspace footer so users can see and start updates without opening Settings.

The product should:

- show update discovery in the shared footer on desktop and mobile
- keep the existing update backend flow and confirmation behavior
- remove the update toast and topbar settings badge as primary discovery mechanisms
- keep update details in `Settings > About`, but make the footer the canonical live entry point
- show active update states in the footer after the user starts an update
- show update success briefly, then clear the footer automatically

## Non-Goals

This design does not include:

- changing update detection, install execution, or restart orchestration in the server or CLI worker
- adding download progress percentages
- moving full error details into the footer
- adding a second update confirmation model
- adding persistent "up to date" footer chrome when no update-related state is active

## Problem

The current update UX is split across a toast, a topbar badge, and `Settings > About`.

That works functionally, but it has two product problems:

1. discovery is weak because the toast is transient and the settings badge is indirect
2. execution visibility is disconnected from the main workspace surface where users spend their time

The workspace footer already acts as shared runtime chrome for branch and Git activity. It is the right place to expose update state because it is continuously visible in both desktop and mobile workspace flows.

## Decision Summary

Use an on-demand update rail on the right side of the shared workspace footer.

- left side: existing branch and Git status actions
- right side: update entry and runtime status
- desktop and mobile: same information architecture
- footer rail visible only for update-relevant states

This is the recommended design because it keeps the footer compact when nothing is happening while still making updates visible when action or attention is required.

## Product Behavior

## Footer Layout

The shared workspace footer becomes an explicit two-zone layout on both desktop and mobile.

### Left Zone

Always show the existing workspace and Git controls:

- branch trigger
- change count
- ahead count
- behind count
- fetch/refresh action

No Git behavior changes are in scope. This is a layout and placement change only.

### Right Zone

Show a footer update rail only when the update state is one of:

- `update_available`
- `installing`
- `restarting`
- `failed`
- `manual_required`
- `succeeded` during a short client-side success window

When no relevant update state is active, the right zone is empty.

## State-to-UI Mapping

The footer update rail should map update state to compact inline UI:

### `availability: update_available`, `updateStatus: idle`

Render:

- text: `检测到新版本 vX.Y.Z`
- action button: `立即更新`

This is the primary update discovery and update start entry.

### `updateStatus: installing`

Render:

- text: `更新中...`

No action button is shown.

### `updateStatus: restarting`

Render:

- text: `正在重启服务...`

No action button is shown.

### `updateStatus: failed`

Render:

- text: `更新失败`
- action button: `查看详情`

`查看详情` navigates to `Settings > About`.

### `updateStatus: manual_required`

Render:

- text: `需要手动处理`
- action button: `查看详情`

`查看详情` navigates to `Settings > About`, where the existing manual command and error summary remain visible.

### `updateStatus: succeeded`

Render:

- text: `已更新到 vX.Y.Z`

No action button is shown.

This success rail stays visible for `3` seconds, then hides automatically on the client.

## Update Start Flow

Clicking `立即更新` in the footer must reuse the existing update commands and confirmation model:

1. call `updates.prepareInstall`
2. if active work is reported, show the existing confirmation dialog
3. if confirmed, call `updates.startInstall`
4. let the existing backend state machine drive subsequent footer states

This keeps active terminal, session, and supervisor interruption warnings unchanged.

The footer rail is a new entry point, not a new update workflow.

## Success Visibility Rule

The `succeeded` state should not remain permanently visible in the footer.

Instead:

- when the frontend observes `updateStatus: succeeded`, show the success rail
- keep it visible for `3` seconds
- hide it locally after the timeout unless a new update-relevant state arrives

This timeout is frontend-only. It must not mutate persisted server state.

Reasoning:

- success is useful as confirmation immediately after reconnect
- a long-lived success badge becomes stale chrome
- server state should remain truthful and recoverable across restarts

## Existing Discovery Signals

Remove the current non-footer discovery signals:

- remove the "update available" toast
- remove the settings topbar badge

After this change, the footer becomes the only ambient update discovery surface during normal workspace use.

`Settings > About` remains the detail surface and fallback location for errors, manual steps, and metadata.

## Desktop Behavior

Desktop already renders the shared workspace footer with left-aligned Git information.

After this change:

- keep Git information in the left zone
- render the update rail in the right zone when active
- preserve the existing footer height and low-visual-weight editor-style chrome

The update rail should feel like a status affordance, not a separate banner.

## Mobile Behavior

Mobile currently reuses the same shared footer but needs layout normalization so it matches desktop structure.

After this change:

- move the Git information to the left side of the mobile footer, matching desktop
- render the update rail on the right side when active
- preserve the shared footer inside the mobile bottom stack and fullscreen sheet footers

The mobile footer should remain single-row and compact. If space becomes constrained, the update rail should truncate text before wrapping the whole footer into multiple rows.

## Frontend Architecture

## Data Source

Reuse the existing update frontend state:

- `updateStateAtom`
- `update.state.changed`
- `updates.prepareInstall`
- `updates.startInstall`

Do not add a new websocket topic or server command.

## Components

Add a focused footer update component under the shared workspace footer stack.

Recommended structure:

- `WorkspaceStatusBar`
  - owns overall left/right footer layout
- `GitPanelStatusStrip`
  - continues to render the left Git zone
- new `FooterUpdateRail`
  - renders right-side update state and buttons
  - owns local `succeeded` visibility timeout
  - owns footer-originated update actions and settings navigation

This keeps update-specific conditional rendering out of the Git components.

## Navigation Behavior

`查看详情` should navigate directly to `Settings > About`.

This is preferred over embedding error detail inline because:

- footer real estate is intentionally small
- manual command copy already exists in About
- failure details are secondary to the primary in-context status signal

## Styling Constraints

The update rail should use the same footer visual language as the Git area:

- compact height
- inline icon-and-text rhythm if an icon is used
- no modal-banner styling
- no large colored pills

Action buttons should be compact text or ghost-style controls that sit naturally inside the footer.

The footer must still read as one shared system bar, not as two disconnected widgets.

## Testing

Add or update tests for:

- desktop footer renders Git on the left and update rail on the right
- mobile footer uses the same left/right structure
- `update_available` shows `检测到新版本` and `立即更新`
- clicking `立即更新` reuses `updates.prepareInstall` and `updates.startInstall`
- active work still triggers the existing confirmation dialog
- `installing`, `restarting`, `failed`, `manual_required`, and `succeeded` render expected footer states
- `failed` and `manual_required` navigate to `Settings > About`
- `succeeded` auto-hides after `3` seconds
- update-available toast no longer appears
- topbar settings badge no longer appears

## Risks

## Footer Width Pressure

The mobile footer now carries two concerns in one row.

Mitigation:

- keep update copy compact
- prefer truncation over wrapping
- avoid showing version text in non-discovery states unless necessary

## Duplicate Action Logic

The About page already owns update actions.

Mitigation:

- share the same command calls and confirmation behavior
- do not fork update command semantics in the footer

## Stale Success Messaging

Persisted `succeeded` state could otherwise look permanent.

Mitigation:

- success visibility timeout stays client-local
- only the footer success rail hides automatically
- About can still reflect the actual last known persisted state

## Open Questions Resolved

- desktop update entry placement: right side of footer
- mobile Git placement: move to left side to match desktop
- post-click behavior: footer continues to show update runtime states
- success handling: show for `3` seconds, then hide
- existing toast and topbar badge: remove both
