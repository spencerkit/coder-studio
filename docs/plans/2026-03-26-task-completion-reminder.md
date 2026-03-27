# Task Completion Reminder Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add web-only task completion reminders so background `turn_completed` events play a bundled sound and show a browser notification, while foreground behavior keeps the existing toast flow.

**Architecture:** Extend app settings with a small completion reminder configuration, add a focused browser notification helper for permission/background/audio logic, and wire it into the existing `turn_completed -> markSessionIdle` flow through `WorkspaceScreen` so notification clicks can switch to the right workspace and session.

**Tech Stack:** React 19, TypeScript, Vite, react-router-dom, browser Notification API, HTMLAudioElement

---

### Task 1: Add settings and translator types for completion reminders

**Files:**
- Modify: `apps/web/src/types/app.ts:293-310`
- Modify: `apps/web/src/shared/app/settings.ts:1-52`
- Modify: `apps/web/src/i18n.ts` (add new settings/permission/notification copy in both locales near existing settings strings)
- Test: none existing; verification by `pnpm build:web`

**Step 1: Add the failing type shape mentally and map exact fields**

Add a new settings object under `AppSettings`:

```ts
completionNotifications: {
  enabled: boolean;
  onlyWhenBackground: boolean;
};
```

Also add a string union for permission display if helpful:

```ts
type BrowserNotificationSupport = "allowed" | "not-enabled" | "unsupported";
```

**Step 2: Update default settings**

In `apps/web/src/shared/app/settings.ts`, extend `defaultAppSettings()`:

```ts
completionNotifications: {
  enabled: true,
  onlyWhenBackground: true,
}
```

**Step 3: Update clone logic**

In `cloneAppSettings`, preserve immutability:

```ts
completionNotifications: { ...settings.completionNotifications }
```

**Step 4: Update localStorage hydration**

In `readStoredAppSettings`, safely read legacy values:

```ts
completionNotifications: {
  enabled: parsed.completionNotifications?.enabled ?? fallback.completionNotifications.enabled,
  onlyWhenBackground:
    parsed.completionNotifications?.onlyWhenBackground ?? fallback.completionNotifications.onlyWhenBackground,
}
```

Expected result: old saved settings continue to work without migration errors.

**Step 5: Add translator strings**

Add both English and Chinese strings for:

- settings label for completion notifications
- hint text
- only-background toggle label and hint
- permission status label
- permission states: allowed / not enabled / unsupported
- notification body template: workspace title + task complete

Example keys:

```ts
completionNotifications: "Completion Notifications"
completionNotificationsHint: "Send reminders when tasks finish in the background."
notifyOnlyInBackground: "Only notify in background"
notifyOnlyInBackgroundHint: "Skip browser alerts when the completed session is already in view."
notificationPermission: "Browser notification permission"
notificationPermissionAllowed: "Allowed"
notificationPermissionNotEnabled: "Not enabled"
notificationPermissionUnsupported: "Unsupported"
completionNotificationBody: ({ workspaceTitle }) => `${workspaceTitle} · Task complete`
```

**Step 6: Run build to verify types compile**

Run: `pnpm build:web`
Expected: PASS with no TypeScript errors.

**Step 7: Commit**

```bash
git add apps/web/src/types/app.ts apps/web/src/shared/app/settings.ts apps/web/src/i18n.ts
git commit -m "feat: add completion reminder settings"
```

---

### Task 2: Add a browser reminder helper module

**Files:**
- Create: `apps/web/src/features/workspace/completion-reminders.ts`
- Modify: `apps/web/src/features/workspace/index.ts`
- Test: none existing; verify with `pnpm build:web`

**Step 1: Write the failing API contract in the new module**

Create a small helper with explicit inputs and no React dependency:

```ts
export type CompletionReminderTarget = {
  workspaceId: string;
  workspaceTitle: string;
  sessionId: string;
  sessionTitle: string;
};

export type CompletionReminderEnvironment = {
  activeWorkspaceId?: string;
  activeSessionId?: string;
  documentVisible: boolean;
  windowFocused: boolean;
};
```

Export functions for:

- `getBrowserNotificationPermissionState()`
- `isCompletionReminderBackgroundCase()`
- `playCompletionReminderSound()`
- `notifyCompletionReminder()`

**Step 2: Implement permission-state logic**

Use browser capability checks only:

```ts
if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
return Notification.permission === "granted" ? "allowed" : "not-enabled";
```

**Step 3: Implement background detection**

Use the agreed rules:

```ts
return target.workspaceId !== env.activeWorkspaceId
  || target.sessionId !== env.activeSessionId
  || !env.documentVisible
  || !env.windowFocused;
```

**Step 4: Implement audio playback helper**

Accept an `HTMLAudioElement | null` so the caller owns lifecycle:

```ts
export const playCompletionReminderSound = async (audio: HTMLAudioElement | null) => {
  if (!audio) return;
  try {
    audio.currentTime = 0;
    await audio.play();
  } catch {
    // swallow
  }
};
```

**Step 5: Implement browser notification helper**

Use a function shaped like:

```ts
export const notifyCompletionReminder = async ({
  title,
  body,
  onClick,
}: {
  title: string;
  body: string;
  onClick: () => void;
}) => { ... }
```

Behavior:
- return early if Notification API unsupported
- if permission is `default`, request permission once at send time
- if granted, create `new Notification(title, { body })`
- bind `onclick` to call `onClick()` and `window.focus()` if available
- if denied, do nothing and let caller rely on sound-only behavior

**Step 6: Export the helper from workspace index**

Add:

```ts
export {
  getBrowserNotificationPermissionState,
  isCompletionReminderBackgroundCase,
  notifyCompletionReminder,
  playCompletionReminderSound,
} from "./completion-reminders";
```

**Step 7: Run build**

Run: `pnpm build:web`
Expected: PASS

**Step 8: Commit**

```bash
git add apps/web/src/features/workspace/completion-reminders.ts apps/web/src/features/workspace/index.ts
git commit -m "feat: add browser completion reminder helpers"
```

---

### Task 3: Add settings UI and permission status display

**Files:**
- Modify: `apps/web/src/features/settings/SettingsScreen.tsx:1-169`
- Modify: `apps/web/src/components/Settings/Settings.tsx:5-220`
- Modify: `apps/web/src/types/app.ts` (if you add a reusable permission status type)
- Test: verify in browser and with `pnpm build:web`

**Step 1: Add permission status state to SettingsScreen**

Create state derived from browser support:

```ts
const [notificationPermissionState, setNotificationPermissionState] = useState<...>(() =>
  getBrowserNotificationPermissionState()
);
```

Refresh it in an effect on mount and after settings interactions if needed.

**Step 2: Extend onSettingsChange to preserve nested completion settings immutably**

Update the merge logic so both `idlePolicy` and `completionNotifications` stay cloned:

```ts
completionNotifications: patch.completionNotifications
  ? { ...settingsDraft.completionNotifications, ...patch.completionNotifications }
  : settingsDraft.completionNotifications
```

**Step 3: Thread permission status into Settings props**

Pass a display-ready label/value to the Settings component.

**Step 4: Add the new controls to the General settings card**

Add two rows near other general runtime behaviors:

1. completion notifications enabled toggle
2. only notify in background toggle
3. permission status readout

Example toggle wiring:

```tsx
<input
  type="checkbox"
  checked={settingsDraft.completionNotifications.enabled}
  onChange={() => onSettingsChange({
    completionNotifications: {
      enabled: !settingsDraft.completionNotifications.enabled,
    },
  })}
/>
```

And:

```tsx
<input
  type="checkbox"
  checked={settingsDraft.completionNotifications.onlyWhenBackground}
  onChange={() => onSettingsChange({
    completionNotifications: {
      onlyWhenBackground: !settingsDraft.completionNotifications.onlyWhenBackground,
    },
  })}
/>
```

**Step 5: Add permission status copy**

Render a read-only row like:

```tsx
<strong>{t("notificationPermission")}</strong>
<span>{permissionStatusLabel}</span>
```

Use translator keys for the state text.

**Step 6: Run build**

Run: `pnpm build:web`
Expected: PASS

**Step 7: Manual UI check**

Run: `pnpm dev`
Expected: Settings page shows the two toggles and a permission status value, and changing the toggles persists after reload.

**Step 8: Commit**

```bash
git add apps/web/src/features/settings/SettingsScreen.tsx apps/web/src/components/Settings/Settings.tsx apps/web/src/types/app.ts
git commit -m "feat: add reminder controls to settings"
```

---

### Task 4: Add the bundled reminder sound asset

**Files:**
- Create: `apps/web/src/assets/task-complete.wav` (or `.mp3`/`.ogg` if you already have a preferred short asset)
- Modify: `apps/web/src/features/workspace/WorkspaceScreen.tsx`
- Test: verify with `pnpm build:web`

**Step 1: Add the audio file**

Use a short bundled asset checked into the repo at:

```text
apps/web/src/assets/task-complete.wav
```

Keep it brief and low-noise.

**Step 2: Import the asset into WorkspaceScreen**

Use Vite asset handling:

```ts
import completionReminderSoundUrl from "../../assets/task-complete.wav";
```

**Step 3: Create a stable audio instance**

Inside `WorkspaceScreen`, create a ref:

```ts
const completionReminderAudioRef = useRef<HTMLAudioElement | null>(null);
```

Initialize/cleanup in an effect:

```ts
useEffect(() => {
  completionReminderAudioRef.current = new Audio(completionReminderSoundUrl);
  completionReminderAudioRef.current.preload = "auto";
  return () => {
    completionReminderAudioRef.current = null;
  };
}, []);
```

**Step 4: Run build**

Run: `pnpm build:web`
Expected: PASS and asset included in build output.

**Step 5: Commit**

```bash
git add apps/web/src/assets/task-complete.wav apps/web/src/features/workspace/WorkspaceScreen.tsx
git commit -m "feat: bundle task completion sound"
```

---

### Task 5: Track browser visibility/focus and add workspace-session navigation hook

**Files:**
- Modify: `apps/web/src/features/workspace/WorkspaceScreen.tsx:1033-1235, 1380-1405, 2345-2371`
- Test: verify with `pnpm build:web`

**Step 1: Add visibility/focus state**

Inside `WorkspaceScreen`, add state:

```ts
const [isWindowFocused, setIsWindowFocused] = useState(() =>
  typeof document !== "undefined" ? document.hasFocus() : true
);
const [isDocumentVisible, setIsDocumentVisible] = useState(() =>
  typeof document === "undefined" ? true : document.visibilityState === "visible"
);
```

**Step 2: Wire browser event listeners**

Add an effect listening to:
- `window.focus`
- `window.blur`
- `document.visibilitychange`

Update the two state values immutably.

**Step 3: Reuse the existing cross-workspace session switcher**

Use `onSwitchWorkspaceSession(tabId, sessionId)` as the callback for notification clicks instead of inventing a new navigation path.

**Step 4: Add a reminder handler closure in WorkspaceScreen**

Create a function shaped like:

```ts
const onCompletionReminder = useCallback(async (target: CompletionReminderTarget) => {
  ...
}, [appSettings.completionNotifications, state.activeTabId, state.tabs]);
```

It should:
- return if reminders are disabled
- compute current active workspace/session from `stateRef.current`
- compute background-ness using helper
- if `onlyWhenBackground` is true and current case is not background, return
- play sound for background cases
- send notification with title/body
- on click, call `onSwitchWorkspaceSession(target.workspaceId, target.sessionId)`

**Step 5: Pass the callback into session actions**

When calling `createWorkspaceSessionActions`, pass the handler and any needed inputs.

**Step 6: Run build**

Run: `pnpm build:web`
Expected: PASS

**Step 7: Commit**

```bash
git add apps/web/src/features/workspace/WorkspaceScreen.tsx
git commit -m "feat: add workspace reminder runtime handling"
```

---

### Task 6: Wire reminders into the turn-completed session flow

**Files:**
- Modify: `apps/web/src/features/workspace/session-actions.ts:42-68, 401-444`
- Modify: `apps/web/src/features/workspace/workspace-sync-hooks.ts:200-266` (only if needed to pass a completion-specific flag)
- Test: verify with `pnpm build:web`

**Step 1: Extend the session-actions factory args**

Add an optional callback contract:

```ts
onCompletionReminder?: (target: {
  workspaceId: string;
  workspaceTitle: string;
  sessionId: string;
  sessionTitle: string;
}) => void | Promise<void>;
```

**Step 2: Invoke the callback only for task completion behavior**

In `markSessionIdle`, after local/session sync and after reading `updatedTab` / `updatedSession`, keep the existing toast logic. Then add:

```ts
if (!note && session.status !== "idle") {
  void onCompletionReminder?.({
    workspaceId: updatedTab.id,
    workspaceTitle: updatedTab.title,
    sessionId,
    sessionTitle: updatedSession.title,
  });
}
```

Why `!note`: `settleSessionAfterExit` passes `agentExited`, and V1 should not notify for that path.

**Step 3: Do not change the `turn_completed` event contract**

Keep `workspace-sync-hooks.ts` behavior intact:

```ts
if (kind === "turn_completed") {
  void markSessionIdleRef.current(workspace_id, session_id);
}
```

Expected result: only `turn_completed` enters the reminder path; `session_ended` and `agentExited` do not.

**Step 4: Run build**

Run: `pnpm build:web`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/web/src/features/workspace/session-actions.ts apps/web/src/features/workspace/workspace-sync-hooks.ts
git commit -m "feat: trigger reminders for completed tasks"
```

---

### Task 7: Verify the feature end-to-end in the browser

**Files:**
- Modify: none unless bugs are found
- Test manually in running app

**Step 1: Start the app**

Run: `pnpm dev`
Expected: Vite dev server starts successfully.

**Step 2: Verify settings persistence**

In Settings:
- enable/disable completion notifications
- toggle only-background mode
- reload the page

Expected: settings remain persisted.

**Step 3: Verify foreground completion**

Complete a task in the currently visible active session.

Expected:
- no system notification
- no sound
- existing foreground behavior remains normal

**Step 4: Verify background completion for another session**

Switch away from a running session and let it complete.

Expected:
- in-app toast appears
- browser notification appears if permission granted
- bundled sound plays

**Step 5: Verify hidden-tab or unfocused-window completion**

Hide the tab or unfocus the browser and let a task complete.

Expected:
- notification appears if permission granted
- sound plays

**Step 6: Verify denied-permission fallback**

Deny browser notification permission and repeat a background completion.

Expected:
- no browser notification
- sound still plays
- Settings shows `Not enabled`

**Step 7: Verify notification click routing**

Click a system notification from a different workspace/session.

Expected:
- browser focuses
- app switches to the correct workspace
- app switches to the correct session

**Step 8: Run production build once more**

Run: `pnpm build:web`
Expected: PASS

**Step 9: Commit**

```bash
git add -u
git commit -m "test: verify task completion reminders"
```

---

### Task 8: Final review and simplification pass

**Files:**
- Review: all touched web reminder files
- Test: `pnpm build:web`

**Step 1: Read every touched file and remove accidental complexity**

Check for:
- duplicated background checks
- mutable settings updates
- notification logic leaking into unrelated code
- extra branches not needed for V1

**Step 2: Re-run the production build**

Run: `pnpm build:web`
Expected: PASS

**Step 3: Review against product rules**

Confirm:
- only `turn_completed` triggers reminders
- no foreground sound
- no extra settings beyond the agreed minimum
- permission denied still yields sound-only fallback
- click navigates to workspace + session

**Step 4: Commit**

```bash
git add -u
git commit -m "refactor: simplify completion reminder flow"
```
