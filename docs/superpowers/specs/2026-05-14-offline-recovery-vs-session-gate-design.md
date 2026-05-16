# Offline Recovery Vs Session Gate Design

> Status: Draft
> Date: 2026-05-14
> Scope: `packages/web/src/hooks/use-activation.ts`, `packages/web/src/hooks/use-bootstrap.ts`, `packages/web/src/app/providers.tsx`, `packages/web/src/shells/shared/connection-status-banner.tsx`, related tests

## Goal

Stop routing normal connection recovery failures to `/session-gate`.

The app should only show `session-gate` when the current tab is explicitly displaced by another active tab. Ordinary websocket disconnects, reconnect backoff, and slow recovery should keep the user on the current workspace and use the existing top connection banner instead.

## Problem

The current implementation mixes two different failure classes into the same `activationStatus === "gated"` outcome:

- true single-active displacement
- ordinary reconnect or activation claim failure

That creates two product problems:

- users see a page that says another tab took over even when no other tab exists
- the app abandons the current workspace UI during connection recovery, even though a reconnect banner already exists

The result is both misleading and unnecessarily disruptive.

## Decision

Split activation and connection recovery into separate user-facing states.

- `session-gate` is reserved for explicit displacement only
- offline recovery stays in place on the current route
- the top connection banner becomes the sole UI for reconnecting, disconnected, and slow-recovery states

This keeps the meaning of each state narrow:

- displacement means another tab actually replaced this one
- offline recovery means this tab is still the intended active tab, but transport recovery is in progress or degraded

## Current Behavior Summary

Today the frontend navigates to `/session-gate` whenever `activationStatus === "gated"`.

That `gated` state is currently reached from:

- `activation.revoked` handling in `AppProviders`
- `wsClient.connect()` failure inside `useActivation.claim()`
- `activation.claim` command failure inside `useActivation.claim()`

Only the first case is a real displacement signal. The latter two are transport or recovery failures and should not be represented as tab displacement.

## Proposed State Model

### Activation

Activation should model whether this tab still owns the single-active lease.

Required activation outcomes:

- `active`
  - this tab owns the lease
- `displaced`
  - the server explicitly revoked this tab because another tab took over

`gated` should no longer be used as a catch-all for reconnect and claim failures.

If the existing atom names are kept for a smaller patch, the implementation may continue storing `gated`, but only for true displacement. In that case, reconnect and claim failures must stop writing that value.

### Connection Recovery

Connection recovery should remain fully driven by websocket connection state:

- `connecting`
- `connected`
- `reconnecting`
- `disconnected`
- `rejected`

Normal websocket recovery should not mutate activation into a displaced-like state.

## Routing Rules

### When To Enter `/session-gate`

Navigate to `/session-gate` only when the tab is explicitly displaced.

Accepted triggers:

- receipt of `activation.revoked` with displacement semantics
- a websocket close reason that unambiguously means displacement, such as `single_active_displaced`

### When To Stay On The Current Route

Remain on the current page for:

- temporary websocket disconnect
- reconnect backoff
- recovery probe failure
- `activation.claim` failure caused by transport or request unavailability
- long-running reconnect attempts

The current workspace route, settings route, and other in-app routes should stay mounted so the user keeps context while recovery continues.

## Banner Behavior

The existing `ConnectionStatusBanner` remains the main recovery surface.

### Primary Message

When the app is recovering from a normal disconnect, show a top banner with the primary line:

- `连接已断开，正在重新连接...`

This replaces the current split phrasing where `reconnecting` shows one string and `disconnected` shows a harsher terminal message. During active automatic recovery, the banner should communicate progress, not final failure.

### Slow Recovery Hint

If recovery remains unresolved for roughly 25 seconds, add a second line beneath the primary message:

- `连接恢复较慢，可能是网络问题。如果长时间没有恢复，可以刷新页面。`

This hint should appear only after sustained failure, not immediately on the first reconnect attempt.

### Reset Behavior

The slow-recovery timer resets when:

- connection returns to `connected`
- an explicit displacement occurs and the app transitions to `session-gate`

### Auto Retry

Automatic reconnect attempts continue indefinitely under the existing reconnect strategy, subject to the current bounded backoff ceiling.

The UI should not present a manual retry button in this phase.

## Session Gate Behavior

`SessionGatePage` remains a full-page displacement shell.

Its meaning becomes narrower:

- this tab was actively displaced by another tab
- the current websocket was intentionally revoked because another holder took control

This page should no longer be used for:

- reconnect failure
- offline network conditions
- backend restart during recovery
- temporary request metadata gaps

## Error Semantics

### Claim Failure

If `activation.claim` fails during reconnect, treat it as a recovery error first, not a displacement event, unless the server explicitly reports displacement.

Expected user-visible behavior:

- stay on the current route
- keep the connection banner visible
- allow the reconnect loop to continue

### Explicit Displacement

If the server explicitly displaces the client:

- set activation to the displacement state
- clear projected workspace/session state as the app already does
- disconnect the websocket intentionally
- navigate to `/session-gate`

## Implementation Strategy

### Option Chosen

Preferred implementation is a semantic split rather than a route-layer exception.

That means:

- remove reconnect and claim failures as causes of activation gating
- keep `/session-gate` tied to explicit displacement signals only
- extend the banner to support a slow-recovery secondary line

### Rejected Alternative

A smaller patch could keep the current state model and merely avoid routing to `/session-gate` when `activationReason` is `reconnect_failed` or `claim_failed`.

That approach is not preferred because:

- it preserves ambiguous activation semantics
- future contributors can accidentally reintroduce the bug
- the route logic becomes a policy exception table instead of reflecting clear state meaning

## Testing Requirements

Add or update tests for the following cases:

1. reconnect failure does not navigate to `/session-gate`
2. `activation.claim` failure does not navigate to `/session-gate`
3. explicit `activation.revoked` still navigates to `/session-gate`
4. the connection banner appears during reconnecting recovery
5. the slow-recovery secondary hint appears only after the configured duration
6. the slow-recovery hint resets after a successful reconnect

## Risks

### Risk: stale route remains visible too long

Mitigation:

- keep current projected-state reset behavior for explicit displacement only
- use clear reconnect messaging in the banner during degraded transport states

### Risk: transport failures that actually mask displacement remain on the workspace briefly

Mitigation:

- only explicit server displacement should trigger the displacement shell
- once the server sends a real revoke event, the app still transitions immediately

### Risk: banner messaging feels indefinite

Mitigation:

- add the 25-second slow-recovery hint
- keep retry behavior automatic so the user is not forced into immediate action

## Non-Goals

This change does not:

- redesign the visual style of `session-gate`
- add a manual retry button
- change websocket backoff math beyond existing limits
- introduce a modal offline blocker
- solve unrelated multi-tab fencing behavior

## Verification

After implementation, verify:

1. placing the app idle long enough to trigger websocket recovery no longer routes to `/session-gate`
2. normal reconnect flow keeps the user on `/workspace`
3. a true displacement still shows `session-gate`
4. the banner shows the primary reconnect line immediately
5. the slow-recovery hint appears after the configured threshold and disappears after reconnect

## Implementation Boundary

Expected files to change:

- `packages/web/src/hooks/use-activation.ts`
- `packages/web/src/hooks/use-bootstrap.ts`
- `packages/web/src/app/providers.tsx`
- `packages/web/src/shells/shared/connection-status-banner.tsx`
- relevant desktop/mobile shell tests
- relevant provider lifecycle tests
