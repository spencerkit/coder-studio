# Welcome Page Environment Entry Design

**Date:** 2026-08-08
**Status:** Approved direction, pending implementation plan

## Problem

The Windows Desktop environment selector is currently rendered inside `TopBar`, and `TopBar` only exists on the `/workspace` route. When the user has not opened a workspace, `DesktopShell` renders `WelcomePage` instead, so the Local/WSL environment entry disappears completely.

The selector is a window-level runtime control, not a workspace-level control. Hiding it until a workspace exists makes the control hard to discover and prevents users from choosing the filesystem/runtime context before browsing for a project.

## Goals

- Make the active Desktop environment visible before a workspace is selected.
- Allow users to open or focus another environment from the welcome page.
- Keep opening a workspace as the primary, non-blocking welcome-page action.
- Preserve the existing compact selector in the workspace top bar.
- Keep launch progress visible after the selector popover closes, and allow progress details to be reopened.
- Provide an inline recovery path when opening another environment fails.
- Describe the multi-window behavior accurately.

## Non-goals

- Do not require users to select an environment before opening a workspace.
- Do not migrate an open workspace between Local and WSL.
- Do not merge recent workspace histories across environments.
- Do not redesign the environment discovery, installation, or Desktop IPC protocols.
- Do not add this control to mobile, browser-only, or non-Windows experiences.
- Do not introduce a new global application top bar on the welcome page.

## Chosen Direction

Use a welcome-page environment context row inside the first workflow card, immediately before the primary **Open Workspace** action.

The first workflow card will contain, in order:

1. Step label and icon.
2. “Open your project folder” title and supporting copy.
3. A secondary environment context row.
4. The existing primary **Open Workspace** button.

The context row shows:

- A Monitor icon for Local or Terminal icon for WSL.
- The eyebrow label **Current window environment**.
- The active environment label, such as **Local: Windows** or **WSL: Ubuntu**.
- The secondary action **Open another environment** with a disclosure affordance.

The environment row is visually subordinate to the primary workspace button. It uses the existing panel/input surface tokens, a compact height, and the same icon language as the workspace selector. It must not resemble another primary call to action.

On non-Windows or when the Desktop bridge is unavailable, the entire context row is omitted and the existing welcome layout remains unchanged.

## Interaction Semantics

The wording must describe the actual behavior: selecting another environment opens or focuses another environment window. Avoid **Switch environment**, which suggests that the current window and its workspace will be migrated in place.

The normal interaction is:

1. The welcome page loads with the current environment already selected.
2. The user may ignore the environment row and open a workspace immediately.
3. Activating **Open another environment** opens the existing environment popover.
4. Selecting an available environment starts the existing Desktop launch flow.
5. Closing the popover does not cancel the launch.
6. Activating the environment row again while a launch is pending reopens the popover and its progress details.

The existing workspace top-bar trigger retains its current compact appearance and behavior.

## States and Feedback

### Loading environment data

Render the welcome context row at a stable height with a subtle spinner and a localized “Checking environments…” label. Do not shift the primary workspace button when data arrives.

### Ready

Show the active environment and the **Open another environment** action. Opening a workspace remains available.

### Opening another environment

Keep the current window usable. Replace the context-row eyebrow and trailing disclosure with an indeterminate spinner and a localized message such as **Opening WSL: Ubuntu…**. The row remains interactive so the user can reopen the popover and inspect detailed progress.

Do not display a determinate 100% bar while waiting for the new window to become ready. The existing indeterminate progress behavior remains the source of truth.

### Open failure

Show a concise inline error state without disabling **Open Workspace**. Provide a visible **Retry** action for the last failed target and keep the environment selector reachable so the user may choose a different target. The detailed error remains available in the popover through its existing alert treatment.

### Success

Clear the pending state after the target environment reports ready. The current window retains its own active-environment identity because the target opens or focuses a separate window.

## Component Architecture

The environment selector is no longer top-bar-specific, so move its ownership to a shared Desktop-environment feature rather than importing a top-bar component into the welcome feature.

Recommended structure:

```text
packages/web/src/features/desktop-environment/
  components/environment-switcher.tsx
  components/environment-switcher.module.css
  components/environment-switcher.test.tsx
  index.ts
```

`EnvironmentSwitcher` accepts a visual variant:

- `topbar`: preserves the current compact trigger.
- `welcome`: renders the context-row trigger and its inline loading/error/retry states.

Both variants share the same environment refresh, progress subscription, target-opening, retry, popover content, and error handling. Only one variant is mounted on a route at a time, so no new global state store is required.

Consumers:

- `TopBar` renders `EnvironmentSwitcher` with the `topbar` variant.
- `WelcomePage` renders the `welcome` variant inside the first workflow card when the Desktop Windows bridge is available.

The existing `window.coderStudioDesktop` API remains unchanged.

## Data Flow

1. The mounted selector reads `window.coderStudioDesktop`.
2. On Windows Desktop, it requests the environment list and active environment in parallel.
3. It subscribes to environment progress events.
4. The selected target is passed to `openEnvironment(environment.id)`.
5. Progress events update both the popover detail and the mounted trigger variant.
6. A successful response clears pending progress and closes the popover.
7. A failed response records the failed target, displays the inline error, and enables retry.

Closing the popover changes presentation only; it does not clear `openingId`, progress, the failed target, or the in-flight request.

## Styling and Responsive Behavior

- Reuse semantic surface, border, text, focus, and status tokens; do not add raw colors.
- Preserve the existing 4/8px spacing rhythm and welcome-card radius language.
- Keep the environment row height stable across ready, loading, and error states.
- Truncate long distribution labels with an ellipsis and expose the full label through accessible text or a tooltip.
- At narrow desktop widths, shorten the trailing label before allowing the environment name to become unreadable.
- The mobile welcome layout and mobile shell are unchanged.
- Motion is limited to the existing spinner and short hover/focus transitions; reduced-motion settings must be respected.

## Accessibility

- The context row is keyboard reachable before the primary workspace action.
- The trigger has a localized accessible name that includes the active environment.
- Loading and failure messages use a polite live region; errors use alert semantics only when newly raised.
- The retry control has a target-specific accessible label.
- Monitor/Terminal/spinner icons are decorative when equivalent text is present.
- Focus remains predictable when the popover opens, closes, succeeds, or fails.
- The context row and retry action retain visible focus indicators and meet contrast requirements in both themes.

## Localization

Add English and Chinese strings for:

- Current window environment
- Open another environment
- Checking environments
- Opening a named environment
- Failed to open a named environment
- Retry opening a named environment

Reuse existing environment labels, status strings, and detailed progress messages where possible.

## Testing

### Component tests

- Both `topbar` and `welcome` variants render the active Local and WSL environment correctly.
- Non-Windows and missing Desktop bridge cases render nothing.
- The welcome variant exposes **Open another environment** without disabling the workspace action.
- Selecting another environment invokes the Desktop API with the correct ID.
- Closing and reopening the popover during launch preserves and displays progress.
- Indeterminate window-opening progress remains indeterminate.
- Failure leaves the welcome page usable and exposes retry.
- Retry invokes the failed target again and clears stale error feedback.
- Success clears pending state without changing the current window label.

### Welcome and top-bar integration tests

- The first welcome workflow card contains the environment context before **Open Workspace** on Windows Desktop.
- The existing primary action still opens `WorkspaceLaunchModal` directly.
- The welcome page remains unchanged in mobile/browser/non-Windows contexts.
- The top-bar selector retains its existing compact trigger and behavior.
- English and Chinese labels render correctly.

### Manual Windows verification

- Start with no workspace in Local and WSL windows.
- Open the environment popover from the welcome page.
- Start an environment launch, close the popover, and reopen it while loading.
- Verify successful launch/focus, timeout messaging, failure, and retry.
- Confirm that **Open Workspace** remains usable throughout failure states.
- Check keyboard navigation, focus restoration, narrow desktop widths, and both themes.

## Risks and Mitigations

- **Semantic confusion:** Users may think the current workspace moves between environments. Mitigate with **Current window environment** and **Open another environment** copy.
- **Duplicated behavior between triggers:** Keep one shared component and vary only the trigger presentation.
- **Layout growth in the first workflow card:** Use a compact row and retain the existing primary-button hierarchy.
- **State loss when the popover closes:** Keep launch state in the mounted selector rather than the popover content.
- **Desktop-only test gaps on Linux:** Cover state and rendering in unit tests, then perform final launch/focus acceptance on Windows.
