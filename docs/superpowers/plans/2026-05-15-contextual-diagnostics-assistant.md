# Contextual Diagnostics Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a quiet `/diagnostics` recovery surface that stays out of healthy flows, is manually reachable from Settings, and preserves workspace/session intent when a blocking issue is detected.

**Architecture:** Keep the server-side readiness checks behind `diagnostics.get` and `diagnostics.recheck`, then add a small web feature that reads contextual route params, renders a full environment report with contextual emphasis, and resumes the original action when recovery conditions are met. Redirect into this page only from explicit friction points: failed workspace open, blocked provider/session launch, and manual Settings entry.

**Tech Stack:** React, React Router, Jotai, Vitest, existing websocket command dispatch, shared UI primitives.

---

### Task 1: Route And Navigation Surface

**Files:**
- Create: `packages/web/src/features/diagnostics/index.tsx`
- Create: `packages/web/src/features/diagnostics/navigation.ts`
- Modify: `packages/web/src/shells/desktop-shell.tsx`
- Modify: `packages/web/src/shells/mobile-shell/index.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.tsx`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`
- Test: `packages/web/src/shells/desktop-shell.test.tsx`
- Test: `packages/web/src/shells/mobile-shell/index.test.tsx`
- Test: `packages/web/src/features/settings/components/settings-page.test.tsx`

- [x] Add failing route/access tests for `/diagnostics` on desktop and mobile shells plus a Settings-driven manual entry.
- [x] Implement a small diagnostics route model with `context`, optional `workspaceId`, optional `workspacePath`, optional `providerId`, and client-only continuation metadata such as `paneId` / `launchMode`.
- [x] Register `/diagnostics` in both shells and bypass auth-loading chrome for that route the same way `/settings` is handled today.
- [x] Add a manual Diagnostics entry from Settings.
- [x] Add localized labels and copy for the new route, section copy, issue labels, and continuation buttons.

### Task 2: Recovery Redirects

**Files:**
- Modify: `packages/web/src/features/workspace/actions/use-workspace-launch-actions.ts`
- Modify: `packages/web/src/features/workspace/views/shared/workspace-launch-modal.test.tsx`
- Create: `packages/web/src/features/agent-panes/actions/use-provider-launcher.test.tsx`
- Modify: `packages/web/src/features/agent-panes/actions/use-provider-launcher.ts`

- [x] Add a failing workspace-launch test that expects a failed `workspace.open` to redirect to `/diagnostics` with the selected path preserved.
- [x] Add a failing provider-launch test that expects blocked session startup to redirect to `/diagnostics` with `workspaceId`, `providerId`, and pane continuation metadata preserved.
- [x] Redirect workspace-open failures to diagnostics instead of only surfacing inline error text.
- [x] Redirect blocked or high-risk session launches to diagnostics instead of trapping the user in the launcher when the provider cannot continue safely.

### Task 3: Diagnostics Page Behavior

**Files:**
- Modify: `packages/core/src/domain/diagnostics.ts`
- Modify: `packages/server/src/commands/diagnostics.ts`
- Create: `packages/web/src/features/diagnostics/index.test.tsx`
- Create: `packages/web/src/features/diagnostics/index.tsx`
- Modify: `packages/web/src/styles/components.css`

- [x] Add failing diagnostics-page tests for initial load, recheck, workspace continuation, and session continuation after recovery.
- [x] Extend diagnostics DTOs only where needed for user-facing repair actions, such as install support metadata for provider issues.
- [x] Render a compact diagnostics page with contextual header copy, a full issue list with contextual emphasis, a recheck action, and a continuation action that stays tied to the original intent.
- [ ] Support product-owned repair where it already exists: poll provider install jobs from diagnostics, refresh checks, and then continue session creation when ready.
- [x] Preserve intent on continue: open the workspace and update workspace atoms for `workspace_open`; create the session, persist the last-viewed target, and restore pane assignment or replacement for `session_start`.

### Task 4: Verification

**Files:**
- Test: `packages/server/src/__tests__/diagnostics-commands.test.ts`
- Test: `packages/web/src/features/diagnostics/index.test.tsx`
- Test: `packages/web/src/features/agent-panes/actions/use-provider-launcher.test.tsx`
- Test: `packages/web/src/features/workspace/views/shared/workspace-launch-modal.test.tsx`
- Test: `packages/web/src/features/settings/components/settings-page.test.tsx`
- Test: `packages/web/src/shells/desktop-shell.test.tsx`
- Test: `packages/web/src/shells/mobile-shell/index.test.tsx`

- [x] Run the server diagnostics command test to confirm the command contract still passes.
- [x] Run the focused web tests that cover route access, manual entry, workspace redirect, provider redirect, and diagnostics continuation.
- [x] Run one combined web command for the touched suites and fix any regressions before closing the work.

## Status

Mostly complete in this worktree.

Completed:

- diagnostics route, contextual navigation model, localized copy, desktop/mobile shell registration
- manual diagnostics entry from Settings
- workspace-open fallback into diagnostics with preserved path
- blocked session-start fallback into diagnostics with preserved workspace/provider/pane intent
- diagnostics recheck plus continuation for `workspace_open`, `session_start`, and phone handoff checks
- server command contract and focused regression coverage

Not implemented from this draft:

- diagnostics-owned provider install polling and continuation remains unimplemented

Note:

- the current Settings UX exposes Diagnostics as its own Settings section rather than a low-emphasis link inside General
