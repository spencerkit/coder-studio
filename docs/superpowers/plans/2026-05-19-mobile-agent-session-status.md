# Mobile Agent Session Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each mobile agent session's current state in the session list so users can see whether it is running or idle at a glance.

**Architecture:** Reuse the existing `Session.state` data already available in `MobileAgentSheet`. Keep the change local to the mobile agent sheet and the shared mobile select list, so the session list keeps its current layout while the meta line becomes `PROVIDER · STATE`.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, Jotai, existing i18n strings.

---

### Task 1: Update the mobile agent session list presentation

**Files:**
- Modify: `packages/web/src/features/workspace/views/mobile/mobile-agent-sheet.tsx`
- Modify: `packages/web/src/features/workspace/views/mobile/mobile-agent-sheet.test.tsx`

- [ ] **Step 1: Write the failing test**

Add a test that renders one running session and one idle session, then asserts the list items expose both the provider label and the translated session state in the meta text.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `pnpm vitest packages/web/src/features/workspace/views/mobile/mobile-agent-sheet.test.tsx -t "renders session state in the mobile agent list"`
Expected: FAIL because the meta text still only shows the provider name.

- [ ] **Step 3: Write the minimal implementation**

Update the session mapping so `meta` becomes `CLAUDE · Running` / `CODEX · Idle` by combining `session.providerId.toUpperCase()` with `t("session.state.<state>")`.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `pnpm vitest packages/web/src/features/workspace/views/mobile/mobile-agent-sheet.test.tsx -t "renders session state in the mobile agent list"`
Expected: PASS.

- [ ] **Step 5: Run the related test file**

Run: `pnpm vitest packages/web/src/features/workspace/views/mobile/mobile-agent-sheet.test.tsx`
Expected: PASS.

