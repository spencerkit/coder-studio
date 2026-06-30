# Local Desktop Smoke Runtime Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local desktop smoke-test flow that launches the desktop shell with a preseeded local runtime, and allow the desktop runtime release index URL to be controlled from persisted config.

**Architecture:** Extend the shared CLI/desktop config shape with a desktop runtime release index URL, factor desktop startup resolution into small helpers, and add a standalone smoke-test script that seeds an isolated runtime-store before launching Electron. The default managed runtime startup path remains unchanged unless the new local smoke-test env/config is used.

**Tech Stack:** TypeScript, Vitest, Electron, pnpm, Node filesystem/process APIs

---

### Task 1: Add failing config and startup tests

**Files:**
- Modify: `packages/cli/src/config-store.test.ts`
- Modify: `packages/desktop/src/desktop-config.test.ts`
- Modify: `packages/desktop/src/desktop-startup.test.ts`

- [ ] **Step 1: Add failing config-store coverage for `desktopRuntimeReleaseIndexUrl`**
- [ ] **Step 2: Run `pnpm exec vitest run packages/cli/src/config-store.test.ts` and confirm failure**
- [ ] **Step 3: Add failing desktop-config coverage for the new persisted field**
- [ ] **Step 4: Run `pnpm exec vitest run packages/desktop/src/desktop-config.test.ts` and confirm failure**
- [ ] **Step 5: Add failing desktop-startup coverage for `env -> config -> default` precedence**
- [ ] **Step 6: Run `pnpm exec vitest run packages/desktop/src/desktop-startup.test.ts` and confirm failure**

### Task 2: Add failing desktop userData override and smoke-script tests

**Files:**
- Create: `packages/desktop/src/user-data-env.test.ts`
- Create: `scripts/desktop-smoke-local.test.ts`

- [ ] **Step 1: Add failing desktop user-data env coverage**
- [ ] **Step 2: Run `pnpm exec vitest run packages/desktop/src/user-data-env.test.ts` and confirm failure**
- [ ] **Step 3: Add failing smoke-script coverage for seeded runtime-store and Electron launch env**
- [ ] **Step 4: Run `pnpm exec vitest run --config scripts/vitest.config.ts scripts/desktop-smoke-local.test.ts` and confirm failure**

### Task 3: Implement persisted config and desktop runtime release index resolution

**Files:**
- Modify: `packages/cli/src/config-store.ts`
- Modify: `packages/desktop/src/desktop-config.ts`
- Modify: `packages/desktop/src/desktop-startup.ts`

- [ ] **Step 1: Add the new config field to the CLI config store**
- [ ] **Step 2: Surface the persisted field through desktop launch config**
- [ ] **Step 3: Resolve desktop runtime release index URL with env/config/default precedence**
- [ ] **Step 4: Run `pnpm exec vitest run packages/cli/src/config-store.test.ts packages/desktop/src/desktop-config.test.ts packages/desktop/src/desktop-startup.test.ts`**

### Task 4: Implement userData override and local smoke-test script

**Files:**
- Create: `packages/desktop/src/user-data-env.ts`
- Modify: `packages/desktop/src/main.ts`
- Create: `scripts/desktop-smoke-local.ts`
- Modify: `package.json`

- [ ] **Step 1: Add a small helper for `CODER_STUDIO_DESKTOP_USER_DATA_DIR` resolution**
- [ ] **Step 2: Wire Electron main to apply the override before startup**
- [ ] **Step 3: Implement the smoke-test script that builds, seeds runtime-store, and launches Electron**
- [ ] **Step 4: Add the root npm script entry**
- [ ] **Step 5: Run `pnpm exec vitest run packages/desktop/src/user-data-env.test.ts --config scripts/vitest.config.ts scripts/desktop-smoke-local.test.ts`**

### Task 5: Final verification and integration

**Files:**
- Verify only

- [ ] **Step 1: Run `pnpm exec vitest run packages/cli/src/config-store.test.ts packages/desktop/src/desktop-config.test.ts packages/desktop/src/desktop-startup.test.ts packages/desktop/src/user-data-env.test.ts`**
- [ ] **Step 2: Run `pnpm exec vitest run --config scripts/vitest.config.ts scripts/desktop-smoke-local.test.ts scripts/build-desktop.test.ts`**
- [ ] **Step 3: Run `git diff --check`**
- [ ] **Step 4: Commit with a focused message**
