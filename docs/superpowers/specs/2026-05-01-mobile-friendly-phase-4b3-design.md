# Mobile-Friendly Phase 4B3 Design

> Date: 2026-05-01
> Status: Approved for planning
> Scope: Mobile notification and warning-surface polish for `ToastContainer` and global `ConfigDriftBanner`

## 1. Goal

Phase 4B3 finishes the mobile floating-surface pass by adapting the remaining non-route overlays that still read as desktop-first on phones:

- in-app toast notifications
- the global config-drift warning strip shown outside `/settings`

After `4B1` and `4B2`, the main mobile shell already uses a consistent topbar, sheet, and bottom-stack model. These two surfaces are the remaining exceptions:

- toasts still inherit the desktop bottom-right stack
- the global config-drift banner still uses the full desktop inline-control layout

On mobile, that creates two problems:

- toast placement competes visually with mobile shell chrome
- the global warning strip consumes too much horizontal and vertical space before the user has asked to inspect details

## 2. In Scope

- Mobile-specific positioning and presentation for `ToastContainer`
- Mobile compaction of the global `ConfigDriftBanner`
- Preservation of the detailed embedded config-drift experience inside `Settings`
- Tests that prove mobile adaptations without regressing desktop notification behavior

## 3. Out of Scope

Phase 4B3 does not include:

- changes to toast payload shape or notification generation logic
- toast grouping, deduplication, or `+N` stack aggregation
- changes to desktop toast positioning
- changes to config-audit websocket/server contracts
- changes to the embedded `ConfigDriftBanner` detail/cleanup UI inside `Settings`
- changes to connection banners or other top-of-app alerts

## 4. Design Constraints

- Mobile breakpoint behavior remains aligned with the shared viewport rule: `(max-width: 899px)` or `(pointer: coarse)`
- Desktop remains the source of truth for current global toast and full config-drift banner behavior
- `ToastContainer` must remain globally mounted and keep existing click-to-focus navigation semantics
- Mobile global config-drift behavior must stay outside the `Settings` route tree; it should remain a shell-level warning surface
- Detailed review and cleanup controls must stay available somewhere on mobile, but they do not need to live in the compact global banner

## 5. Core Decisions

### 5.1 Keep Mobile Toasts as the Same Data Surface, but Move Them Into a Mobile Overlay Band

The toast stack should keep its current item model:

- same toast atoms
- same click behavior
- same dismiss behavior
- same desktop layout

Only the mobile presentation changes.

On mobile, the container should move out of the desktop bottom-right corner into a centered top overlay band that visually belongs to the mobile shell rather than to the desktop app frame.

This keeps notification behavior stable while removing the conflict with touch-first layout chrome.

### 5.2 Compact Only the Global Mobile Config-Drift Surface

The global config-drift banner shown outside `/settings` should become a compact summary strip on mobile.

The compact strip should show:

- warning icon
- finding count / summary title
- action to open `Settings`
- dismiss control

It should not render:

- inline checkbox list
- snippet blocks
- inline cleanup CTA
- expandable desktop-style details

That keeps the workspace shell lightweight and delegates detailed review/cleanup to the dedicated settings context that already exists.

### 5.3 Keep the Embedded Settings Banner as the Detailed Surface

Inside `Settings`, the embedded `ConfigDriftBanner` remains the detailed consent and cleanup UI on both desktop and mobile.

This preserves the existing place where the user can:

- inspect individual findings
- choose which findings to clean
- run cleanup
- see cleanup notices

`4B3` therefore compacts only the global mobile warning surface, not the settings-local one.

### 5.4 Preserve Mobile Shell Stability

The compact global banner must not turn into another expandable sheet or modal.

It stays as a lightweight inline strip under the mobile topbar:

- present when findings exist
- dismissible
- easy to ignore temporarily
- easy to route into `/settings` when the user wants details

This keeps the shell consistent with the earlier “one major surface at a time” rule.

## 6. Mobile Surface Model

### 6.1 Mobile Toast Container

The mobile toast container should behave like a centered notification rail near the top of the viewport.

Wireframe:

```text
┌──────────────────────────────┐
│ ✓ Session done           ×   │
│ Claude · demo · 1m           │
└──────────────────────────────┘
┌──────────────────────────────┐
│ ! Workspace switched     ×   │
│ /tmp/demo                    │
└──────────────────────────────┘
```

Behavior:

- centered horizontally
- narrow enough to read as a transient overlay, not a full-width banner
- stacked vertically in the same order as today
- still clickable to route/focus the relevant workspace/session
- still dismissible per toast

Desktop keeps the current bottom-right stack.

### 6.2 Mobile Global Config-Drift Summary Strip

The compact global mobile warning strip should behave like a single summary row under the topbar.

Wireframe:

```text
┌──────────────────────────────┐
│ ⚠ Codex 配置冲突（2 项） 设置  × │
└──────────────────────────────┘
```

Error-state wireframe:

```text
┌──────────────────────────────┐
│ ⚠ Codex 配置检查不可用  刷新  × │
└──────────────────────────────┘
```

Behavior:

- no expand/collapse interaction on mobile global variant
- primary action routes to `/settings`
- dismiss hides the strip for the current session, same as today
- load-error state stays visible when `showLoadError` is enabled, but still uses the compact row form

### 6.3 Embedded Settings Variant Remains Full

Inside `Settings`, the embedded variant keeps:

- the full title + path row
- detailed findings list
- checkbox selection
- cleanup button
- cleanup notices

That boundary is critical: mobile global variant is summary-only, settings embedded variant is the detailed working surface.

## 7. Desktop Preservation

Desktop behavior is explicitly preserved:

- `ToastContainer` keeps the current bottom-right fixed stack
- desktop `ConfigDriftBanner` keeps the current full inline-control layout
- desktop click/focus semantics remain unchanged

If the implementation branches, prefer viewport-specific render/class branches over broad shared-markup rewrites.

## 8. Integration Shape

Expected code changes are concentrated in:

- `packages/web/src/features/notifications/toast-container.tsx`
- `packages/web/src/features/notifications/toast-container.test.tsx`
- `packages/web/src/features/config-drift-banner/index.tsx`
- `packages/web/src/features/config-drift-banner/index.test.tsx`
- `packages/web/src/features/settings/components/settings-page.test.tsx`
- `packages/web/src/styles/components.css`

Supporting reuse should come from existing components/hooks only:

- `packages/web/src/hooks/use-viewport.ts`
- `react-router-dom` navigation already used elsewhere

Expected implementation approach:

- add a mobile modifier class to `ToastContainer`
- add a mobile/global compact branch inside `ConfigDriftBanner`
- leave the embedded settings variant on the existing detailed path
- add CSS for compact mobile banner and mobile toast positioning

## 9. Testing Strategy

### 9.1 Primary Coverage

Required coverage for `4B3`:

- `ToastContainer` renders a mobile-specific container path when viewport is mobile
- toast click navigation still works on mobile
- global `ConfigDriftBanner` renders a compact mobile summary when viewport is mobile
- the compact summary routes into `/settings`
- the embedded `Settings` banner still renders the detailed config-drift UI on mobile

### 9.2 Regression Boundaries

Desktop regression coverage should continue to prove:

- toast click-to-focus behavior remains intact
- desktop global config-drift behavior is unchanged unless a test explicitly covers the mobile branch only

### 9.3 Verification

At minimum, `4B3` should be verified with:

- focused tests for `ToastContainer`
- focused tests for `ConfigDriftBanner`
- focused settings-page regression coverage
- lint on touched files
- full web test suite after the change lands

## 10. Risks and Mitigations

### Risk 1: Compacting the global banner hides cleanup too aggressively

Mitigation:

- keep `/settings` as the detailed cleanup destination
- test that embedded settings variant remains full on mobile

### Risk 2: Mobile toast positioning regresses desktop behavior

Mitigation:

- keep desktop and mobile container styling explicitly branched
- keep existing toast item logic unchanged

### Risk 3: Mobile shell becomes crowded near the top chrome

Mitigation:

- keep the global banner summary to a single row
- avoid expandable details in the global mobile variant
- constrain toast width and spacing so they read as overlays rather than another header band
