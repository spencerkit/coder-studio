# Mobile-Friendly Phase 5A Design

> Date: 2026-05-01
> Status: Approved for planning
> Scope: Mobile connection recovery, foreground resume, and visible recovery-state surfacing

## 1. Goal

Phase `5A` closes the most fragile mobile runtime gap left after the main shell work: when the browser goes to the background, loses network, or returns from a suspended state, the app should recover the websocket session predictably and make that recovery state obvious on phones.

Today the app already has websocket auto-reconnect, but it is still desktop-first in two ways:

- reconnect timing depends only on the internal close/backoff loop
- mobile users get very little context about whether the app is recovering, stuck offline, or blocked by another active tab

`5A` therefore focuses on both behavior and feedback:

- resume connection attempts when the page becomes visible again
- resume connection attempts when the browser reports network recovery
- expose clearer mobile recovery copy while preserving desktop behavior

## 2. In Scope

- A foreground/network recovery entry point on `WsClient`
- `AppProviders` lifecycle hooks for `visibilitychange` and `online`
- Initial status synchronization when reusing the singleton websocket client
- Mobile-specific recovery-state surfacing inside the mobile shell/topbar flow
- Tests covering websocket recovery behavior, provider lifecycle hooks, and mobile recovery UI

## 3. Out of Scope

Phase `5A` does not include:

- landscape dock compaction or safe-area layout changes
- animation tuning
- server-side websocket protocol changes
- offline cache / queued commands / PWA behavior
- desktop layout changes beyond preserving current reconnect banners
- command retry semantics for failed in-flight requests

## 4. Design Constraints

- Desktop remains the source of truth for the current global reconnect / rejected banners
- Mobile recovery improvements must not create a second websocket client or duplicate subscriptions
- Foreground/network recovery must be safe to call repeatedly
- Recovery should never interrupt a healthy `connected` or `connecting` socket
- Another-tab fencing (`rejected`) remains terminal until the active writer tab changes; `5A` should not auto-override that state

## 5. Core Decisions

### 5.1 Give `WsClient` an Explicit Recovery Entry Point

The websocket client should expose an explicit recovery method that can be called when the browser environment indicates the app has a better chance of reconnecting.

That method should:

- no-op when already `connected`, `connecting`, or `rejected`
- cancel any pending reconnect backoff timer
- reset the reconnect budget so foreground recovery is not blocked by earlier failed attempts
- immediately start a fresh connection attempt

This keeps reconnect policy centralized inside the websocket client instead of duplicating socket heuristics in React components.

### 5.2 Track Connection Status as Client State, Not Just Socket ReadyState

`WsClient` currently notifies listeners about `reconnecting` and `rejected`, but `getStatus()` derives only from the raw socket handle. That loses meaningful state whenever the socket is absent but the client is intentionally recovering.

`5A` should make status an explicit client field updated by `setStatus()`. This ensures:

- `AppProviders` can inspect the real recovery state before deciding whether to resume
- remounts can sync the current status from the singleton client correctly
- mobile UI can rely on a stable status model during background/foreground transitions

### 5.3 Let `AppProviders` Own Browser Lifecycle Recovery Hooks

`AppProviders` already owns websocket bootstrapping and singleton reuse, so it should also own browser lifecycle recovery hooks.

Required signals:

- `document.visibilitychange`
- `window.online`

Behavior:

- when the document becomes `visible`, ask the current client to resume recovery if the connection is not healthy
- when the browser fires `online`, do the same
- when reusing an existing singleton client, immediately sync the current client status into Jotai so React state does not lag behind the underlying websocket client

`offline` does not need its own reconnect trigger in `5A`; the important path is explicit recovery once the browser is usable again.

### 5.4 Keep Mobile Feedback Lightweight but Explicit

The mobile shell should not rely only on the small topbar label or the desktop-style fixed reconnect banner.

On mobile, the recovery state should be visible in two layers:

- the topbar remains the persistent compact indicator
- a lightweight recovery strip gives clear context when the app is reconnecting, disconnected, or rejected

The recovery strip should communicate:

- what state the app is in
- whether recovery is automatic
- whether multiple reconnect attempts have already happened

This keeps the mobile workspace understandable without opening another sheet or modal.

## 6. Mobile Recovery Surface Model

### 6.1 Topbar Status

The existing topbar status pill remains the always-visible indicator:

- `已连接`
- `连接中`
- `重连中`
- `离线`
- `另一个标签页已激活`

It stays compact and glanceable.

### 6.2 Recovery Strip

When status is not healthy, mobile shows a compact strip above the main content.

Reconnect wireframe:

```text
┌────────────────────────────────────┐
│ 正在恢复连接 · 已尝试 2 次         │
└────────────────────────────────────┘
```

Disconnected wireframe:

```text
┌────────────────────────────────────┐
│ 连接已断开，回到前台或恢复网络后继续 │
└────────────────────────────────────┘
```

Rejected wireframe:

```text
┌────────────────────────────────────┐
│ 当前标签页未激活，请回到正在运行的标签页 │
└────────────────────────────────────┘
```

The strip is informational only in `5A`; it does not add manual retry buttons yet.

## 7. Desktop Preservation

Desktop behavior is preserved:

- desktop shell keeps the current reconnect banner
- desktop shell keeps the current rejected banner
- no desktop route/layout changes are required for `5A`

The only shared logic change is lifecycle-driven connection recovery and better status synchronization, both of which benefit both shells without changing desktop presentation.

## 8. Integration Shape

Expected code changes are concentrated in:

- `packages/web/src/ws/client.ts`
- `packages/web/src/ws/__tests__/client.test.ts`
- `packages/web/src/app/providers.tsx`
- `packages/web/src/app/providers.lifecycle.test.tsx`
- `packages/web/src/shells/mobile-shell/index.tsx`
- `packages/web/src/shells/mobile-shell/mobile-topbar.tsx`
- `packages/web/src/shells/mobile-shell/index.test.tsx`
- `packages/web/src/styles/components.css`

Expected implementation approach:

- add explicit status tracking and a recovery API to `WsClient`
- add provider lifecycle listeners that call that recovery API
- sync singleton client status on provider mount/reuse
- add a mobile recovery strip driven by existing connection atoms
- keep copy and styling self-contained to the mobile shell

## 9. Testing Strategy

### 9.1 Primary Coverage

Required coverage for `5A`:

- `WsClient` can cancel pending backoff and reconnect immediately through the new recovery entry point
- `WsClient.getStatus()` returns the real tracked connection state during reconnect flows
- `AppProviders` resumes recovery on `visibilitychange` when the page becomes visible
- `AppProviders` resumes recovery on `online`
- mobile shell renders recovery copy for reconnecting/disconnected states without regressing the existing workspace scaffold

### 9.2 Regression Focus

Regression checks should explicitly preserve:

- normal websocket connect/open behavior
- singleton reuse semantics in `AppProviders`
- desktop reconnect banner behavior
- mobile workspace rendering when the connection is healthy

## 10. Acceptance Criteria

`5A` is complete when:

- backgrounding and returning to the page can trigger an immediate reconnect attempt
- network recovery can trigger an immediate reconnect attempt
- the mobile shell clearly communicates reconnecting/disconnected/rejected states
- focused tests cover the new behavior and desktop behavior remains unchanged
