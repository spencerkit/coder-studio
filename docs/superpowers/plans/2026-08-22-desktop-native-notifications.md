# Desktop Native Notifications Implementation Plan

> **For agentic workers:** Follow each task in order. Use `superpowers:test-driven-development` for every production change and `superpowers:verification-before-completion` before reporting success.

**Goal:** Deliver session-completion system notifications through Electron's native main-process API on Windows, macOS, and Linux while preserving the existing browser/PWA notification path and eligibility rules.

**Architecture:** Keep notification eligibility and copy in `use-session-notifications`. Add an optional preload IPC transport for Desktop, backed by a tested main-process notification service. Use a stable Windows AUMID/CLSID configured before app readiness, activate the Desktop window on native click, and fall back to Web Notification whenever the native transport is missing or fails.

**Tech Stack:** Electron 43, React 19, Jotai, TypeScript, Vitest, Testing Library, electron-builder/NSIS

**Design:** `docs/superpowers/specs/2026-08-22-desktop-native-notifications-design.md`

---

## File Structure

### Create

- `packages/desktop/src/desktop-notifications.ts`: request validation, native delivery, result handling, and click target propagation.
- `packages/desktop/src/desktop-notifications.test.ts`: service and validation tests with fake Electron notifications.
- `packages/desktop/src/desktop-notification-ipc.ts`: focused IPC registration for capability and delivery.
- `packages/desktop/src/desktop-notification-ipc.test.ts`: handler registration and delegation tests.
- `packages/desktop/src/preload.test.ts`: early click buffering across recreated-window startup.
- `packages/desktop/src/desktop-notification-activation.ts`: testable restore/show/focus/send behavior.
- `packages/desktop/src/desktop-notification-activation.test.ts`: activation behavior tests.
- `packages/desktop/src/windows-notification-identity.ts`: stable Windows notification identity constants and early setup.
- `packages/desktop/src/windows-notification-identity.test.ts`: platform/setup tests.

### Modify

- `packages/desktop/src/protocol.ts`: shared Desktop notification bridge request/result/target types and API methods.
- `packages/desktop/src/preload.ts`: expose native support, delivery, and click subscription methods.
- `packages/desktop/src/main.ts`: configure identity, construct the service, register IPC, and activate the main window on click.
- `packages/web/src/desktop-api.d.ts`: optional Web-facing notification bridge members for mixed-version compatibility.
- `packages/web/src/features/notifications/use-session-notifications.ts`: native-first system transport, Web fallback, and click target handling.
- `packages/web/src/features/notifications/use-session-notifications.test.tsx`: browser compatibility, native preference/fallback, and click tests.
- `packages/web/src/features/settings/components/settings-page.tsx`: asynchronous native capability and non-browser permission state.
- `packages/web/src/features/settings/components/settings-page.test.tsx`: Desktop capability/permission regression tests.
- `packages/web/src/locales/en.json`: native notification status copy.
- `packages/web/src/locales/zh.json`: native notification status copy.

---

## Task 1: Define and test the Desktop notification service

**Files:**

- Create: `packages/desktop/src/desktop-notifications.test.ts`
- Create: `packages/desktop/src/desktop-notifications.ts`
- Modify: `packages/desktop/src/protocol.ts`

- [ ] **Step 1: Write failing request-validation and support tests**

Cover:

- Valid bounded strings are accepted.
- Non-object, array, missing, empty, and oversized values are rejected.
- Unsupported Electron runtime returns `{ status: "unsupported" }` without constructing a notification.
- A valid supported request produces only `title`, `body`, `id`, and `silent: true` native options.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
pnpm --filter @coder-studio/desktop test -- desktop-notifications.test.ts
```

Expected: FAIL because the service and protocol types do not exist.

- [ ] **Step 3: Add the minimal protocol and service implementation**

Define:

- `DesktopNotificationRequest`
- `DesktopNotificationTarget`
- `DesktopNotificationResult` with `shown`, `unsupported`, and `failed` statuses
- A parser with explicit title/body/tag/workspace/session length limits
- A service whose Electron constructor/support check, logger, timer, and click callback are injected for tests

Attach `show`, `failed`, `click`, and `close` listeners before calling `show()`. Resolve delivery from `show` or `failed`; use a short bounded optimistic timeout so a platform that omits the event cannot leave IPC pending. Keep active instances bounded and release them on terminal events.

- [ ] **Step 4: Run the focused test and verify GREEN**

```bash
pnpm --filter @coder-studio/desktop test -- desktop-notifications.test.ts
```

Expected: all service tests PASS.

- [ ] **Step 5: Add failure and click lifecycle tests**

Cover:

- Constructor/show exception logs and returns `failed`.
- Native `failed` event logs and returns `failed`.
- Native `show` returns `shown`.
- Click emits exactly the validated workspace/session target.
- Close/failure releases the retained instance.
- Timeout resolves without duplicate settlement.

- [ ] **Step 6: Run the focused test file again**

Expected: all tests PASS without unhandled promise rejections or leaked fake timers.

## Task 2: Register and expose the preload IPC bridge

**Files:**

- Create: `packages/desktop/src/desktop-notification-ipc.test.ts`
- Create: `packages/desktop/src/desktop-notification-ipc.ts`
- Modify: `packages/desktop/src/protocol.ts`
- Modify: `packages/desktop/src/preload.ts`

- [ ] **Step 1: Write the failing IPC registration test**

Assert that the registrar installs exactly the notification capability and show handlers, delegates raw input to the service parser, and returns the service result.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @coder-studio/desktop test -- desktop-notification-ipc.test.ts
```

- [ ] **Step 3: Implement the focused registrar and preload methods**

Use channels:

- `desktop:get-notification-support`
- `desktop:show-notification`
- `desktop:notification-clicked`

Expose `getNotificationSupport`, `showNotification`, and `onNotificationClicked` through the frozen API. Install the click IPC listener during preload startup, retain the latest target while Web has no subscriber, and remove Web listeners from the bounded preload subscription set during unsubscribe.

- [ ] **Step 4: Run IPC tests and Desktop typecheck**

```bash
pnpm --filter @coder-studio/desktop test -- desktop-notification-ipc.test.ts
pnpm --filter @coder-studio/desktop typecheck
```

Expected: both commands PASS.

## Task 3: Configure Windows identity and native click activation

**Files:**

- Create: `packages/desktop/src/windows-notification-identity.test.ts`
- Create: `packages/desktop/src/windows-notification-identity.ts`
- Create: `packages/desktop/src/desktop-notification-activation.test.ts`
- Create: `packages/desktop/src/desktop-notification-activation.ts`
- Modify: `packages/desktop/src/main.ts`

- [ ] **Step 1: Write failing Windows identity tests**

Assert:

- Windows calls `setAppUserModelId("com.coderstudio.desktop")` once.
- Windows calls `setToastActivatorCLSID` with one fixed valid brace-wrapped GUID.
- macOS and Linux call neither method.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @coder-studio/desktop test -- windows-notification-identity.test.ts
```

- [ ] **Step 3: Implement early identity setup**

Export version-controlled AUMID and CLSID constants. Invoke the helper at module startup before `requestSingleInstanceLock`, `app.whenReady()`, and notification service use.

- [ ] **Step 4: Write failing activation tests**

Cover:

- A minimized live window restores, shows, focuses, then sends the click target.
- A non-minimized live window skips restore.
- A destroyed WebContents is not sent to.
- A missing window is recreated when an origin is available and sends after `did-finish-load`.
- Shutdown suppresses activation.

- [ ] **Step 5: Run and verify RED**

```bash
pnpm --filter @coder-studio/desktop test -- desktop-notification-activation.test.ts
```

- [ ] **Step 6: Implement activation and wire the service into main**

Construct the service with Electron `Notification`, platform-aware logging, and a click callback. Register its IPC handlers in `registerIpcHandlers`. The callback reuses `mainWindow`, `createMainWindow`, `appOrigin`, and the existing shutdown state through the testable activation helper.

- [ ] **Step 7: Run all new Desktop tests and typecheck**

```bash
pnpm --filter @coder-studio/desktop test -- desktop-notifications.test.ts desktop-notification-ipc.test.ts windows-notification-identity.test.ts desktop-notification-activation.test.ts
pnpm --filter @coder-studio/desktop typecheck
```

Expected: all tests and typecheck PASS.

## Task 4: Prefer native Desktop delivery while preserving browser behavior

**Files:**

- Modify: `packages/web/src/desktop-api.d.ts`
- Modify: `packages/web/src/features/notifications/use-session-notifications.test.tsx`
- Modify: `packages/web/src/features/notifications/use-session-notifications.ts`

- [ ] **Step 1: Add failing native-first transport tests**

Add cases for a background completion where:

- No Desktop bridge exists: Web `Notification` is constructed exactly as before.
- Native bridge reports `shown`: native is called and Web `Notification` is not.
- Native bridge reports `unsupported` or `failed`: Web `Notification` is constructed.
- Native bridge rejects: Web fallback occurs and the session hook remains mounted.

Keep existing threshold, channel-selection, sound, and browser click assertions unchanged as regression protection.

- [ ] **Step 2: Run the focused tests and verify RED**

```bash
pnpm --filter @coder-studio/web test -- use-session-notifications.test.tsx
```

- [ ] **Step 3: Add optional bridge declarations and native-first delivery**

Make new Web declaration members optional. Extract the system delivery choice from the loop so native delivery can settle asynchronously and call the existing browser function only on absence/failure. Do not alter transition bookkeeping or channel selection.

- [ ] **Step 4: Run and verify GREEN**

```bash
pnpm --filter @coder-studio/web test -- use-session-notifications.test.tsx
```

- [ ] **Step 5: Add failing native click tests**

Assert that the hook subscribes once, unsubscribes on unmount, and reuses `focusSession` for a matching live workspace/session. Cover a recreated window whose target hydrates after subscription, and expire an unresolved target after 30 seconds. A missing or mismatched target must not navigate or change the active workspace.

- [ ] **Step 6: Implement click subscription and rerun the file**

Read current sessions/workspaces from the Jotai store inside the callback to avoid stale closures. Retry a pending startup target when either store changes, with a bounded timeout so deleted targets cannot navigate later. Keep the activation itself in main; Web owns only workspace/session navigation.

Expected: the full notification test file PASS, including the pre-existing browser click test.

## Task 5: Report native Desktop capability accurately in settings

**Files:**

- Modify: `packages/web/src/features/settings/components/settings-page.test.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.tsx`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`

- [ ] **Step 1: Write failing settings tests**

Cover:

- Desktop native support true reports available without offering browser permission request.
- Desktop native support false reports unsupported even if renderer `Notification` exists.
- Native capability query rejection reports unsupported safely.
- Browser and mobile/PWA status tests retain their current results.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
pnpm --filter @coder-studio/web test -- settings-page.test.tsx -t "notification"
```

- [ ] **Step 3: Implement channel-aware capability state**

When `getNotificationSupport` exists, query it asynchronously and use a distinct native-managed permission state/copy. Otherwise keep the existing synchronous browser capability and permission flow. Ensure cleanup prevents late async results from updating an unmounted component.

- [ ] **Step 4: Add localized native status copy**

Add concise English and Chinese strings explaining that Desktop uses system notification permission rather than browser-site permission.

- [ ] **Step 5: Run settings and i18n tests**

```bash
pnpm --filter @coder-studio/web test -- settings-page.test.tsx -t "notification"
pnpm --filter @coder-studio/web test -- i18n.test.ts
```

Expected: all selected tests PASS.

## Task 6: Focused regression and build verification

- [ ] **Step 1: Run all Desktop tests**

```bash
pnpm --filter @coder-studio/desktop test
```

- [ ] **Step 2: Run the complete Web notification and settings files**

```bash
pnpm --filter @coder-studio/web test -- use-session-notifications.test.tsx settings-page.test.tsx
```

- [ ] **Step 3: Run type and production-build checks**

```bash
pnpm --filter @coder-studio/desktop typecheck
pnpm --filter @coder-studio/desktop build
pnpm --filter @coder-studio/web build
```

- [ ] **Step 4: Run repository verification**

```bash
pnpm ci:verify
pnpm ci:test
```

If `ci:verify` already includes the full test suite, record the redundant standalone `ci:test` result only when it is run separately.

- [ ] **Step 5: Inspect scope and formatting**

```bash
git diff --check
git status --short
git diff -- packages/desktop packages/web docs/superpowers/specs/2026-08-22-desktop-native-notifications-design.md docs/superpowers/plans/2026-08-22-desktop-native-notifications.md
```

Confirm no unrelated user-owned files were changed.

## Task 7: Packaged platform acceptance

These checks require platform-specific packaged execution and are not replaceable by Linux unit tests.

- [ ] **Windows:** install the NSIS build, inspect the effective Start Menu shortcut AUMID/ToastActivatorCLSID, receive a background notification, and click it from both the toast and Action Center.
- [ ] **macOS:** grant notification permission if prompted, receive a background notification, close/minimize the app window, and confirm click recreation/focus/session navigation.
- [ ] **Linux:** test under a supported desktop notification daemon, receive a background notification, and confirm click focus/session navigation where the daemon exposes click actions.
- [ ] Record any platform policy that intentionally suppresses display, such as Focus Assist/Do Not Disturb, separately from application delivery failures.
