# Desktop Native Notifications Design

## Summary

Move Electron Desktop system-notification delivery from the renderer Web Notification API to Electron's main-process native `Notification` API on Windows, macOS, and Linux. Keep the existing browser and PWA notification path unchanged, and retain it as a compatibility fallback when a newer Web bundle runs inside an older Desktop shell or native delivery is unavailable.

The change replaces only the final system-notification transport. Existing session transition detection, the four-second threshold, foreground suppression, in-app toasts, notification copy, preferences, and completion sound behavior remain unchanged.

## Problem

The Web notification hook currently calls `new Notification()` directly in the renderer. That works as a browser-oriented implementation, but it does not provide a reliable Desktop integration:

- The Electron main process does not own notification creation or click activation.
- Windows startup does not set a stable AppUserModelID or Toast Activator CLSID.
- The installed Start Menu shortcut uses `com.coderstudio.desktop`, while an Electron-created user shortcut can use `electron.app.Coder Studio` and a run-specific activator identity.
- Native creation failures are silently swallowed in the Web layer.
- Settings reports capability from the existence of the renderer `Notification` API, which can be a false positive inside Electron.

The result is that Desktop can appear notification-capable without producing an operating-system notification.

## Goals

- Use Electron main-process native notifications for every supported Desktop platform.
- Keep ordinary browser and PWA notification delivery behavior unchanged.
- Preserve compatibility between independently updated Web and Desktop artifacts.
- Give Windows one stable notification identity matching the packaged application ID.
- Restore, show, and focus the Desktop window when a native notification is clicked.
- Focus the workspace/session represented by the clicked notification when it still exists.
- Surface native notification failures in diagnostic logs and fall back safely.
- Report notification capability from the actual delivery channel used by the current runtime.

## Non-goals

- No notification history or durable notification queue.
- No notification action buttons, inline replies, images, or custom XML templates.
- No new "send test notification" control.
- No change to when a completion notification is eligible to fire.
- No server, provider, or shared backend notification service.
- No attempt to override operating-system Focus/Do Not Disturb policy.

## Existing Behavior to Preserve

The existing hook remains the source of truth for notification eligibility:

- Only `running -> idle` and `running -> ended` transitions are candidates.
- A `running -> idle` turn shorter than four seconds is suppressed.
- A background, unfocused, hidden, or minimized application uses a system notification.
- A foreground completion for another workspace uses the existing in-app toast.
- A foreground completion for the workspace the user is already viewing stays silent.
- The completion sound remains controlled independently by `soundEnabled` and is not duplicated by the OS notification sound.
- Later turns from the same session can notify again; a single turn cannot notify twice.

## Chosen Architecture

### Transport selection

`use-session-notifications` continues to calculate the title, body, tag, workspace ID, and session ID. For the `system` channel it selects transport by capability:

1. If the optional Desktop native-notification bridge exists, invoke it.
2. If native delivery reports unsupported or fails, try the existing Web Notification implementation.
3. If no Desktop bridge exists, use the existing Web Notification implementation directly.
4. If neither transport can deliver, stop without affecting session state or the rest of the UI.

This explicit feature detection keeps a newer Web payload compatible with an older Desktop shell. It also leaves a normal browser unaware of Desktop IPC.

### Desktop bridge contract

The preload bridge adds optional notification members to the Web-facing Desktop API:

- Query native notification support.
- Show a validated native notification request.
- Subscribe and unsubscribe to native notification click targets.

The preload installs its click IPC listener before the Web application boots. If a recreated
window receives a click target before React subscribes, preload retains the latest target and
delivers it to the first Web subscriber instead of losing the event during startup.

A notification request contains only:

- `title`
- `body`
- `tag`
- `workspaceId`
- `sessionId`

The main process accepts only plain objects with bounded non-empty string values. It does not expose arbitrary Electron `Notification` options, local paths, sounds, commands, or URLs to renderer input.

The result distinguishes successful display from unsupported or failed delivery so the renderer can choose the Web fallback. Error details stay in Desktop logs and are not exposed as an intrusive UI error.

### Main-process notification service

A focused Desktop notification module owns Electron notification creation instead of adding platform logic directly to the Web hook. The module:

- Checks `Notification.isSupported()`.
- Validates requests before constructing a notification.
- Uses `silent: true` because the existing Web layer already controls the completion sound preference.
- Maps the Web `tag` to the native notification identifier where supported.
- Logs synchronous creation errors and native `failed` events with platform context.
- Emits the associated workspace/session target when the notification is clicked.
- Keeps enough notification lifetime state for click/failure handlers and releases it after terminal events.

The IPC registration in `main.ts` delegates to this module and sends click targets only to the current, live main window.

### Click activation flow

On native notification click, the main process:

1. Ignores the event only if application shutdown has started.
2. Recreates the main window through the existing activation path if macOS has no current window.
3. Restores the window if minimized.
4. Shows and focuses the window.
5. Sends the validated workspace/session target to the renderer after a live WebContents is available.

The renderer subscribes once from the notification hook and reuses the existing `focusSession` helper. This updates the active workspace, persists the last-viewed target, and sets the pending session focus marker. A recreated window may receive the click before its workspace/session snapshots hydrate, so the hook retries that target on store updates for up to 30 seconds. If the workspace or session remains absent or mismatched, the renderer does not perform invalid navigation; the Desktop window still remains activated.

Duplicate click delivery is harmless because the focus operation is idempotent.

## Windows Identity

Windows uses one version-controlled identity for every launch:

- AppUserModelID: `com.coderstudio.desktop`, matching `electron-builder.yml`.
- Toast Activator CLSID: one fixed GUID committed with the Desktop source and never regenerated per run.

Both values are configured before `app.whenReady()` and before any notification can be created. This allows Electron to use the same identity for runtime registration and its notification shortcut metadata. Packaged verification must confirm that the effective Start Menu shortcut contains the same AUMID and ToastActivatorCLSID; inspecting only the YAML `appId` is insufficient.

macOS and Linux do not execute the Windows identity setup. Their Desktop deliveries still use the same main-process service and Electron's platform implementation.

## Capability and Permission UI

The settings page derives status from the selected runtime channel:

- Desktop with the new bridge asks the main process whether native notifications are supported.
- Older Desktop shells and normal browsers retain Web Notification API and permission checks.
- Mobile browser/PWA limitations retain their current handling.

Native Desktop support does not require the renderer to request browser Notification permission. The permission row must therefore avoid presenting a browser permission request as a prerequisite when the native channel is active. Operating-system notification policy can still suppress an otherwise supported notification, so the status describes runtime capability rather than promising visible delivery under every OS policy.

## Error Handling

- Invalid IPC payload: reject delivery, log a concise validation warning, and return failure.
- `Notification.isSupported()` is false: return unsupported and let Web choose its fallback.
- Constructor or `show()` throws: log the error and return failure.
- Native `failed` event: log the platform error and report failure when delivery is still awaiting a result.
- Native bridge invocation rejects: catch in Web, log a diagnostic warning, and attempt Web delivery.
- Web Notification unavailable, denied, or throws: end safely and emit a diagnostic warning where useful.
- Missing click target: activate the Desktop window but skip Web navigation.
- Destroyed window/WebContents: do not send IPC to it; recreate through the existing macOS activation behavior when applicable.

Notification failures remain non-fatal and never alter session lifecycle state.

## Testing Strategy

### Desktop unit tests

- Native support true and false.
- Valid request creation with sanitized, expected Electron options.
- Invalid and oversized request rejection.
- Synchronous constructor/show failure.
- Native failed-event handling and diagnostic logging.
- Click target propagation.
- Window restore/show/focus ordering.
- Destroyed or missing window behavior.
- Windows identity setup uses the stable AUMID and CLSID and is skipped on other platforms.

Electron dependencies should be injected behind small ports where necessary so these cases run without displaying a real notification.

### Web unit tests

- Browser without Desktop bridge continues to construct a Web Notification.
- Desktop bridge is preferred over Web Notification.
- Unsupported, rejected, or failed native delivery falls back to Web Notification.
- Native click targets reuse `focusSession` and unsubscribe on cleanup.
- Missing target does not navigate.
- Existing transition, threshold, foreground/background, toast, and sound tests continue to pass.
- Settings distinguishes native Desktop capability from browser permission capability.

### Verification

- Run targeted Web notification and settings tests.
- Run Desktop notification, preload/protocol, and window activation tests.
- Run Desktop and Web type checks.
- Run Desktop and Web production builds.
- Run repository-level `pnpm ci:verify` and `pnpm ci:test` when feasible.
- Build packaged artifacts and manually smoke-test notification display and click activation on Windows, macOS, and Linux.
- On Windows, inspect the installed Start Menu shortcut and confirm its AUMID and ToastActivatorCLSID match the committed constants.

## Package Boundaries

Expected production changes are limited to:

- `packages/desktop`: protocol types, preload bridge, native notification service, main-process registration/activation, Windows identity, and tests.
- `packages/web`: Desktop API declaration, notification transport selection/click handling, settings capability status, and tests.

No changes are expected in `packages/server`, `packages/providers`, or `packages/core`.

## Rollout and Compatibility

The Desktop bridge members are optional in the Web declaration. This supports both mixed-version directions:

- New Web + old Desktop: no bridge is detected, so Web Notification behavior remains available.
- Old Web + new Desktop: the new bridge is unused and existing Desktop APIs remain compatible.
- New Web + new Desktop: native Desktop notifications are preferred.
- Normal browser/PWA: no Desktop global exists, so current browser behavior is unchanged.

The feature requires no stored-data migration. Existing notification preference keys keep their meaning.

## Risks

- Linux notification daemons vary; `Notification.isSupported()` can report support even when desktop policy suppresses display.
- Windows shortcut metadata can differ between development, per-user, and all-user installs; packaged shortcut inspection is a release acceptance requirement.
- Operating-system Do Not Disturb settings can intentionally hide notifications and are outside application control.
- Native click behavior differs slightly by platform, so automated tests must be complemented by packaged smoke tests.
