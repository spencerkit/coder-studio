# Mobile Agent Provider Compact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the redundant mobile provider description line for launch-ready agents and slightly tighten the mobile provider list spacing without changing desktop behavior.

**Architecture:** Keep the change inside the existing `MobileAgentSheet` data mapping and the mobile command sheet stylesheet. Launch-ready providers omit the default description, while providers with guidance continue to populate it. Add one agent-sheet-specific class to scope density changes to this view only.

**Tech Stack:** React, TypeScript, Vitest, CSS tokens

---

### Task 1: Lock the desired mobile behavior with tests

**Files:**
- Modify: `packages/web/src/features/workspace/views/mobile/mobile-agent-sheet.test.tsx`
- Modify: `packages/web/src/styles/components.theme.test.ts`

- [ ] **Step 1: Write the failing component expectation**

Add assertions proving launch-ready providers do not render `Start Codex session` while still rendering `Start new session`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @coder-studio/web exec vitest run src/features/workspace/views/mobile/mobile-agent-sheet.test.tsx src/styles/components.theme.test.ts`

Expected: the component test still finds the removed default description and the theme test cannot find the new agent-sheet compact selector.

### Task 2: Implement the mobile-only compaction

**Files:**
- Modify: `packages/web/src/features/workspace/views/mobile/mobile-agent-sheet.tsx`
- Modify: `packages/web/src/styles/components.css`

- [ ] **Step 1: Omit the default provider description**

Set the provider item description to `guideMessage` only, leaving launch-ready providers with no description line.

- [ ] **Step 2: Scope density styles to the mobile agent sheet**

Add an agent-sheet class to `MobileSelectSheet` and tighten only its row padding and copy gap.

### Task 3: Verify the result

**Files:**
- Test: `packages/web/src/features/workspace/views/mobile/mobile-agent-sheet.test.tsx`
- Test: `packages/web/src/styles/components.theme.test.ts`

- [ ] **Step 1: Run focused verification**

Run: `pnpm --filter @coder-studio/web exec vitest run src/features/workspace/views/mobile/mobile-agent-sheet.test.tsx src/styles/components.theme.test.ts`

Expected: PASS with all tests green.
