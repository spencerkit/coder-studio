# Session Status Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify session state so runtime status only models `idle`, `running`, and `interrupted`, while archive remains a separate dimension rendered as `archived` in the UI.

**Architecture:** Keep lifecycle events and runtime state separate. Local runtime actions own `running` and `interrupted`, provider hooks only drive `turn_completed -> idle`, and archive continues to use `archived_at`/`archived` rather than a runtime enum value.

**Tech Stack:** Rust backend, TypeScript/React frontend, node:test, existing workspace/session HTTP and WS flows

---

### Task 1: Replace Shared Status Vocabulary

**Files:**
- Modify: `apps/server/src/models.rs`
- Modify: `apps/server/src/infra/time.rs`
- Modify: `apps/web/src/state/workbench-core.ts`
- Modify: `apps/web/src/types/app.ts`
- Test: `tests/session-status-display.test.ts`

- [ ] Remove `background`, `waiting`, `suspended`, and `queued` from the shared session status type definitions.
- [ ] Keep runtime status aligned across Rust and TypeScript as `idle | running | interrupted`.
- [ ] Preserve archive metadata as a separate field set instead of folding it into runtime status.
- [ ] Update any serializer or label helpers that still assume removed statuses exist.

### Task 2: Rewire Server Status Ownership

**Files:**
- Modify: `apps/server/src/services/session_runtime.rs`
- Modify: `apps/server/src/services/provider_hooks.rs`
- Modify: `apps/server/src/services/terminal.rs`
- Modify: `apps/server/src/services/agent.rs`
- Modify: `apps/server/src/infra/db.rs`
- Modify: `apps/server/src/services/workspace.rs`
- Test: `apps/server/src/command/http.rs`

- [ ] Change runtime boot so a started session enters `idle`, not `running`.
- [ ] Change user-send paths so sending input marks the session `running`.
- [ ] Change shell/runtime exit handling to mark sessions `interrupted`.
- [ ] Restrict provider-hook-driven status sync so only `turn_completed` writes `idle`; all other lifecycle events remain events only.
- [ ] Remove queue/background-specific persistence logic and replace any bootstrap recovery that still scans those statuses.

### Task 3: Rewire Frontend Display And Archive Semantics

**Files:**
- Modify: `apps/web/src/shared/utils/session.ts`
- Modify: `apps/web/src/features/workspace/workspace-sync-hooks.ts`
- Modify: `apps/web/src/features/workspace/session-actions.ts`
- Modify: `apps/web/src/features/app/WorkbenchRuntimeCoordinator.tsx`
- Modify: `apps/web/src/features/workspace/workspace-tabs.ts`
- Modify: `apps/web/src/features/agents/AgentWorkspaceFeature.tsx`
- Modify: `apps/web/src/components/HistoryDrawer/HistoryDrawer.tsx`
- Modify: `apps/web/src/features/workspace/session-history.ts`
- Modify: `apps/web/src/i18n.ts`
- Modify: `apps/web/src/styles/app.css`

- [ ] Remove background-display rewriting and make visible runtime status equal to stored runtime status.
- [ ] Render archived records using their archive dimension, not runtime status.
- [ ] Update badges, dots, and any copy so runtime cards only show `idle`, `running`, or `interrupted`, while history shows archived/live/detached from archive metadata.
- [ ] Keep completion reminder behavior based on window/session visibility, not the removed `background` status.

### Task 4: Red-Green Verification

**Files:**
- Modify: `tests/session-header-tag.test.ts`
- Modify: `tests/session-history.test.ts`
- Modify: `tests/workspace-runtime-controller.test.ts`
- Modify: `tests/workspace-session-runtime-sync.test.ts`
- Modify: `tests/session-status-display.test.ts`
- Modify: `tests/e2e/transport.spec.ts`

- [ ] Write or update focused tests for the new status semantics before changing implementation.
- [ ] Verify red on the affected tests.
- [ ] Implement the minimal code changes to satisfy the new expectations.
- [ ] Re-run the focused tests and any directly impacted server/web test targets.
