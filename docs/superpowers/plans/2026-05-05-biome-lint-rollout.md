# Biome Lint Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stabilize the repository's existing Biome-based lint/format workflow, connect it to CI and Git hooks without immediately blocking on historical debt, then clean the current diagnostics in staged batches.

**Architecture:** Keep Biome as the single root-level quality tool. Phase 1 tightens the root config and command surface without changing rule severity strategy. Phase 2 wires quality checks into GitHub Actions and Husky using changed/staged-file flows so automation is useful before the codebase is clean. Phase 3 removes the current diagnostics in clusters: first low-risk unused variables, then concentrated `noExplicitAny` groups in server tests, web tests, and remaining production boundary code.

**Tech Stack:** pnpm workspaces, Biome 2.4.14, GitHub Actions, Husky 9.1.7, TypeScript, Vitest, Playwright.

---

## File Structure

- Modify: `biome.jsonc` — align schema version, set `vcs.defaultBranch`, tighten file scanning, preserve current lint severity posture.
- Modify: `package.json` — add `lint:fix`, add `check`, add `prepare` for Husky installation, add Husky devDependency during automation phase.
- Modify: `README.md` — document contributor quality commands and expected usage.
- Create: `.github/workflows/quality.yml` — quality workflow for PR/push validation.
- Modify: `.github/workflows/release.yml` — switch the release workflow to the same stable quality entrypoint only after the new commands exist.
- Create: `.husky/pre-commit` — run Biome on staged files with write mode.
- Optionally create later: `.husky/pre-push` — only if Phase 2 verification shows push-time checks are cheap enough.
- Modify: `e2e/specs/*.spec.ts` — clear low-risk unused variable warnings and the single explicit-any in quality specs.
- Modify: `packages/cli/src/pm2-control.ts` — remove the one unused catch binding.
- Modify: `packages/server/src/git/cli.ts`, `packages/server/src/app.ts`, `packages/server/src/config.ts`, `packages/server/src/session/manager.ts`, `packages/server/src/terminal/pty-host.ts`, `packages/server/src/ws/hub.ts`, `packages/server/src/commands/fencing.ts` — remove remaining production `noExplicitAny` and `noUnusedVariables` issues.
- Modify: `packages/server/src/__tests__/*.test.ts`, `packages/server/src/supervisor/*.test.ts`, `packages/server/src/terminal/*.test.ts` — replace concentrated `as any` / `Record<string, any>` test patterns with narrow helper types.
- Modify: `packages/web/src/app/providers.tsx`, `packages/web/src/app/providers.test.tsx`, `packages/web/src/features/supervisor/components/supervisor-card.test.tsx`, `packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx`, `packages/web/src/features/settings/components/settings-page.tsx`, `packages/web/src/lib/i18n.ts` — reduce front-end test mock `any`s and clear remaining unused bindings.

### Task 1: Stabilize the Root Biome Baseline

**Files:**
- Modify: `biome.jsonc`
- Modify: `package.json`
- Test: root command line (`pnpm lint`, `pnpm lint:fix --help` equivalent through script, `pnpm format`, `pnpm check`)

- [ ] **Step 1: Write the failing baseline expectations**

Capture the current failures before editing:

- `pnpm lint` reports the schema mismatch in `biome.jsonc`
- `pnpm lint` emits an `internalError/fs` diagnostic for `bin/codex`
- `package.json` lacks `lint:fix`
- `package.json` lacks `check`

Record the intended end state:

- `biome.jsonc` uses the installed 2.4.14 schema
- `vcs.defaultBranch` is set to `main`
- file scanning excludes the `bin/codex` symlink through `files.includes`
- root scripts include:
  - `"lint": "biome lint ."`
  - `"lint:fix": "biome lint --write ."`
  - `"format": "biome format --write ."`
  - `"check": "biome check ."`

- [ ] **Step 2: Run the current lint command to verify the baseline is red**

Run: `pnpm lint`

Expected:

- output includes a schema version mismatch for `biome.jsonc`
- output includes `internalError/fs` for `bin/codex`
- output still shows the existing warnings after those meta-diagnostics

- [ ] **Step 3: Update `biome.jsonc` to the stable baseline**

Edit `biome.jsonc` so it keeps the current formatter/linter behavior but adds the missing baseline controls:

```jsonc
{
  "$schema": "https://biomejs.dev/schemas/2.4.14/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true,
    "defaultBranch": "main"
  },
  "files": {
    "ignoreUnknown": true,
    "includes": [
      "**",
      "!bin/codex"
    ]
  }
}
```

Keep the existing formatter, `javascript.formatter`, `html.formatter`, `assist`, and current warning-level lint rules intact. Do not introduce new rule groups or escalate warning severities in this task.

- [ ] **Step 4: Add the missing root scripts**

Update the root `package.json` scripts block to include:

```json
{
  "scripts": {
    "lint": "biome lint .",
    "lint:fix": "biome lint --write .",
    "format": "biome format --write .",
    "check": "biome check ."
  }
}
```

Do not add Husky or `prepare` yet in this task; that belongs to the automation phase.

- [ ] **Step 5: Run the baseline commands and verify the new contract**

Run:

```bash
pnpm lint
pnpm format --help
pnpm check --help
```

Expected:

- `pnpm lint` no longer reports the schema mismatch
- `pnpm lint` no longer reports `internalError/fs` for `bin/codex`
- `pnpm lint` may still report existing repository warnings
- `pnpm check --help` resolves because the script now exists

- [ ] **Step 6: Commit**

```bash
git add biome.jsonc package.json
git commit -m "chore: stabilize biome baseline commands"
```

### Task 2: Document the Root Quality Workflow for Contributors

**Files:**
- Modify: `README.md`
- Test: manual doc review against actual commands

- [ ] **Step 1: Write the failing documentation gap checklist**

Confirm that the current `README.md` contributor section does not mention:

- `pnpm lint`
- `pnpm lint:fix`
- `pnpm format`
- `pnpm check`

The new documentation must explain when to use each command and must not describe a non-existent CI or hook setup yet.

- [ ] **Step 2: Verify the gap in the current README**

Run: `rg -n "pnpm lint|lint:fix|pnpm format|pnpm check" README.md`

Expected: either no matches or incomplete matches that do not document contributor quality workflow.

- [ ] **Step 3: Update the contributor section in `README.md`**

Add a compact quality subsection under `## 开发`, for example:

```md
# 代码质量检查
pnpm lint

# 自动修复安全 lint 问题
pnpm lint:fix

# 统一格式化
pnpm format

# 聚合检查（格式、lint、imports）
pnpm check
```

Also keep the existing `pnpm dev`, `pnpm acceptance:phase1`, and `pnpm build:cli` examples intact.

- [ ] **Step 4: Review the README against real commands**

Run:

```bash
pnpm lint --help
pnpm lint:fix --help
pnpm format --help
pnpm check --help
```

Expected: each script resolves through `pnpm run` and the README text matches the actual command semantics.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: document biome quality workflow"
```

### Task 3: Add Non-Blocking Quality Automation in GitHub Actions

**Files:**
- Create: `.github/workflows/quality.yml`
- Modify: `.github/workflows/release.yml`
- Test: workflow YAML and local command parity

- [ ] **Step 1: Write the failing automation expectations**

Define the intended automation behavior before editing:

- repository has a dedicated quality workflow on `push` and `pull_request`
- workflow installs dependencies with Node 24 + pnpm
- workflow does not fail on the current warning backlog
- release workflow moves to an explicit Biome command with error-level semantics, without immediately failing on historical formatting debt

The first version must not run `pnpm check .` on the whole repository as a blocking step, because current `check` is red on formatting diagnostics across many files.

- [ ] **Step 2: Verify the current automation gap**

Run:

```bash
ls .github/workflows
sed -n '1,220p' .github/workflows/release.yml
```

Expected:

- only `release.yml` exists
- there is no dedicated quality workflow
- release still runs `pnpm lint`

- [ ] **Step 3: Create a changed-files quality workflow**

Create `.github/workflows/quality.yml` with:

- triggers:
  - `pull_request`
  - `push` on `main`
- Node 24 setup
- `corepack enable`
- `pnpm install --frozen-lockfile`
- quality command:

```bash
pnpm exec biome check --changed --since=origin/main --diagnostic-level=error --max-diagnostics=none .
```

This intentionally checks only changed files and only error-level diagnostics so the workflow is useful before historical warning cleanup is complete.

- [ ] **Step 4: Update release workflow to the same quality contract**

Replace the current release workflow lint step:

```yaml
- name: Lint
  run: pnpm lint
```

with:

```yaml
- name: Quality check
  run: pnpm exec biome lint --diagnostic-level=error --max-diagnostics=none .
```

This keeps release on an explicit full-repo Biome command while avoiding premature failure on repository-wide formatting debt. A later strictness review can promote release to `biome check` once formatting debt is cleared.

- [ ] **Step 5: Review workflow syntax and command parity**

Run:

```bash
sed -n '1,260p' .github/workflows/quality.yml
sed -n '1,260p' .github/workflows/release.yml
pnpm exec biome check --changed --since=origin/main --diagnostic-level=error --max-diagnostics=20 .
```

Expected:

- the new quality workflow exists and uses the changed-files command
- release workflow uses the full-repo `biome lint` error-level command
- the local changed-files command completes without tripping historical warnings outside the current branch diff

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/quality.yml .github/workflows/release.yml
git commit -m "ci: add biome quality workflow"
```

### Task 4: Add Husky Pre-Commit Checks for Staged Files

**Files:**
- Modify: `package.json`
- Create: `.husky/pre-commit`
- Test: `pnpm exec biome check --write --staged`

- [ ] **Step 1: Write the failing hook-install expectations**

The automation phase needs local enforcement, but only on staged files. The intended end state is:

- root `package.json` includes:
  - `"prepare": "husky"`
  - `"husky": "^9.1.7"` in `devDependencies`
- `.husky/pre-commit` exists
- pre-commit runs:

```bash
pnpm exec biome check --write --staged
```

- [ ] **Step 2: Verify Husky is not installed yet**

Run:

```bash
rg -n '"prepare": "husky"|husky' package.json pnpm-lock.yaml
ls -la .husky
```

Expected:

- no Husky dependency in the root package
- no `.husky` directory in the repository

- [ ] **Step 3: Add Husky to the root package**

Update `package.json` with:

```json
{
  "scripts": {
    "prepare": "husky"
  },
  "devDependencies": {
    "husky": "^9.1.7"
  }
}
```

Keep the existing quality scripts from Task 1 unchanged.

- [ ] **Step 4: Create the pre-commit hook**

Create `.husky/pre-commit` with:

```sh
pnpm exec biome check --write --staged
```

Do not add a `pre-push` hook in this task.

- [ ] **Step 5: Install dependencies and verify the staged-file hook command**

Run:

```bash
pnpm install
pnpm exec biome check --write --staged --no-errors-on-unmatched
```

Expected:

- `pnpm install` refreshes the lockfile with Husky
- the staged-file command succeeds when nothing is staged
- the repository now has a working `.husky/pre-commit`

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml .husky/pre-commit
git commit -m "chore: add husky biome pre-commit hook"
```

### Task 5: Clear the Low-Risk Unused Variable Diagnostics

**Files:**
- Modify: `e2e/specs/full-integration.spec.ts`
- Modify: `e2e/specs/phase4/quality.spec.ts`
- Modify: `e2e/specs/session-flow.spec.ts`
- Modify: `e2e/specs/session-hydrate-refresh.spec.ts`
- Modify: `e2e/specs/session-terminal-interaction.spec.ts`
- Modify: `e2e/specs/session-title-extraction.spec.ts`
- Modify: `packages/cli/src/pm2-control.ts`
- Modify: `packages/server/src/git/cli.ts`
- Modify: `packages/server/src/__tests__/session-integration.test.ts`
- Modify: `packages/server/src/__tests__/session-terminal-exit.test.ts`
- Modify: `packages/server/src/__tests__/workspace-repo.test.ts`
- Modify: `packages/server/src/terminal/ring-buffer.test.ts`
- Modify: `packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.tsx`
- Modify: `packages/web/src/lib/i18n.ts`
- Test: `pnpm exec biome lint <changed files>`

- [ ] **Step 1: Write the failing targeted lint command**

Create a file list for the known unused-variable diagnostics and run:

```bash
pnpm exec biome lint \
  e2e/specs/full-integration.spec.ts \
  e2e/specs/phase4/quality.spec.ts \
  e2e/specs/session-flow.spec.ts \
  e2e/specs/session-hydrate-refresh.spec.ts \
  e2e/specs/session-terminal-interaction.spec.ts \
  e2e/specs/session-title-extraction.spec.ts \
  packages/cli/src/pm2-control.ts \
  packages/server/src/git/cli.ts \
  packages/server/src/__tests__/session-integration.test.ts \
  packages/server/src/__tests__/session-terminal-exit.test.ts \
  packages/server/src/__tests__/workspace-repo.test.ts \
  packages/server/src/terminal/ring-buffer.test.ts \
  packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx \
  packages/web/src/features/settings/components/settings-page.tsx \
  packages/web/src/lib/i18n.ts
```

Expected: warnings for unused variables and unused catch bindings on this file set.

- [ ] **Step 2: Apply the minimal low-risk fixes**

For each file:

- delete truly unused locals where they serve no assertion purpose
- rename intentionally ignored values to `_name`
- change `catch (error)` to `catch (_error)` when the error is not read

Do not change test behavior or add suppressions in this task.

- [ ] **Step 3: Re-run the targeted lint command**

Run the same targeted `pnpm exec biome lint ...` command from Step 1.

Expected: no remaining `lint/correctness/noUnusedVariables` diagnostics on this file set.

- [ ] **Step 4: Commit**

```bash
git add e2e/specs/full-integration.spec.ts e2e/specs/phase4/quality.spec.ts e2e/specs/session-flow.spec.ts e2e/specs/session-hydrate-refresh.spec.ts e2e/specs/session-terminal-interaction.spec.ts e2e/specs/session-title-extraction.spec.ts packages/cli/src/pm2-control.ts packages/server/src/git/cli.ts packages/server/src/__tests__/session-integration.test.ts packages/server/src/__tests__/session-terminal-exit.test.ts packages/server/src/__tests__/workspace-repo.test.ts packages/server/src/terminal/ring-buffer.test.ts packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx packages/web/src/features/settings/components/settings-page.tsx packages/web/src/lib/i18n.ts
git commit -m "chore: clear low-risk unused-variable diagnostics"
```

### Task 6: Remove `noExplicitAny` from Server Test Dependency Builders

**Files:**
- Modify: `packages/server/src/__tests__/ws-hub.test.ts`
- Modify: `packages/server/src/__tests__/supervisor-manager.test.ts`
- Modify: `packages/server/src/supervisor/context-builder.test.ts`
- Modify: `packages/server/src/__tests__/session-manager-delete.test.ts`
- Modify: `packages/server/src/__tests__/session-manager-api.test.ts`
- Modify: `packages/server/src/__tests__/session-commands.test.ts`
- Modify: `packages/server/src/__tests__/session-terminal-exit.test.ts`
- Modify: `packages/server/src/__tests__/supervisor-commands.test.ts`
- Modify: `packages/server/src/__tests__/session-manager-title.test.ts`
- Modify: `packages/server/src/__tests__/session-remove.test.ts`
- Modify: `packages/server/src/__tests__/supervisor-integration.test.ts`
- Modify: `packages/server/src/__tests__/terminal-events.test.ts`
- Modify: `packages/server/src/__tests__/workspace-commands.test.ts`
- Modify: `packages/server/src/__tests__/ws-client.test.ts`
- Modify: `packages/server/src/terminal/manager.test.ts`
- Test: targeted server lint + server tests

- [ ] **Step 1: Write the failing targeted server-test lint command**

Run:

```bash
pnpm exec biome lint \
  packages/server/src/__tests__/ws-hub.test.ts \
  packages/server/src/__tests__/supervisor-manager.test.ts \
  packages/server/src/supervisor/context-builder.test.ts \
  packages/server/src/__tests__/session-manager-delete.test.ts \
  packages/server/src/__tests__/session-manager-api.test.ts \
  packages/server/src/__tests__/session-commands.test.ts \
  packages/server/src/__tests__/session-terminal-exit.test.ts \
  packages/server/src/__tests__/supervisor-commands.test.ts \
  packages/server/src/__tests__/session-manager-title.test.ts \
  packages/server/src/__tests__/session-remove.test.ts \
  packages/server/src/__tests__/supervisor-integration.test.ts \
  packages/server/src/__tests__/terminal-events.test.ts \
  packages/server/src/__tests__/workspace-commands.test.ts \
  packages/server/src/__tests__/ws-client.test.ts \
  packages/server/src/terminal/manager.test.ts
```

Expected: concentrated `lint/suspicious/noExplicitAny` diagnostics, especially in mock dependency builders and repository stubs.

- [ ] **Step 2: Introduce narrow helper types instead of `any`**

Refactor the test builders to prefer:

- `Partial<CommandContext>` where the test only needs a subset of command dependencies
- `Pick<SupervisorManagerDeps, "...">` for manager dependencies
- `Map<string, Supervisor>` / `Map<string, SupervisorCycle[]>` from `@coder-studio/core`
- explicit mock record shapes like:

```ts
type MockSocket = ReturnType<typeof createMockSocket>;
type MockSupervisorRecord = Supervisor & { cycles: SupervisorCycle[] };
type MockLogger = Pick<FastifyBaseLogger, "info" | "warn" | "error" | "debug" | "child">;
```

Replace `as any` with `as unknown as SpecificType` only at unavoidable framework boundaries.

- [ ] **Step 3: Re-run the targeted server lint command**

Run the same `pnpm exec biome lint ...` command from Step 1.

Expected: the listed files are free of `noExplicitAny`.

- [ ] **Step 4: Run the focused server tests**

Run:

```bash
pnpm --filter @coder-studio/server vitest run \
  src/__tests__/ws-hub.test.ts \
  src/__tests__/supervisor-manager.test.ts \
  src/supervisor/context-builder.test.ts \
  src/__tests__/session-manager-api.test.ts \
  src/__tests__/session-commands.test.ts
```

Expected: PASS with no behavioral changes.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/__tests__/ws-hub.test.ts packages/server/src/__tests__/supervisor-manager.test.ts packages/server/src/supervisor/context-builder.test.ts packages/server/src/__tests__/session-manager-delete.test.ts packages/server/src/__tests__/session-manager-api.test.ts packages/server/src/__tests__/session-commands.test.ts packages/server/src/__tests__/session-terminal-exit.test.ts packages/server/src/__tests__/supervisor-commands.test.ts packages/server/src/__tests__/session-manager-title.test.ts packages/server/src/__tests__/session-remove.test.ts packages/server/src/__tests__/supervisor-integration.test.ts packages/server/src/__tests__/terminal-events.test.ts packages/server/src/__tests__/workspace-commands.test.ts packages/server/src/__tests__/ws-client.test.ts packages/server/src/terminal/manager.test.ts
git commit -m "test(server): remove explicit any from dependency builders"
```

### Task 7: Remove `noExplicitAny` from Web Test Mocks and Shared Event Routing

**Files:**
- Modify: `packages/web/src/app/providers.tsx`
- Modify: `packages/web/src/app/providers.test.tsx`
- Modify: `packages/web/src/features/supervisor/components/supervisor-card.test.tsx`
- Modify: `packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx`
- Test: targeted web lint + focused web tests

- [ ] **Step 1: Write the failing targeted web lint command**

Run:

```bash
pnpm exec biome lint \
  packages/web/src/app/providers.tsx \
  packages/web/src/app/providers.test.tsx \
  packages/web/src/features/supervisor/components/supervisor-card.test.tsx \
  packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx
```

Expected: `noExplicitAny` in test mocks and `noUnusedVariables` in the xterm host test file.

- [ ] **Step 2: Tighten the production/test interfaces**

Make the smallest production typing changes needed to remove test `any`s cleanly:

- type `routeEventToAtom` to accept the concrete store type used by these tests instead of requiring `store as any`
- replace `store.set(wsClientAtom, { sendCommand: vi.fn() } as any)` with a narrow `Pick<WsClient, "sendCommand">` plus a local cast at the atom boundary if needed
- convert repeated supervisor test payloads to `Supervisor` / `SupervisorCycle` imports from `@coder-studio/core`

Avoid changing component behavior or event-routing logic beyond typing.

- [ ] **Step 3: Re-run the targeted web lint command**

Run the same `pnpm exec biome lint ...` command from Step 1.

Expected: no explicit-any or unused-variable diagnostics remain in these files.

- [ ] **Step 4: Run the focused web tests**

Run:

```bash
pnpm --filter @coder-studio/web test -- \
  src/app/providers.test.tsx \
  src/features/supervisor/components/supervisor-card.test.tsx \
  src/features/terminal-panel/__tests__/xterm-host.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/providers.tsx packages/web/src/app/providers.test.tsx packages/web/src/features/supervisor/components/supervisor-card.test.tsx packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx
git commit -m "test(web): remove explicit any from ws and supervisor mocks"
```

### Task 8: Remove `noExplicitAny` from Remaining Server Production Boundaries

**Files:**
- Modify: `packages/server/src/server.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/config.ts`
- Modify: `packages/server/src/session/manager.ts`
- Modify: `packages/server/src/terminal/pty-host.ts`
- Modify: `packages/server/src/ws/hub.ts`
- Modify: `packages/server/src/commands/fencing.ts`
- Modify: `packages/server/src/__tests__/event-bus.test.ts`
- Modify: `packages/server/src/__tests__/fencing-commands.test.ts`
- Modify: `packages/server/src/__tests__/fs/watcher.test.ts`
- Modify: `packages/server/src/__tests__/session-hydrate-restart.test.ts`
- Modify: `packages/server/src/supervisor/evaluator.test.ts`
- Modify: `packages/server/src/supervisor/injector.test.ts`
- Modify: `packages/server/src/supervisor/manager.test.ts`
- Test: targeted server lint + focused server tests

- [ ] **Step 1: Write the failing production-boundary lint command**

Run:

```bash
pnpm exec biome lint \
  packages/server/src/server.ts \
  packages/server/src/app.ts \
  packages/server/src/config.ts \
  packages/server/src/session/manager.ts \
  packages/server/src/terminal/pty-host.ts \
  packages/server/src/ws/hub.ts \
  packages/server/src/commands/fencing.ts \
  packages/server/src/__tests__/event-bus.test.ts \
  packages/server/src/__tests__/fencing-commands.test.ts \
  packages/server/src/__tests__/fs/watcher.test.ts \
  packages/server/src/__tests__/session-hydrate-restart.test.ts \
  packages/server/src/supervisor/evaluator.test.ts \
  packages/server/src/supervisor/injector.test.ts \
  packages/server/src/supervisor/manager.test.ts
```

Expected: a smaller but more sensitive set of `noExplicitAny` diagnostics.

- [ ] **Step 2: Replace boundary `any`s with explicit types**

Use the narrowest appropriate replacements:

- `FastifyBaseLogger` / local logger interfaces instead of `any` loggers
- explicit event handler tuple types instead of `(...args: any[])`
- `unknown` plus local refinement for opaque external payloads
- local request/test fixture types for Fastify requests
- `ReturnType<typeof vi.fn>` and repository-specific patch types for mocks

Do not suppress diagnostics unless a type boundary is truly opaque and cannot be refined.

- [ ] **Step 3: Re-run the targeted lint command**

Run the same `pnpm exec biome lint ...` command from Step 1.

Expected: the listed files are clean.

- [ ] **Step 4: Run focused server tests**

Run:

```bash
pnpm --filter @coder-studio/server vitest run \
  src/__tests__/fencing-commands.test.ts \
  src/__tests__/fs/watcher.test.ts \
  src/__tests__/session-hydrate-restart.test.ts \
  src/supervisor/evaluator.test.ts \
  src/supervisor/injector.test.ts \
  src/supervisor/manager.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/server.ts packages/server/src/app.ts packages/server/src/config.ts packages/server/src/session/manager.ts packages/server/src/terminal/pty-host.ts packages/server/src/ws/hub.ts packages/server/src/commands/fencing.ts packages/server/src/__tests__/event-bus.test.ts packages/server/src/__tests__/fencing-commands.test.ts packages/server/src/__tests__/fs/watcher.test.ts packages/server/src/__tests__/session-hydrate-restart.test.ts packages/server/src/supervisor/evaluator.test.ts packages/server/src/supervisor/injector.test.ts packages/server/src/supervisor/manager.test.ts
git commit -m "refactor(server): tighten remaining biome explicit-any boundaries"
```

### Task 9: Final Verification and Strictness Review

**Files:**
- Verify only

- [ ] **Step 1: Run full-repository lint**

Run: `pnpm lint`

Expected: no remaining `deserialize`, `internalError/fs`, `noUnusedVariables`, or `noExplicitAny` diagnostics.

- [ ] **Step 2: Run full-repository check**

Run: `pnpm check`

Expected:

- PASS if the repository has already been reformatted in the course of cleanup, or
- FAIL only on known remaining formatting debt that is intentionally deferred outside this plan

If formatting debt remains, note it explicitly before changing any CI strictness.

- [ ] **Step 3: Run the core automated suites impacted by this rollout**

Run:

```bash
pnpm --filter @coder-studio/server test
pnpm --filter @coder-studio/web test
pnpm --filter @coder-studio/core test
pnpm --filter @coder-studio/providers test
```

Expected: PASS.

- [ ] **Step 4: Review whether CI/hook strictness can be raised**

Decision checkpoint:

- if `pnpm lint` is clean and `pnpm check` is green, update:
  - PR quality workflow from error-only changed-files mode toward stricter `pnpm check`
  - release workflow from full-repo `pnpm exec biome lint --diagnostic-level=error --max-diagnostics=none .` toward full-repo `pnpm exec biome check --diagnostic-level=error --max-diagnostics=none .`
  - consider `--error-on-warnings` only if zero warnings remain
- if formatting debt still exists, keep the current non-blocking changed-files CI posture and log the remaining scope

- [ ] **Step 5: Commit final strictness adjustments if any**

```bash
git add .github/workflows/quality.yml .github/workflows/release.yml .husky/pre-commit biome.jsonc package.json README.md
git commit -m "chore: finalize biome rollout verification"
```

---

## Self-Review Checklist

- [x] **Spec coverage** — The plan covers all approved phases from the design spec: Biome baseline, CI/hooks automation, warning cleanup, and strictness review.
- [x] **Placeholder scan** — All tasks name exact files, commands, and intended edits; no `TODO` / `TBD` placeholders remain.
- [x] **Type consistency** — The plan consistently treats Phase 1 as non-blocking baseline work, Phase 2 as changed/staged-file automation, and Phase 3 as diagnostic cleanup in concrete file clusters.
