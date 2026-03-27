# Task Completion Reminder Design

Date: 2026-03-26
Status: Approved
Scope: Web only

## Summary

Add task completion reminders for the web app so background task completions send a browser system notification and play a built-in sound, while foreground behavior keeps the existing in-app toast flow. The feature will trigger only for `turn_completed` events and will be controlled by a minimal settings surface.

## Goals

- Notify the user when a task finishes in the background.
- Keep the current foreground experience lightweight and non-disruptive.
- Add only the minimum settings needed for V1.
- Gracefully degrade when browser notification support or permission is unavailable.

## Non-Goals

- Desktop notifications outside the browser
- Notification history or inbox
- Per-event notification customization
- User-uploaded or selectable sounds
- Summary extraction from the final assistant message
- Frontground sound playback

## Confirmed Product Decisions

### Trigger

- Trigger reminders only on `turn_completed`.
- Do not notify on `session_ended` or other idle transitions in V1.

### Channels

- Foreground: keep the existing toast behavior.
- Background: send a browser system notification and play a built-in sound.
- If notification permission is denied, still play the sound in background cases.

### Background Definition

Treat the completion as background when any of the following is true:

- The completed session is not the active session in its workspace.
- `document.visibilityState !== "visible"`.
- The browser window is unfocused.

### Notification Copy

Use the session title as the notification title.

Body format:

- English: `{workspaceTitle} · Task complete`
- Chinese: `{workspaceTitle} · 任务已完成`

### Notification Click Behavior

When the user clicks the system notification:

1. Focus the browser window.
2. Switch to the target workspace.
3. Switch to the target session.

### Settings

Add the minimum V1 settings:

- `Enable completion notifications`
- `Only notify in background`

Also show browser notification permission state in Settings:

- Allowed
- Not enabled
- Unsupported

### Sound Strategy

Use a built-in short audio asset bundled with the web app. If playback fails, fail silently and do not interrupt the session completion flow.

## Recommended Architecture

Use a dedicated web notification service rather than embedding all behavior directly into `markSessionIdle`.

### Why this approach

- Keeps browser API logic separate from workspace session state updates.
- Makes permission handling, background detection, audio playback, and notification click behavior easier to test.
- Leaves room for future reminder types without overloading session completion code.

## Implementation Shape

### Settings and Types

Extend `AppSettings` with a completion reminder configuration object that includes:

- whether completion reminders are enabled
- whether reminders should fire only in background cases

Update defaults, cloning, and localStorage hydration to preserve backward compatibility with existing saved settings.

### Notification Service

Create a small web notification module responsible for:

- checking browser notification support
- reading current permission state
- requesting permission when needed
- evaluating whether the current completion counts as background
- playing the bundled audio asset
- creating a browser notification
- invoking a callback when the notification is clicked so the app can focus the right workspace and session

### Event Integration

Keep the current event path:

- `turn_completed` is received through workspace lifecycle sync
- lifecycle sync continues to call `markSessionIdle`
- `markSessionIdle` continues to update local session state and preserve the current toast behavior

Add completion reminder handling on top of that flow for the `turn_completed` path only.

### UI Integration

The workspace screen should coordinate the runtime pieces that are tied to browser state and navigation:

- current document visibility
- current window focus state
- audio instance lifecycle if needed
- switching to a specific workspace and session when a notification is clicked

## Behavior Details

### Foreground completion

When the completed session is effectively in the foreground:

- do not send a system notification
- do not play the sound
- keep existing toast behavior unchanged

### Background completion

When the completed session is in the background and the feature is enabled:

- play the bundled sound
- send a browser system notification if permission is granted
- if permission is denied, skip the system notification but still play the sound

### Permission handling

When a background completion occurs and notifications are enabled:

- if permission is `default`, request permission at that moment
- if permission becomes granted, send the notification
- if permission is denied, do not re-prompt and continue with sound-only behavior
- if notifications are unsupported, show that status in Settings and degrade to sound-only behavior where allowed

## File-Level Impact

Expected primary touch points:

- `apps/web/src/types/app.ts`
- `apps/web/src/shared/app/settings.ts`
- `apps/web/src/components/Settings/Settings.tsx`
- `apps/web/src/features/settings/SettingsScreen.tsx`
- `apps/web/src/features/workspace/session-actions.ts`
- `apps/web/src/features/workspace/workspace-sync-hooks.ts`
- `apps/web/src/features/workspace/WorkspaceScreen.tsx`
- `apps/web/src/i18n.ts`
- a new web notification helper/service module
- a new bundled audio asset for the reminder sound

## Failure and Degradation Strategy

### Notifications unsupported

- Do not throw.
- Continue with sound-only background reminders if possible.
- Surface unsupported status in Settings.

### Permission denied

- Do not repeatedly request permission.
- Continue with sound-only background reminders.
- Show `Not enabled` in Settings.

### Audio playback fails

- Fail silently.
- Do not block session completion state updates.
- Do not block system notification delivery.

## Testing Strategy

## Automated coverage

Add focused tests around the new notification service and decision logic, including:

- background detection rules
- permission-state branching
- granted/default/denied notification behavior
- denied-permission sound-only fallback
- copy generation for notification title/body
- ensuring V1 triggers only from the `turn_completed` path

## Manual verification

1. Current foreground session completes.
   - No system notification.
   - No sound.
   - Existing in-app behavior remains intact.

2. A non-active session in the same workspace completes.
   - Toast appears.
   - System notification appears.
   - Sound plays.

3. The page is hidden or the window is unfocused when completion happens.
   - System notification appears if permission is granted.
   - Sound plays.

4. Notification permission is denied.
   - No system notification appears.
   - Sound still plays.
   - Settings shows the permission as not enabled.

5. Completion notifications are disabled.
   - No system notification.
   - No sound.
   - Existing foreground flow remains unaffected.

## Recommended Next Step

Create an implementation plan that breaks the work into small steps: settings/type changes, notification service, workspace integration, audio asset wiring, and verification.
