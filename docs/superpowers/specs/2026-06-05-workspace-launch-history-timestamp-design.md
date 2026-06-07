# Workspace Launch History Timestamp Design

Date: 2026-06-05
Status: Drafted for review

## Summary

Add a visible "last accessed" timestamp to each row in the workspace launch modal's "Recent Workspaces" list.

The server already persists recent workspace history with `WorkspaceHistoryEntry.lastOpenedAt`, so this change is frontend-only. The modal will render an absolute timestamp using the current locale, with the workspace name on the left and the formatted timestamp on the right. The path remains on the second line.

## Goals

- Make recency visible without requiring hover or an extra click.
- Reuse the existing workspace history payload without protocol changes.
- Preserve the current compact list density on desktop and mobile.

## Non-Goals

- Renaming history fields or changing persistence semantics.
- Introducing relative time labels such as "3 minutes ago".
- Adding sorting or filtering controls to recent workspaces.

## Existing State

- `packages/server/src/workspace/history-store.ts` already stores `lastOpenedAt` for each recent workspace entry.
- `packages/core/src/domain/types.ts` already exposes `WorkspaceHistoryEntry.lastOpenedAt`.
- `packages/web/src/features/workspace/views/shared/workspace-launch-modal.tsx` currently renders only the workspace name and path.

## Proposed Design

### Data

Continue using `WorkspaceHistoryEntry.lastOpenedAt` from `workspace.history.list`. No backend or shared type changes are required.

### UI Layout

Each recent workspace row keeps a two-line layout:

1. Top row: workspace name on the left, absolute last-access timestamp on the right.
2. Bottom row: workspace path in monospace, unchanged from the current design.

The timestamp should visually read as secondary metadata:

- Smaller than the workspace name.
- Right-aligned within the header row.
- Styled with secondary or tertiary foreground emphasis.

On narrow widths, the header row may wrap if needed, but the preferred layout remains name-left / time-right.

### Formatting

Use the existing `formatDate(timestamp, locale)` helper from `packages/web/src/lib/i18n.ts`.

Expected output follows the active UI locale:

- `zh` uses `zh-CN`
- `en` uses `en-US`

No custom timestamp formatting is added in this change.

### Accessibility

- The visible timestamp is informative only and does not change button semantics.
- The row button's existing accessible name remains the workspace-open action.
- No new interactive element is introduced.

## Implementation Notes

### Frontend

- Update `workspace-launch-modal.tsx` to render a new row header wrapper for name + timestamp.
- Read the active locale and format `entry.lastOpenedAt` with `formatDate`.
- Add small CSS adjustments in `packages/web/src/styles/components.css` for the header row and timestamp styling.

### Tests

Add or update modal tests to verify:

- Recent workspace rows render the formatted timestamp.
- Existing direct-open behavior from recent workspaces remains unchanged.

No backend tests are required because data persistence is unchanged.

## Alternatives Considered

### Show timestamp on a third line

Rejected because it increases row height and reduces visible recent-workspace density.

### Show relative time instead of absolute time

Rejected because the requested behavior is explicit timestamp visibility and the product already has a locale-aware absolute date formatter.

### Add both relative and absolute time

Rejected for now because it adds noise to a compact picker without a clear decision need.

## Risks

- Locale-formatted timestamps can be wider than expected in some environments, so the row header needs flexible spacing.
- Very long workspace names and long timestamps may compete for horizontal space; CSS needs to allow graceful shrinking or wrapping.

## Validation

- Unit test coverage for rendered timestamp text in the workspace launch modal.
- Manual verification on desktop and mobile launch surfaces for spacing and overflow behavior.
