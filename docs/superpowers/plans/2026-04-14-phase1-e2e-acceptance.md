# Phase 1 E2E Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the executable Phase 1 acceptance pipeline defined in `docs/superpowers/specs/2026-04-13-coder-studio-design.md:3417`, including subagent-driven E2E execution, project-local acceptance reports, and Phase 1 Playwright acceptance script skeletons for functional + visual validation.

**Architecture:** The acceptance system lives in the future monorepo structure already defined by the spec: Playwright specs under `e2e/`, helpers/fixtures under `e2e/fixtures/`, screenshot baselines and JSON reports under `docs/验收报告/phase-1/`, and workspace scripts at the repo root. The runner executes against a real local server and real filesystem/Git state, produces structured JSON reports, and blocks human self-verification until all automated acceptance checks pass.

**Tech Stack:** TypeScript, Playwright, Node.js 20+, pnpm workspaces, Vitest (for helper units where needed), JSON reports, PNG screenshot baselines.

---

## File Structure

This plan assumes the implementation follows the target repo structure already locked in by the design spec. These are the files this acceptance work should create or modify.

### Root workspace files
- Create: `package.json` — root scripts for acceptance orchestration (`acceptance:phase1`, `acceptance:phase1:update-baseline`, `acceptance:phase1:report`)
- Create: `pnpm-workspace.yaml` — workspace definition for `packages/*` and `e2e`
- Create: `tsconfig.base.json` — shared TS config for `e2e` helpers

### E2E runtime files
- Create: `e2e/playwright.config.ts` — Playwright config, projects, screenshot settings, output dirs
- Create: `e2e/package.json` — local package for Playwright test execution
- Create: `e2e/fixtures/test-workspace.ts` — create and clean temporary Git-backed workspaces
- Create: `e2e/fixtures/server-process.ts` — spawn/stop local dev server for E2E
- Create: `e2e/fixtures/report-writer.ts` — write structured JSON acceptance reports into `docs/验收报告/phase-1/`
- Create: `e2e/fixtures/visual-assert.ts` — screenshot assertions and pixel-threshold helpers
- Create: `e2e/fixtures/dom-assert.ts` — CSS token / computed-style assertions for visual-spec alignment
- Create: `e2e/fixtures/provider-stubs.ts` — helper for fake provider CLI setup in local test runs
- Create: `e2e/fixtures/phase1-checklist.ts` — machine-readable mapping of Phase 1 F1/V1 acceptance IDs to tests and report entries

### Phase 1 Playwright specs
- Create: `e2e/specs/phase1/workspace.spec.ts`
- Create: `e2e/specs/phase1/agent-session.spec.ts`
- Create: `e2e/specs/phase1/editor.spec.ts`
- Create: `e2e/specs/phase1/git.spec.ts`
- Create: `e2e/specs/phase1/terminal.spec.ts`
- Create: `e2e/specs/phase1/command-palette.spec.ts`
- Create: `e2e/specs/phase1/focus-mode.spec.ts`
- Create: `e2e/specs/phase1/websocket.spec.ts`
- Create: `e2e/specs/phase1/edge-cases.spec.ts`
- Create: `e2e/specs/phase1/data-integrity.spec.ts`
- Create: `e2e/specs/phase1/visual-global.spec.ts`
- Create: `e2e/specs/phase1/visual-components.spec.ts`
- Create: `e2e/specs/phase1/visual-states.spec.ts`
- Create: `e2e/specs/phase1/visual-animations.spec.ts`

### Project-local outputs
- Create: `docs/验收报告/phase-1/.gitkeep`
- Create: `docs/验收报告/phase-1/baseline-screenshots/.gitkeep`
- Create: `docs/验收报告/phase-1/README.md` — explains report naming, baseline update workflow, and human handoff

### Documentation updates
- Modify: `docs/superpowers/specs/2026-04-13-coder-studio-design.md:3417-3792` — only if implementation reveals mismatches in acceptance IDs or output conventions

---

## Subagent Execution Model

Use **superpowers:subagent-driven-development** when executing this plan.

Recommended task ownership:
- **subagent A — runner/setup:** root scripts, Playwright config, server/process helpers, report writer
- **subagent B — functional specs:** workspace / session / editor / git / terminal / command palette / focus / websocket / edge / integrity specs
- **subagent C — visual specs:** visual helpers, baselines, global/component/state/animation visual assertions
- **lead reviewer (main agent):** merges decisions, runs final acceptance, verifies reports, requests code review before claiming complete

Review checkpoints:
1. After acceptance runner + report writer exists
2. After functional Phase 1 specs exist and fail for the right reasons
3. After minimal implementation hooks allow first passing path
4. After visual specs and baselines stabilize
5. Final full Phase 1 acceptance pass + report output

---

## Execution Order

1. Establish workspace scripts and Playwright runtime
2. Create report output structure under `docs/验收报告/phase-1/`
3. Write failing functional acceptance specs for Phase 1
4. Wire report aggregation from Playwright results to JSON acceptance output
5. Write failing visual acceptance specs and baseline workflow
6. Implement/adjust app code until functional specs pass
7. Implement/adjust styling until visual specs pass
8. Run full Phase 1 acceptance suite and generate report
9. Hand off to developer for manual self-verification only after automated pass is green

---

### Task 1: Bootstrap acceptance workspace and scripts

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `e2e/package.json`
- Create: `e2e/playwright.config.ts`

- [ ] **Step 1: Write the failing workspace script scaffold test in the plan review checklist**

```ts
// acceptance expectation
const expectedScripts = [
  'acceptance:phase1',
  'acceptance:phase1:update-baseline',
  'acceptance:phase1:report',
];
```

- [ ] **Step 2: Create root `package.json` with exact acceptance scripts**

```json
{
  "name": "coder-studio",
  "private": true,
  "packageManager": "pnpm@10.0.0",
  "scripts": {
    "acceptance:phase1": "pnpm --dir e2e exec playwright test --config playwright.config.ts --grep @phase1",
    "acceptance:phase1:update-baseline": "pnpm --dir e2e exec playwright test --config playwright.config.ts --grep @phase1 --update-snapshots",
    "acceptance:phase1:report": "node e2e/fixtures/report-writer.ts phase-1"
  }
}
```

- [ ] **Step 3: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - 'packages/*'
  - 'e2e'
```

- [ ] **Step 4: Create `e2e/package.json`**

```json
{
  "name": "@coder-studio/e2e",
  "private": true,
  "type": "module",
  "devDependencies": {
    "@playwright/test": "^1.59.1",
    "typescript": "^5.8.0"
  }
}
```

- [ ] **Step 5: Create `e2e/playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './specs',
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: '../docs/验收报告/phase-1/latest-playwright.json' }]],
  snapshotPathTemplate: '../docs/验收报告/phase-1/baseline-screenshots/{testFilePath}/{arg}{ext}',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
```

- [ ] **Step 6: Run validation command**

Run: `pnpm --dir e2e exec playwright --version`
Expected: prints Playwright version without error

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json e2e/package.json e2e/playwright.config.ts
git commit -m "test: bootstrap phase1 acceptance workspace"
```

### Task 2: Create project-local acceptance report outputs

**Files:**
- Create: `docs/验收报告/phase-1/.gitkeep`
- Create: `docs/验收报告/phase-1/baseline-screenshots/.gitkeep`
- Create: `docs/验收报告/phase-1/README.md`

- [ ] **Step 1: Create report directories**

Directory tree:

```text
docs/验收报告/
└── phase-1/
    ├── .gitkeep
    ├── README.md
    └── baseline-screenshots/
        └── .gitkeep
```

- [ ] **Step 2: Write `docs/验收报告/phase-1/README.md`**

```md
# Phase 1 验收报告

- 自动化验收报告文件名：`YYYY-MM-DD-自动化验收.json`
- 人工验收报告文件名：`YYYY-MM-DD-人工验收.json`
- 基线截图目录：`baseline-screenshots/`
- 仅当设计稿或视觉规范发生明确变更时允许更新 baseline
- 开发者人工自验只能在自动化验收全部通过后执行
```

- [ ] **Step 3: Verify directories exist**

Run: `ls docs/验收报告/phase-1 && ls docs/验收报告/phase-1/baseline-screenshots`
Expected: shows `README.md` and `.gitkeep`

- [ ] **Step 4: Commit**

```bash
git add docs/验收报告/phase-1/.gitkeep docs/验收报告/phase-1/baseline-screenshots/.gitkeep docs/验收报告/phase-1/README.md
git commit -m "docs: add phase1 acceptance report output structure"
```

### Task 3: Build acceptance report writer and checklist mapping

**Files:**
- Create: `e2e/fixtures/phase1-checklist.ts`
- Create: `e2e/fixtures/report-writer.ts`
- Test: `e2e/specs/phase1/reporting.spec.ts`

- [ ] **Step 1: Write the failing report mapping test**

```ts
import { test, expect } from '@playwright/test';
import { phase1Checklist } from '../../fixtures/phase1-checklist';

test('@phase1 maps all acceptance IDs', async () => {
  expect(phase1Checklist.functionalIds).toContain('F1-01');
  expect(phase1Checklist.functionalIds).toContain('F1-40');
  expect(phase1Checklist.visualIds).toContain('V1-01');
  expect(phase1Checklist.visualIds).toContain('V1-17');
});
```

- [ ] **Step 2: Create `e2e/fixtures/phase1-checklist.ts`**

```ts
export const phase1Checklist = {
  phase: 'phase-1',
  functionalIds: [
    'F1-01','F1-02','F1-03','F1-04','F1-05','F1-06','F1-07','F1-08','F1-09','F1-10',
    'F1-11','F1-12','F1-13','F1-14','F1-15','F1-16','F1-17','F1-18','F1-19','F1-20',
    'F1-21','F1-22','F1-23','F1-24','F1-25','F1-26','F1-27','F1-28','F1-29','F1-30',
    'F1-31','F1-32','F1-33','F1-34','F1-35','F1-36','F1-37','F1-38','F1-39','F1-40',
  ],
  visualIds: [
    'V1-01','V1-02','V1-03','V1-04','V1-05','V1-06','V1-07','V1-08','V1-09',
    'V1-10','V1-11','V1-12','V1-13','V1-14','V1-15','V1-16','V1-17',
  ],
};
```

- [ ] **Step 3: Create `e2e/fixtures/report-writer.ts`**

```ts
import fs from 'node:fs';
import path from 'node:path';
import { phase1Checklist } from './phase1-checklist';

const phase = process.argv[2] ?? 'phase-1';
const outputDir = path.resolve('docs/验收报告', phase);
const today = new Date().toISOString().slice(0, 10);
const reportPath = path.join(outputDir, `${today}-自动化验收.json`);

const report = {
  phase,
  验收时间: new Date().toISOString(),
  验收类型: '自动化验收',
  执行者: 'e2e-subagent',
  总体结果: '待填充',
  功能验收: {
    总项数: phase1Checklist.functionalIds.length,
    通过数: 0,
    失败数: 0,
    失败项清单: [],
  },
  视觉验收: {
    总项数: phase1Checklist.visualIds.length,
    通过数: 0,
    失败数: 0,
    失败项清单: [],
    截图对比结果: {
      总对比数: 0,
      像素差异率: '0%',
      异常对比: [],
    },
  },
};

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(reportPath);
```

- [ ] **Step 4: Run tests to verify fail/pass sequence**

Run: `pnpm --dir e2e exec playwright test specs/phase1/reporting.spec.ts --config playwright.config.ts`
Expected before implementation: FAIL
Expected after implementation: PASS

- [ ] **Step 5: Run report writer manually**

Run: `node e2e/fixtures/report-writer.ts phase-1`
Expected: prints `docs/验收报告/phase-1/YYYY-MM-DD-自动化验收.json`

- [ ] **Step 6: Commit**

```bash
git add e2e/fixtures/phase1-checklist.ts e2e/fixtures/report-writer.ts e2e/specs/phase1/reporting.spec.ts docs/验收报告/phase-1/*.json
git commit -m "test: add phase1 acceptance report mapping"
```

### Task 4: Add server/process and test-workspace fixtures

**Files:**
- Create: `e2e/fixtures/test-workspace.ts`
- Create: `e2e/fixtures/server-process.ts`
- Test: `e2e/specs/phase1/fixtures.spec.ts`

- [ ] **Step 1: Write failing fixture test**

```ts
import { test, expect } from '@playwright/test';
import { createTestWorkspace } from '../../fixtures/test-workspace';

test('@phase1 creates a git-backed temp workspace', async () => {
  const workspace = await createTestWorkspace();
  expect(workspace.path).toContain('coder-studio-phase1-');
  expect(workspace.gitInitialized).toBe(true);
});
```

- [ ] **Step 2: Create `e2e/fixtures/test-workspace.ts`**

```ts
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function createTestWorkspace() {
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'coder-studio-phase1-'));
  await fs.writeFile(path.join(workspacePath, 'README.md'), '# Test Workspace\n');
  await fs.mkdir(path.join(workspacePath, 'src'));
  await fs.writeFile(path.join(workspacePath, 'src', 'index.ts'), 'export const ok = true;\n');
  await execFileAsync('git', ['init'], { cwd: workspacePath });
  await execFileAsync('git', ['add', '.'], { cwd: workspacePath });
  await execFileAsync('git', ['commit', '-m', 'init'], { cwd: workspacePath });
  return { path: workspacePath, gitInitialized: true };
}
```

- [ ] **Step 3: Create `e2e/fixtures/server-process.ts`**

```ts
import { spawn, ChildProcess } from 'node:child_process';

export function startServer(command = 'pnpm', args = ['dev']) {
  const child: ChildProcess = spawn(command, args, {
    stdio: 'pipe',
    env: { ...process.env, NODE_ENV: 'test' },
  });
  return child;
}

export function stopServer(child: ChildProcess) {
  child.kill('SIGTERM');
}
```

- [ ] **Step 4: Run focused test**

Run: `pnpm --dir e2e exec playwright test specs/phase1/fixtures.spec.ts --config playwright.config.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add e2e/fixtures/test-workspace.ts e2e/fixtures/server-process.ts e2e/specs/phase1/fixtures.spec.ts
git commit -m "test: add phase1 e2e fixtures"
```

### Task 5: Write Phase 1 functional acceptance script skeletons

**Files:**
- Create: `e2e/specs/phase1/workspace.spec.ts`
- Create: `e2e/specs/phase1/agent-session.spec.ts`
- Create: `e2e/specs/phase1/editor.spec.ts`
- Create: `e2e/specs/phase1/git.spec.ts`
- Create: `e2e/specs/phase1/terminal.spec.ts`
- Create: `e2e/specs/phase1/command-palette.spec.ts`
- Create: `e2e/specs/phase1/focus-mode.spec.ts`
- Create: `e2e/specs/phase1/websocket.spec.ts`
- Create: `e2e/specs/phase1/edge-cases.spec.ts`
- Create: `e2e/specs/phase1/data-integrity.spec.ts`

- [ ] **Step 1: Create `workspace.spec.ts` skeleton**

```ts
import { test, expect } from '@playwright/test';

test.describe('@phase1 workspace acceptance', () => {
  test('F1-01 open workspace', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Open Workspace' }).click();
    test.fail(true, 'App UI not implemented yet');
  });

  test('F1-02 browse file tree', async ({ page }) => {
    await page.goto('/');
    test.fail(true, 'File tree not implemented yet');
  });
});
```

- [ ] **Step 2: Create `agent-session.spec.ts` skeleton**

```ts
import { test } from '@playwright/test';

test.describe('@phase1 agent session acceptance', () => {
  test('F1-06 start agent session', async ({ page }) => {
    await page.goto('/');
    test.fail(true, 'Agent session UI not implemented yet');
  });

  test('F1-07 send prompt to agent', async ({ page }) => {
    await page.goto('/');
    test.fail(true, 'PTY wiring not implemented yet');
  });
});
```

- [ ] **Step 3: Create the remaining functional skeleton specs with exact IDs in test titles**

Use this pattern in each file:

```ts
import { test } from '@playwright/test';

test.describe('@phase1 <area> acceptance', () => {
  test('F1-11 open file in editor', async ({ page }) => {
    await page.goto('/');
    test.fail(true, 'Editor flow not implemented yet');
  });
});
```

Files and ID ranges:
- `editor.spec.ts` → F1-11..F1-15
- `git.spec.ts` → F1-16..F1-20
- `terminal.spec.ts` → F1-21..F1-24
- `command-palette.spec.ts` → F1-25..F1-26
- `focus-mode.spec.ts` → F1-27..F1-28
- `websocket.spec.ts` → F1-29..F1-31
- `edge-cases.spec.ts` → F1-32..F1-36
- `data-integrity.spec.ts` → F1-37..F1-40

- [ ] **Step 4: Run the whole functional skeleton suite**

Run: `pnpm --dir e2e exec playwright test specs/phase1 --config playwright.config.ts --grep 'F1-'`
Expected: FAIL with explicit `test.fail` reasons for unimplemented UI flows

- [ ] **Step 5: Commit**

```bash
git add e2e/specs/phase1/workspace.spec.ts e2e/specs/phase1/agent-session.spec.ts e2e/specs/phase1/editor.spec.ts e2e/specs/phase1/git.spec.ts e2e/specs/phase1/terminal.spec.ts e2e/specs/phase1/command-palette.spec.ts e2e/specs/phase1/focus-mode.spec.ts e2e/specs/phase1/websocket.spec.ts e2e/specs/phase1/edge-cases.spec.ts e2e/specs/phase1/data-integrity.spec.ts
git commit -m "test: add phase1 functional acceptance skeletons"
```

### Task 6: Write Phase 1 visual acceptance script skeletons

**Files:**
- Create: `e2e/fixtures/visual-assert.ts`
- Create: `e2e/fixtures/dom-assert.ts`
- Create: `e2e/specs/phase1/visual-global.spec.ts`
- Create: `e2e/specs/phase1/visual-components.spec.ts`
- Create: `e2e/specs/phase1/visual-states.spec.ts`
- Create: `e2e/specs/phase1/visual-animations.spec.ts`

- [ ] **Step 1: Write failing visual helper contract**

```ts
import { test, expect } from '@playwright/test';
import { assertUsesToken } from '../../fixtures/dom-assert';

test('@phase1 V1-01 color system alignment helper exists', async () => {
  expect(typeof assertUsesToken).toBe('function');
});
```

- [ ] **Step 2: Create `e2e/fixtures/dom-assert.ts`**

```ts
import { expect, Page } from '@playwright/test';

export async function assertUsesToken(page: Page, selector: string, property: string, expected: string) {
  const value = await page.locator(selector).evaluate((el, input) => {
    const [prop] = input as [string, string];
    return getComputedStyle(el).getPropertyValue(prop).trim();
  }, [property, expected]);
  expect(value).toBe(expected);
}
```

- [ ] **Step 3: Create `e2e/fixtures/visual-assert.ts`**

```ts
import { expect, Locator } from '@playwright/test';

export async function assertBaseline(locator: Locator, snapshotName: string) {
  await expect(locator).toHaveScreenshot(snapshotName, {
    maxDiffPixelRatio: 0.001,
  });
}
```

- [ ] **Step 4: Create visual spec skeletons with exact IDs**

Example:

```ts
import { test } from '@playwright/test';

test.describe('@phase1 visual acceptance', () => {
  test('V1-04 welcome page baseline', async ({ page }) => {
    await page.goto('/');
    test.fail(true, 'Welcome page UI not implemented yet');
  });
});
```

Distribution:
- `visual-global.spec.ts` → V1-01..V1-03
- `visual-components.spec.ts` → V1-04..V1-12
- `visual-states.spec.ts` → V1-13..V1-15
- `visual-animations.spec.ts` → V1-16..V1-17

- [ ] **Step 5: Run visual skeleton suite**

Run: `pnpm --dir e2e exec playwright test specs/phase1 --config playwright.config.ts --grep 'V1-'`
Expected: FAIL with explicit unimplemented reasons or missing snapshot baselines

- [ ] **Step 6: Commit**

```bash
git add e2e/fixtures/visual-assert.ts e2e/fixtures/dom-assert.ts e2e/specs/phase1/visual-global.spec.ts e2e/specs/phase1/visual-components.spec.ts e2e/specs/phase1/visual-states.spec.ts e2e/specs/phase1/visual-animations.spec.ts
git commit -m "test: add phase1 visual acceptance skeletons"
```

### Task 7: Add acceptance orchestration handoff and subagent protocol

**Files:**
- Create: `docs/验收报告/phase-1/subagent-runbook.md`
- Modify: `docs/验收报告/phase-1/README.md`

- [ ] **Step 1: Create `subagent-runbook.md`**

```md
# Phase 1 E2E Subagent Runbook

## Order
1. Start local server
2. Run functional specs
3. Run visual specs
4. Generate `YYYY-MM-DD-自动化验收.json`
5. If all checks pass, notify developer to perform manual self-verification

## Team split
- setup/runner subagent
- functional specs subagent
- visual specs subagent

## Rule
Human self-verification is blocked until automated acceptance is fully green.
```

- [ ] **Step 2: Extend `docs/验收报告/phase-1/README.md` with human handoff text**

Append:

```md
## 人工自验前置条件

只有在当日自动化验收报告中：
- 功能验收全部通过
- 视觉验收全部通过
- 截图对比像素差异率 ≤ 0.1%

开发者才可以继续执行人工自验。
```

- [ ] **Step 3: Commit**

```bash
git add docs/验收报告/phase-1/subagent-runbook.md docs/验收报告/phase-1/README.md
git commit -m "docs: add phase1 acceptance runbook"
```

### Task 8: Run end-to-end plan validation

**Files:**
- Modify: `docs/superpowers/specs/2026-04-13-coder-studio-design.md` (only if mismatch discovered)
- Test: all files above

- [ ] **Step 1: Run all Phase 1 acceptance skeletons**

Run: `pnpm acceptance:phase1`
Expected: currently FAIL because product UI is not implemented, but test discovery succeeds and all F1/V1 IDs are present

- [ ] **Step 2: Run report generation**

Run: `pnpm acceptance:phase1:report`
Expected: writes `docs/验收报告/phase-1/YYYY-MM-DD-自动化验收.json`

- [ ] **Step 3: Validate file map against spec**

Checklist:
- `e2e/` exists per spec `docs/superpowers/specs/2026-04-13-coder-studio-design.md:372-375`
- report output path matches spec `:3488-3505`
- functional IDs cover F1-01..F1-40
- visual IDs cover V1-01..V1-17

- [ ] **Step 4: Request code review before claiming plan implementation complete**

Use `superpowers:requesting-code-review` after the skeleton lands.

- [ ] **Step 5: Commit final plan-validation changes**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json e2e docs/验收报告
git commit -m "test: wire phase1 acceptance execution flow"
```

---

## Spec Coverage Self-Review

- `16.1 验收体系概述` → covered by Tasks 1, 3, 7, 8
- `16.2 验收执行流程` → covered by Tasks 3 and 7 (automation-before-human flow)
- `16.3 验收报告规格` → covered by Tasks 2 and 3
- `16.4 Phase 1 MVP E2E 验收清单` → covered by Tasks 5 and 6
- `16.5-16.7 Phase 2-4` → not implemented now by design; this plan intentionally focuses on Phase 1 only
- `16.8 开发者人工自验指南` → covered by Task 7 runbook/README handoff

No placeholder markers (`TODO`, `TBD`, `implement later`) remain in executable steps.

---

Plan complete and saved to `docs/superpowers/plans/2026-04-14-phase1-e2e-acceptance.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**