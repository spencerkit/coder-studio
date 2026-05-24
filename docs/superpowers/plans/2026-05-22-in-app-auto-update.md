# In-App Auto Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a safe in-app update flow for globally installed npm builds of Coder Studio, including automatic version polling, manual “Check for updates”, a new Settings > About surface, active-work confirmation, and detached install/restart execution that survives service replacement.

**Architecture:** Keep durable user preferences in `settings.json`, keep workflow checkpoint state in `update-state.json`, and keep detailed detached-worker output in `update-worker.log`. Version discovery, scheduling, state transitions, and frontend commands live in a server-side `UpdateService`; the actual `npm install -g` and managed restart run in a detached CLI worker process so the current server never tries to replace and restart itself from inside the same long-lived process.

**Tech Stack:** TypeScript, Node `child_process`/`fs`, Fastify websocket command dispatch, jotai, React 19, Vitest, Testing Library.

**Spec reference:** `docs/superpowers/specs/2026-05-22-in-app-auto-update-design.md`

**Git hygiene:** This repo already has unrelated dirty files (`packages/server/src/lsp/document-store.ts`, `packages/server/src/lsp/document-store.test.ts`, `.tmp-lsp-SUz385/`, `.tmp-probe.json`). Do not revert or stage them in any task below.

---

## File Structure

**New files:**
- `packages/core/src/domain/update.ts` — shared update state types, interval options, default state factory
- `packages/core/src/domain/update.test.ts` — focused tests for shared update types/helpers
- `packages/server/src/storage/repositories/update-state-repo.ts` — file-backed `update-state.json` repository
- `packages/server/src/__tests__/update-state-repo.test.ts` — repository persistence/default-shape tests
- `packages/server/src/update/update-service.ts` — update orchestration, scheduling, recovery, activity summary, worker launch contract
- `packages/server/src/update/update-service.test.ts` — unit tests for checks, scheduling, recovery, install preflight, file-refresh reconciliation
- `packages/server/src/commands/updates.ts` — websocket command handlers for `updates.*`
- `packages/server/src/commands/updates.test.ts` — command dispatch tests for `updates.getState`, `updates.check`, `updates.prepareInstall`, `updates.startInstall`
- `packages/cli/src/update-runtime.ts` — CLI-side runtime hints for install support, worker path, and restart entry path
- `packages/cli/src/update-runtime.test.ts` — tests for runtime support/path resolution
- `packages/cli/src/update-worker.ts` — detached worker bootstrap that installs, writes state, and restarts managed service
- `packages/cli/src/update-worker.test.ts` — worker tests for success, permission fallback, and failure state writes
- `packages/web/src/features/updates/atoms.ts` — global update state atoms and derived badge selectors
- `packages/web/src/features/settings/components/about-settings.tsx` — Settings > About content and update actions
- `packages/web/src/features/settings/components/about-settings.test.tsx` — About surface tests for manual check, confirmation, manual-required fallback, and settings persistence hooks

**Modified files:**
- `packages/core/src/index.ts` — export update types
- `packages/core/src/protocol/topics.ts` — add `Topics.updateStateChanged`
- `packages/server/src/config.ts` — extend `ServerConfig` with update runtime hints and safe defaults
- `packages/server/src/config.test.ts` — assert new `config.update` defaults/overrides
- `packages/server/src/storage/index.ts` — export `UpdateStateRepo`
- `packages/server/src/commands/settings.ts` — persist `updates.autoCheckEnabled` and `updates.checkIntervalSec` through `settings.json`
- `packages/server/src/commands/settings.test.ts` — validate update settings persistence, interval validation, and schedule reload
- `packages/server/src/commands/index.ts` — register `updates.ts`
- `packages/server/src/ws/dispatch.ts` — inject optional `updateService` into command context
- `packages/server/src/server.ts` — instantiate `UpdateStateRepo` and `UpdateService`, wire startup/shutdown, expose command context dependency
- `packages/server/src/session/manager.ts` — add a read-only `getAll()` accessor for update activity summaries
- `packages/server/src/supervisor/manager.ts` — add a read-only `countActive()` accessor for update activity summaries
- `packages/cli/src/package-manifest.ts` — expose package name alongside version
- `packages/cli/src/server-runner.ts` — pass update runtime hints into server config
- `packages/web/src/app/providers.tsx` — hydrate global update state on connect, subscribe to `update.state.changed`, push discovery toast, recover after restart
- `packages/web/src/app/providers.test.tsx` — verify update-state hydration and event routing
- `packages/web/src/theme/icon-theme.ts` — add `nav.settings.about`
- `packages/web/src/features/settings/components/settings-sections.tsx` — add `about` section metadata
- `packages/web/src/features/settings/components/settings-page.tsx` — load/save update settings, render About section, show About badge
- `packages/web/src/features/settings/components/settings-page.test.tsx` — extend settings navigation and About-section coverage
- `packages/web/src/features/topbar/index.tsx` — show settings-entry update marker
- `packages/web/src/features/topbar/index.test.tsx` — verify topbar marker visibility
- `packages/web/src/features/workspace/views/mobile/mobile-topbar.tsx` — show settings-entry update marker on mobile
- `packages/web/src/locales/zh.json` — add About/update strings
- `packages/web/src/locales/en.json` — add About/update strings

**Runtime files produced by the feature:**
- `state/update-state.json` — structured workflow checkpoint only
- `logs/update-worker.log` — detached worker stdout/stderr and restart handoff diagnostics

**No changes in this plan:**
- No support for source checkouts or non-global installs
- No in-app privilege escalation (`sudo`, UAC, pkexec, etc.)
- No progress percentage bar for `npm install -g`
- No storage of verbose worker output inside JSON state

---

## Task 1: Add Shared Update Protocol Types

**Files:**
- Create: `packages/core/src/domain/update.ts`
- Create: `packages/core/src/domain/update.test.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/protocol/topics.ts`

- [ ] **Step 1: Write the failing shared update tests**

Create `packages/core/src/domain/update.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Topics } from "../protocol/topics";
import {
  UPDATE_CHECK_INTERVAL_OPTIONS,
  createDefaultUpdateState,
} from "./update";

describe("update domain helpers", () => {
  it("creates the default persisted update state shape", () => {
    expect(createDefaultUpdateState("0.4.0")).toEqual({
      version: 1,
      currentVersion: "0.4.0",
      latestVersion: null,
      availability: "unknown",
      updateStatus: "idle",
      lastCheckedAt: null,
      targetVersion: null,
      startedAt: null,
      finishedAt: null,
      requiresManualStep: false,
      manualCommand: null,
      errorSummary: null,
    });
  });

  it("exposes the fixed auto-check interval options", () => {
    expect(UPDATE_CHECK_INTERVAL_OPTIONS).toEqual([3600, 21600, 43200, 86400]);
  });

  it("defines the websocket topic for update state broadcasts", () => {
    expect(Topics.updateStateChanged).toBe("update.state.changed");
  });
});
```

- [ ] **Step 2: Run the focused core test and confirm RED**

Run:

```bash
pnpm --filter @coder-studio/core test -- packages/core/src/domain/update.test.ts
```

Expected: FAIL because `./update` exports and `Topics.updateStateChanged` do not exist yet.

- [ ] **Step 3: Write the minimal shared update types and helpers**

```ts
export const UPDATE_CHECK_INTERVAL_OPTIONS = [3600, 21600, 43200, 86400] as const;

export type UpdateCheckIntervalSec = (typeof UPDATE_CHECK_INTERVAL_OPTIONS)[number];
export type UpdateAvailability =
  | "unknown"
  | "up_to_date"
  | "update_available"
  | "check_failed";
export type UpdateStatus =
  | "idle"
  | "checking"
  | "installing"
  | "restarting"
  | "succeeded"
  | "failed"
  | "manual_required";

export interface UpdateStateSnapshot {
  version: 1;
  currentVersion: string;
  latestVersion: string | null;
  availability: UpdateAvailability;
  updateStatus: UpdateStatus;
  lastCheckedAt: number | null;
  targetVersion: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  requiresManualStep: boolean;
  manualCommand: string | null;
  errorSummary: string | null;
}

export interface UpdateActivitySummary {
  runningTerminalCount: number;
  runningSessionCount: number;
  runningSupervisorCount: number;
  hasActiveWork: boolean;
}

export interface UpdateSupportInfo {
  supported: boolean;
  installKind: "global_npm" | "unsupported";
  unsupportedReason: string | null;
}

export interface UpdateStateView extends UpdateStateSnapshot, UpdateSupportInfo {}

export interface UpdatePrepareInstallResponse extends UpdateStateView {
  canStartInstall: boolean;
  activity: UpdateActivitySummary;
}

export function createDefaultUpdateState(currentVersion: string): UpdateStateSnapshot {
  return {
    version: 1,
    currentVersion,
    latestVersion: null,
    availability: "unknown",
    updateStatus: "idle",
    lastCheckedAt: null,
    targetVersion: null,
    startedAt: null,
    finishedAt: null,
    requiresManualStep: false,
    manualCommand: null,
    errorSummary: null,
  };
}
```

Modify `packages/core/src/protocol/topics.ts`:

```ts
  updateStateChanged: "update.state.changed",
```

Modify `packages/core/src/index.ts`:

```ts
export * from "./domain/update";
```

- [ ] **Step 4: Run the focused core test and confirm GREEN**

```bash
pnpm --filter @coder-studio/core test -- packages/core/src/domain/update.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/domain/update.ts packages/core/src/domain/update.test.ts packages/core/src/index.ts packages/core/src/protocol/topics.ts
git commit -m "feat: add shared update protocol types"
```

---

## Task 2: Persist Update Preferences in `settings.json`

**Files:**
- Modify: `packages/server/src/commands/settings.ts`
- Modify: `packages/server/src/commands/settings.test.ts`

- [ ] **Step 1: Write the failing settings command tests**

Add to `packages/server/src/commands/settings.test.ts`:

```ts
it("settings.update persists update auto-check preferences", async () => {
  const result = await dispatch(
    {
      kind: "command",
      id: "settings-update-updates",
      op: "settings.update",
      args: {
        settings: {
          updates: {
            autoCheckEnabled: false,
            checkIntervalSec: 21600,
          },
        },
      },
    },
    ctx
  );

  expect(result.ok).toBe(true);
  expect(settingsRepo.get("updates.autoCheckEnabled")).toBe(false);
  expect(settingsRepo.get("updates.checkIntervalSec")).toBe(21600);
});

it("settings.update rejects unsupported update intervals", async () => {
  const result = await dispatch(
    {
      kind: "command",
      id: "settings-update-updates-invalid",
      op: "settings.update",
      args: {
        settings: {
          updates: {
            autoCheckEnabled: true,
            checkIntervalSec: 13,
          },
        },
      },
    },
    ctx
  );

  expect(result.ok).toBe(false);
  expect(result.error?.code).toBe("validation_error");
  expect(settingsRepo.get("updates.checkIntervalSec")).toBeUndefined();
});

it("settings.update rebuilds the update auto-check schedule when update preferences change", async () => {
  const updateService = {
    reloadScheduleFromSettings: vi.fn(),
  };

  ctx.updateService = updateService as never;

  const result = await dispatch(
    {
      kind: "command",
      id: "settings-update-updates-reload",
      op: "settings.update",
      args: {
        settings: {
          updates: {
            autoCheckEnabled: true,
            checkIntervalSec: 43200,
          },
        },
      },
    },
    ctx
  );

  expect(result.ok).toBe(true);
  expect(updateService.reloadScheduleFromSettings).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the focused server settings tests and confirm RED**

```bash
pnpm --filter @coder-studio/server test -- packages/server/src/commands/settings.test.ts
```

Expected: FAIL because the `updates` schema branch and schedule refresh do not exist yet.

- [ ] **Step 3: Extend the settings schema with fixed update preferences**

Modify `packages/server/src/commands/settings.ts`:

```ts
import {
  UPDATE_CHECK_INTERVAL_OPTIONS,
  type UpdateCheckIntervalSec,
} from "@coder-studio/core";

const UpdateIntervalSchema = z.union(
  UPDATE_CHECK_INTERVAL_OPTIONS.map((value) => z.literal(value)) as [
    z.ZodLiteral<UpdateCheckIntervalSec>,
    ...z.ZodLiteral<UpdateCheckIntervalSec>[],
  ]
);

const SettingsSchema = z.object({
  // existing keys ...
  updates: z
    .object({
      autoCheckEnabled: z.boolean().optional(),
      checkIntervalSec: UpdateIntervalSchema.optional(),
    })
    .optional(),
});
```

After `flatSettings` persistence, reload the timer:

```ts
const changedUpdateSettings =
  Object.prototype.hasOwnProperty.call(flatSettings, "updates.autoCheckEnabled") ||
  Object.prototype.hasOwnProperty.call(flatSettings, "updates.checkIntervalSec");

if (changedUpdateSettings) {
  ctx.updateService?.reloadScheduleFromSettings();
}
```

- [ ] **Step 4: Run the focused server settings tests and confirm GREEN**

```bash
pnpm --filter @coder-studio/server test -- packages/server/src/commands/settings.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/commands/settings.ts packages/server/src/commands/settings.test.ts
git commit -m "feat: persist update preferences in settings"
```

---

## Task 3: Add `update-state.json` Repository and Activity Accessors

**Files:**
- Create: `packages/server/src/storage/repositories/update-state-repo.ts`
- Create: `packages/server/src/__tests__/update-state-repo.test.ts`
- Modify: `packages/server/src/storage/index.ts`
- Modify: `packages/server/src/session/manager.ts`
- Modify: `packages/server/src/supervisor/manager.ts`

- [ ] **Step 1: Write the failing repository tests**

Create `packages/server/src/__tests__/update-state-repo.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UpdateStateRepo } from "../storage";

describe("UpdateStateRepo", () => {
  let tempDir: string;
  let repo: UpdateStateRepo;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "update-state-repo-test-"));
    repo = new UpdateStateRepo({
      filePath: join(tempDir, "update-state.json"),
      currentVersion: "0.4.0",
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns a normalized default state when the file does not exist", () => {
    expect(repo.get()).toEqual({
      version: 1,
      currentVersion: "0.4.0",
      latestVersion: null,
      availability: "unknown",
      updateStatus: "idle",
      lastCheckedAt: null,
      targetVersion: null,
      startedAt: null,
      finishedAt: null,
      requiresManualStep: false,
      manualCommand: null,
      errorSummary: null,
    });
  });

  it("persists patch updates atomically", () => {
    const next = repo.set({
      latestVersion: "0.5.0",
      availability: "update_available",
      lastCheckedAt: 1710000000000,
    });

    expect(next.latestVersion).toBe("0.5.0");
    expect(repo.get().availability).toBe("update_available");
  });

  it("preserves manual command and error summary fields", () => {
    repo.replace({
      version: 1,
      currentVersion: "0.4.0",
      latestVersion: "0.5.0",
      availability: "check_failed",
      updateStatus: "manual_required",
      lastCheckedAt: 1710000000000,
      targetVersion: "0.5.0",
      startedAt: 1710000000100,
      finishedAt: 1710000000200,
      requiresManualStep: true,
      manualCommand: "npm install -g @spencer-kit/coder-studio@0.5.0",
      errorSummary: "Permission denied",
    });

    expect(repo.get().manualCommand).toContain("@spencer-kit/coder-studio@0.5.0");
    expect(repo.get().requiresManualStep).toBe(true);
  });
});
```

- [ ] **Step 2: Run the focused repository tests and confirm RED**

```bash
pnpm --filter @coder-studio/server test -- packages/server/src/__tests__/update-state-repo.test.ts
```

Expected: FAIL because `UpdateStateRepo` does not exist yet.

- [ ] **Step 3: Implement `UpdateStateRepo` and export it**

```ts
import {
  createDefaultUpdateState,
  type UpdateStateSnapshot,
} from "@coder-studio/core";
import { readJsonFile, writeJsonFileAtomic } from "./json-file-store.js";

export interface UpdateStateRepoOptions {
  filePath: string;
  currentVersion: string;
}

function normalizeUpdateState(
  value: unknown,
  currentVersion: string
): UpdateStateSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return createDefaultUpdateState(currentVersion);
  }

  const candidate = value as Partial<UpdateStateSnapshot>;
  return {
    ...createDefaultUpdateState(currentVersion),
    ...candidate,
    version: 1,
    currentVersion,
  };
}

export class UpdateStateRepo {
  constructor(private readonly options: UpdateStateRepoOptions) {}

  get(): UpdateStateSnapshot {
    return normalizeUpdateState(
      readJsonFile<UpdateStateSnapshot>(this.options.filePath),
      this.options.currentVersion
    );
  }

  replace(next: UpdateStateSnapshot): UpdateStateSnapshot {
    const normalized = normalizeUpdateState(next, this.options.currentVersion);
    writeJsonFileAtomic(this.options.filePath, normalized);
    return normalized;
  }

  set(patch: Partial<UpdateStateSnapshot>): UpdateStateSnapshot {
    return this.replace({
      ...this.get(),
      ...patch,
      version: 1,
      currentVersion: this.options.currentVersion,
    });
  }
}
```

Modify `packages/server/src/storage/index.ts`:

```ts
export { UpdateStateRepo, type UpdateStateRepoOptions } from "./repositories/update-state-repo.js";
```

- [ ] **Step 4: Add read-only manager helpers for update preflight counts**

Modify `packages/server/src/session/manager.ts`:

```ts
getAll(): Session[] {
  return Array.from(this.sessions.values()).map((session) => session.toDTO());
}
```

Modify `packages/server/src/supervisor/manager.ts`:

```ts
countActive(): number {
  return Array.from(this.supervisors.values()).filter(
    (supervisor) => supervisor.status !== "paused" && supervisor.status !== "ended"
  ).length;
}
```

- [ ] **Step 5: Run the focused repository test and confirm GREEN**

```bash
pnpm --filter @coder-studio/server test -- packages/server/src/__tests__/update-state-repo.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/storage/repositories/update-state-repo.ts packages/server/src/__tests__/update-state-repo.test.ts packages/server/src/storage/index.ts packages/server/src/session/manager.ts packages/server/src/supervisor/manager.ts
git commit -m "feat: add persisted update state repository"
```

---

## Task 4: Build `UpdateService` for Checks, Recovery, and Worker Handoff

**Files:**
- Create: `packages/server/src/update/update-service.ts`
- Create: `packages/server/src/update/update-service.test.ts`
- Modify: `packages/server/src/config.ts`
- Modify: `packages/server/src/config.test.ts`

- [ ] **Step 1: Write the failing `UpdateService` tests**

Create `packages/server/src/update/update-service.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { UpdateStateRepo } from "../storage/repositories/update-state-repo.js";
import { UpdateService } from "./update-service.js";

describe("UpdateService", () => {
  it("marks an update as succeeded on startup when currentVersion already equals targetVersion", async () => {
    const repo = {
      get: vi.fn(() => ({
        version: 1,
        currentVersion: "0.5.0",
        latestVersion: "0.5.0",
        availability: "update_available",
        updateStatus: "restarting",
        lastCheckedAt: 1710000000000,
        targetVersion: "0.5.0",
        startedAt: 1710000000100,
        finishedAt: null,
        requiresManualStep: false,
        manualCommand: null,
        errorSummary: null,
      })),
      set: vi.fn((patch) => patch),
      replace: vi.fn((value) => value),
    } as unknown as UpdateStateRepo;

    const service = new UpdateService({
      appVersion: "0.5.0",
      settingsRepo: { get: vi.fn() },
      updateStateRepo: repo,
      updateStateFilePath: "/tmp/update-state.json",
      updateWorkerLogFilePath: "/tmp/update-worker.log",
      broadcaster: { broadcast: vi.fn() },
      terminalMgr: { getAll: vi.fn(() => []) },
      sessionMgr: { getAll: vi.fn(() => []) },
      supervisorMgr: { countActive: vi.fn(() => 0) },
      checkLatestVersion: vi.fn(),
      spawnDetachedWorker: vi.fn(),
      updateRuntime: {
        packageName: "@spencer-kit/coder-studio",
        supported: true,
        installKind: "global_npm",
        unsupportedReason: null,
        cliEntryScriptPath: "/cli/dist/bin.js",
        workerScriptPath: "/cli/dist/update-worker.js",
      },
    });

    await service.reconcileStartup();

    expect(repo.set).toHaveBeenCalledWith(
      expect.objectContaining({
        updateStatus: "succeeded",
        availability: "up_to_date",
        currentVersion: "0.5.0",
      })
    );
  });

  it("returns active-work counts from prepareInstall", async () => {
    const service = new UpdateService({
      appVersion: "0.4.0",
      settingsRepo: { get: vi.fn() },
      updateStateRepo: {
        get: vi.fn(() => ({
          version: 1,
          currentVersion: "0.4.0",
          latestVersion: "0.5.0",
          availability: "update_available",
          updateStatus: "idle",
          lastCheckedAt: 1710000000000,
          targetVersion: null,
          startedAt: null,
          finishedAt: null,
          requiresManualStep: false,
          manualCommand: null,
          errorSummary: null,
        })),
        set: vi.fn(),
        replace: vi.fn(),
      } as never,
      updateStateFilePath: "/tmp/update-state.json",
      updateWorkerLogFilePath: "/tmp/update-worker.log",
      broadcaster: { broadcast: vi.fn() },
      terminalMgr: { getAll: vi.fn(() => [{ alive: true }, { alive: false }, { alive: true }]) },
      sessionMgr: { getAll: vi.fn(() => [{ state: "running" }, { state: "idle" }, { state: "ended" }]) },
      supervisorMgr: { countActive: vi.fn(() => 1) },
      checkLatestVersion: vi.fn(),
      spawnDetachedWorker: vi.fn(),
      updateRuntime: {
        packageName: "@spencer-kit/coder-studio",
        supported: true,
        installKind: "global_npm",
        unsupportedReason: null,
        cliEntryScriptPath: "/cli/dist/bin.js",
        workerScriptPath: "/cli/dist/update-worker.js",
      },
    });

    const result = await service.prepareInstall();

    expect(result.activity).toEqual({
      runningTerminalCount: 2,
      runningSessionCount: 2,
      runningSupervisorCount: 1,
      hasActiveWork: true,
    });
  });

  it("rejects install start without force when active work exists", async () => {
    // use the same active-work setup as the previous case
    // expect code `update_active_work`
  });

  it("rebroadcasts detached-worker state transitions after file refresh", async () => {
    const broadcast = vi.fn();
    let currentState = {
      version: 1,
      currentVersion: "0.4.0",
      latestVersion: "0.5.0",
      availability: "update_available",
      updateStatus: "installing",
      lastCheckedAt: 1710000000000,
      targetVersion: "0.5.0",
      startedAt: 1710000000100,
      finishedAt: null,
      requiresManualStep: false,
      manualCommand: null,
      errorSummary: null,
    };

    const repo = {
      get: vi.fn(() => currentState),
      set: vi.fn((patch) => (currentState = { ...currentState, ...patch })),
      replace: vi.fn((value) => (currentState = value)),
    };

    const service = new UpdateService({
      appVersion: "0.4.0",
      settingsRepo: { get: vi.fn() },
      updateStateRepo: repo as never,
      updateStateFilePath: "/tmp/update-state.json",
      updateWorkerLogFilePath: "/tmp/update-worker.log",
      broadcaster: { broadcast },
      terminalMgr: { getAll: vi.fn(() => []) },
      sessionMgr: { getAll: vi.fn(() => []) },
      supervisorMgr: { countActive: vi.fn(() => 0) },
      checkLatestVersion: vi.fn(),
      spawnDetachedWorker: vi.fn(),
      updateRuntime: {
        packageName: "@spencer-kit/coder-studio",
        supported: true,
        installKind: "global_npm",
        unsupportedReason: null,
        cliEntryScriptPath: "/cli/dist/bin.js",
        workerScriptPath: "/cli/dist/update-worker.js",
      },
    });

    currentState = {
      ...currentState,
      updateStatus: "manual_required",
      requiresManualStep: true,
      manualCommand: "npm install -g @spencer-kit/coder-studio@0.5.0",
      errorSummary: "Permission denied",
    };

    await service.refreshStateFromDisk();

    expect(broadcast).toHaveBeenCalledWith(
      "update.state.changed",
      expect.objectContaining({
        updateStatus: "manual_required",
        requiresManualStep: true,
      })
    );
  });
});
```

- [ ] **Step 2: Run the focused `UpdateService` test and confirm RED**

```bash
pnpm --filter @coder-studio/server test -- packages/server/src/update/update-service.test.ts
```

Expected: FAIL because `UpdateService` and `config.update` runtime types do not exist yet.

- [ ] **Step 3: Extend server config with explicit update runtime hints**

Modify `packages/server/src/config.ts`:

```ts
export interface UpdateRuntimeConfig {
  packageName: string;
  supported: boolean;
  installKind: "global_npm" | "unsupported";
  unsupportedReason: string | null;
  cliEntryScriptPath: string | null;
  workerScriptPath: string | null;
}

export interface ServerConfig {
  // existing fields...
  update: UpdateRuntimeConfig;
}
```

Set a safe default:

```ts
update: overrides?.update ?? {
  packageName: "@spencer-kit/coder-studio",
  supported: false,
  installKind: "unsupported",
  unsupportedReason: "In-app update is only supported for global npm installs.",
  cliEntryScriptPath: null,
  workerScriptPath: null,
},
```

Add config coverage in `packages/server/src/config.test.ts`.

- [ ] **Step 4: Implement `UpdateService` with explicit lifecycle methods**

Key contract:

```ts
export interface UpdateServiceDeps {
  appVersion: string;
  settingsRepo: Pick<SettingsRepo, "get">;
  updateStateRepo: Pick<UpdateStateRepo, "get" | "set" | "replace">;
  updateStateFilePath: string;
  updateWorkerLogFilePath: string;
  broadcaster: Pick<Broadcaster, "broadcast">;
  terminalMgr: Pick<TerminalManager, "getAll">;
  sessionMgr: Pick<SessionManager, "getAll">;
  supervisorMgr: Pick<SupervisorManager, "countActive">;
  checkLatestVersion: () => Promise<string>;
  spawnDetachedWorker: (input: {
    targetVersion: string;
    stateFilePath: string;
    logFilePath: string;
    packageName: string;
    cliEntryScriptPath: string;
    workerScriptPath: string;
  }) => void;
  updateRuntime: ServerConfig["update"];
  clock?: () => number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}
```

Required methods:

```ts
reconcileStartup()
start()
reloadScheduleFromSettings()
stop()
getState()
checkForUpdates()
prepareInstall()
startInstall({ targetVersion, force })
refreshStateFromDisk()
```

Use a small local semver comparator instead of adding a dependency:

```ts
function compareSemver(left: string, right: string): number {
  const normalize = (value: string) =>
    value
      .split("-", 1)[0]!
      .split(".")
      .map((part) => Number.parseInt(part, 10));
  const [la = 0, lb = 0, lc = 0] = normalize(left);
  const [ra = 0, rb = 0, rc = 0] = normalize(right);
  if (la !== ra) return la - ra;
  if (lb !== rb) return lb - rb;
  return lc - rc;
}
```

Rules:
- startup success when `targetVersion === currentVersion`
- startup failure when persisted state is `installing` or `restarting` but version did not advance
- preserve `manual_required` until a future success replaces it
- `updates.check` and `updates.startInstall` must reject while another check/install is in progress
- auto-check timer must rebuild immediately when update settings change
- `startInstall()` must use `updateStateFilePath` and `updateWorkerLogFilePath` when launching the detached worker

- [ ] **Step 5: Run the focused `UpdateService` test and confirm GREEN**

```bash
pnpm --filter @coder-studio/server test -- packages/server/src/update/update-service.test.ts packages/server/src/config.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/update/update-service.ts packages/server/src/update/update-service.test.ts packages/server/src/config.ts packages/server/src/config.test.ts
git commit -m "feat: add server update orchestration service"
```

---

## Task 5: Expose Update Commands and Wire the Service into Server Startup

**Files:**
- Create: `packages/server/src/commands/updates.ts`
- Create: `packages/server/src/commands/updates.test.ts`
- Modify: `packages/server/src/commands/index.ts`
- Modify: `packages/server/src/ws/dispatch.ts`
- Modify: `packages/server/src/server.ts`

- [ ] **Step 1: Write the failing command tests**

Create `packages/server/src/commands/updates.test.ts` with `updates.getState` and `updates.startInstall` forwarding assertions against `ctx.updateService`.

- [ ] **Step 2: Run the focused update command tests and confirm RED**

```bash
pnpm --filter @coder-studio/server test -- packages/server/src/commands/updates.test.ts
```

- [ ] **Step 3: Implement the `updates.*` command surface**

Register:

```ts
updates.getState
updates.check
updates.prepareInstall
updates.startInstall
```

Schema for `updates.startInstall`:

```ts
z.object({
  targetVersion: z.string(),
  force: z.boolean().default(false),
})
```

Extend `CommandContext`:

```ts
updateService?: UpdateService;
```

- [ ] **Step 4: Wire `UpdateService` into `createServer()`**

In `packages/server/src/server.ts`:

```ts
const updateStateFilePath = join(stateRoot, "state", "update-state.json");
const updateStateRepo = new UpdateStateRepo({
  filePath: updateStateFilePath,
  currentVersion: config.appVersion ?? "0.0.0",
});
const updateLogFilePath = join(stateRoot, "logs", "update-worker.log");

const updateService = new UpdateService({
  appVersion: config.appVersion ?? "0.0.0",
  settingsRepo,
  updateStateRepo,
  updateStateFilePath,
  updateWorkerLogFilePath: updateLogFilePath,
  broadcaster: wsHub,
  terminalMgr,
  sessionMgr,
  supervisorMgr: supervisorMgr!,
  updateRuntime: config.update,
  checkLatestVersion: async () => {
    const result = await runCommandAsString("npm", [
      "view",
      config.update.packageName,
      "dist-tags.latest",
      "--json",
    ]);
    return JSON.parse(result.stdout) as string;
  },
  spawnDetachedWorker: ({
    targetVersion,
    stateFilePath,
    logFilePath,
    packageName,
    cliEntryScriptPath,
    workerScriptPath,
  }) => {
    mkdirSync(dirname(logFilePath), { recursive: true });
    const logFd = openSync(logFilePath, "a");
    const child = spawn(
      process.execPath,
      [
        workerScriptPath,
        "--state-file",
        stateFilePath,
        "--target-version",
        targetVersion,
        "--package-name",
        packageName,
        "--cli-entry",
        cliEntryScriptPath,
      ],
      {
        detached: true,
        stdio: ["ignore", logFd, logFd],
        windowsHide: true,
      }
    );
    child.unref();
  },
});
```

Then:

```ts
commandContext.updateService = updateService;
updateService.start();
// on stop:
updateService.stop();
```

- [ ] **Step 5: Run the focused command and server wiring tests and confirm GREEN**

```bash
pnpm --filter @coder-studio/server test -- packages/server/src/commands/updates.test.ts packages/server/src/update/update-service.test.ts packages/server/src/commands/settings.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/commands/updates.ts packages/server/src/commands/updates.test.ts packages/server/src/commands/index.ts packages/server/src/ws/dispatch.ts packages/server/src/server.ts
git commit -m "feat: expose update commands from server"
```

---

## Task 6: Add CLI Runtime Hints and Detached Worker Execution

**Files:**
- Create: `packages/cli/src/update-runtime.ts`
- Create: `packages/cli/src/update-runtime.test.ts`
- Create: `packages/cli/src/update-worker.ts`
- Create: `packages/cli/src/update-worker.test.ts`
- Modify: `packages/cli/src/package-manifest.ts`
- Modify: `packages/cli/src/server-runner.ts`

- [ ] **Step 1: Write the failing CLI runtime/worker tests**

Cover:
- unsupported install shape when CLI package path is not under `npm root -g`
- `manual_required` fallback when global install fails with permission error
- `restarting` transition before `coder-studio serve --restart`

- [ ] **Step 2: Run the focused CLI tests and confirm RED**

```bash
pnpm --filter @spencer-kit/coder-studio test -- packages/cli/src/update-runtime.test.ts packages/cli/src/update-worker.test.ts
```

- [ ] **Step 3: Expose package name and detect supported install/runtime paths**

`package-manifest.ts`:

```ts
interface CliPackageManifest {
  name?: string;
  version?: string;
}

export function getCliPackageName(importMetaUrl: string): string {
  return getCliPackageManifest(importMetaUrl).name ?? "@spencer-kit/coder-studio";
}
```

`update-runtime.ts` responsibilities:
- resolve package name
- resolve `bin.js` / `src/bin.ts`
- resolve `update-worker.js` / `src/update-worker.ts`
- run `npm root -g`
- mark support only when current package manifest lives under that global root and both CLI/worker entry paths exist

`server-runner.ts`:

```ts
import { detectUpdateRuntime } from "./update-runtime.js";

update: detectUpdateRuntime(import.meta.url),
```

- [ ] **Step 4: Implement the detached worker with built-in-only runtime**

Worker contract:
- read `--state-file`, `--target-version`, `--package-name`, `--cli-entry`
- run `npm install -g <package>@<targetVersion>`
- on permission failure write:

```json
{
  "updateStatus": "manual_required",
  "requiresManualStep": true,
  "manualCommand": "npm install -g @spencer-kit/coder-studio@0.5.0"
}
```

- on non-permission failure write `failed`
- on success write `restarting` then invoke:

```bash
node <cli-entry> serve --restart
```

- [ ] **Step 5: Run the focused CLI tests and confirm GREEN**

```bash
pnpm --filter @spencer-kit/coder-studio test -- packages/cli/src/update-runtime.test.ts packages/cli/src/update-worker.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/package-manifest.ts packages/cli/src/server-runner.ts packages/cli/src/update-runtime.ts packages/cli/src/update-runtime.test.ts packages/cli/src/update-worker.ts packages/cli/src/update-worker.test.ts
git commit -m "feat: add detached cli updater worker"
```

---

## Task 7: Hydrate Global Update State, Toasts, and Settings Entry Markers

**Files:**
- Create: `packages/web/src/features/updates/atoms.ts`
- Modify: `packages/web/src/app/providers.tsx`
- Modify: `packages/web/src/app/providers.test.tsx`
- Modify: `packages/web/src/theme/icon-theme.ts`
- Modify: `packages/web/src/features/topbar/index.tsx`
- Modify: `packages/web/src/features/topbar/index.test.tsx`
- Modify: `packages/web/src/features/workspace/views/mobile/mobile-topbar.tsx`

- [ ] **Step 1: Write the failing provider/topbar tests**

Add provider coverage for:
- initial `updates.getState` hydration on connect
- `update.state.changed` event routing into atoms
- discovery toast only when a newer version becomes newly available

Add topbar coverage for:
- update marker visible when `availability === "update_available"`
- marker hidden when `up_to_date` or unsupported

- [ ] **Step 2: Run the focused web tests and confirm RED**

```bash
pnpm --filter @coder-studio/web test -- packages/web/src/app/providers.test.tsx packages/web/src/features/topbar/index.test.tsx
```

- [ ] **Step 3: Add global update atoms and provider hydration**

Create `packages/web/src/features/updates/atoms.ts`:

```ts
import type { UpdateStateView } from "@coder-studio/core";
import { atom } from "jotai";

export const updateStateAtom = atom<UpdateStateView | null>(null);

export const updateAvailableAtom = atom((get) => {
  const state = get(updateStateAtom);
  return Boolean(
    state &&
      state.availability === "update_available" &&
      state.latestVersion &&
      state.latestVersion !== state.currentVersion
  );
});
```

Modify `packages/web/src/app/providers.tsx`:
- subscribe to `update.state.changed`
- hydrate via `dispatch("updates.getState", {})` after connection
- route the event into `updateStateAtom`
- push a toast when a newly seen `latestVersion` appears

- [ ] **Step 4: Show settings-entry markers in desktop and mobile chrome**

Modify `packages/web/src/theme/icon-theme.ts`:

```ts
"nav.settings.about"
```

and:

```ts
"nav.settings.about": { glyph: Info, tone: "secondary" },
```

Wrap both desktop and mobile settings triggers with a small badge element that keys off `updateAvailableAtom`.

- [ ] **Step 5: Run the focused web tests and confirm GREEN**

```bash
pnpm --filter @coder-studio/web test -- packages/web/src/app/providers.test.tsx packages/web/src/features/topbar/index.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/features/updates/atoms.ts packages/web/src/app/providers.tsx packages/web/src/app/providers.test.tsx packages/web/src/theme/icon-theme.ts packages/web/src/features/topbar/index.tsx packages/web/src/features/topbar/index.test.tsx packages/web/src/features/workspace/views/mobile/mobile-topbar.tsx
git commit -m "feat: surface update availability in web chrome"
```

---

## Task 8: Add Settings > About UI, Manual Check, Auto-Check Controls, and Install Confirmation

**Files:**
- Create: `packages/web/src/features/settings/components/about-settings.tsx`
- Create: `packages/web/src/features/settings/components/about-settings.test.tsx`
- Modify: `packages/web/src/features/settings/components/settings-sections.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.test.tsx`
- Modify: `packages/web/src/locales/zh.json`
- Modify: `packages/web/src/locales/en.json`

- [ ] **Step 1: Write the failing About/settings-page tests**

Cover:
- About appears in desktop and mobile settings navigation
- About renders current/latest version, support state, availability, update status, last checked, and error summary
- “查询更新 / Check for updates” calls `updates.check`
- “立即更新 / Update now” first calls `updates.prepareInstall`
- confirmation dialog appears when activity counts are non-zero
- confirmed dialog calls `updates.startInstall` with `force: true`
- `manual_required` shows the manual command and disables the primary update button
- auto-check switch / interval select persist through `settings.update`

- [ ] **Step 2: Run the focused About/settings tests and confirm RED**

```bash
pnpm --filter @coder-studio/web test -- packages/web/src/features/settings/components/about-settings.test.tsx packages/web/src/features/settings/components/settings-page.test.tsx
```

- [ ] **Step 3: Add the new About section metadata**

`settings-sections.tsx`:

```ts
export type SettingsSection =
  | "general"
  | "appearance"
  | "providers"
  | "shortcuts"
  | "about";
```

Add:

```ts
{ id: "about", labelKey: "settings.about.title", iconSemantic: "nav.settings.about" }
```

In `settings-page.tsx`, extend the hint switch:

```ts
case "about":
  return "settings.about.hint";
```

Update mobile groups so the existing guard still passes:

```ts
const MOBILE_SETTINGS_GROUPS = [
  {
    titleKey: "settings.mobile_groups.workspace_runtime",
    sections: ["general", "providers"],
  },
  {
    titleKey: "settings.mobile_groups.interface_interaction",
    sections: ["appearance", "shortcuts", "about"],
  },
] as const;
```

- [ ] **Step 4: Load and persist update settings in `SettingsPage`**

State:

```tsx
const [updateAutoCheckEnabled, setUpdateAutoCheckEnabled] = useState(true);
const [updateCheckIntervalSec, setUpdateCheckIntervalSec] = useState<UpdateCheckIntervalSec>(21600);
```

Hydrate from `settings.get`:

```tsx
if (typeof settings["updates.autoCheckEnabled"] === "boolean") {
  setUpdateAutoCheckEnabled(settings["updates.autoCheckEnabled"]);
}
if (UPDATE_CHECK_INTERVAL_OPTIONS.includes(settings["updates.checkIntervalSec"] as UpdateCheckIntervalSec)) {
  setUpdateCheckIntervalSec(settings["updates.checkIntervalSec"] as UpdateCheckIntervalSec);
}
```

Persist helper:

```tsx
const persistUpdateSettings = async (next: {
  autoCheckEnabled: boolean;
  checkIntervalSec: UpdateCheckIntervalSec;
}) => {
  const result = await dispatch("settings.update", {
    settings: {
      updates: {
        autoCheckEnabled: next.autoCheckEnabled,
        checkIntervalSec: next.checkIntervalSec,
      },
    },
  });
  if (!result.ok) {
    throw new Error(result.error?.message ?? "Failed to save update settings");
  }
  setUpdateAutoCheckEnabled(next.autoCheckEnabled);
  setUpdateCheckIntervalSec(next.checkIntervalSec);
};
```

Add About render branch and nav badge support:

```tsx
badge={id === "about" && updateAvailable ? <span className="settings-nav-badge" /> : null}
```

Update `SettingsNavItemProps` to accept `badge?: React.ReactNode`.

- [ ] **Step 5: Implement `AboutSettings`**

Component responsibilities:
- render product/current version/latest version/server instance/support state
- render availability/update status/last checked/error summary
- render `Check for updates` and `Update now`
- disable `Check for updates` while checking/installing/restarting
- disable `Update now` while unsupported, busy, or `manual_required`
- call `updates.prepareInstall`
- show `ConfirmDialog` when activity counts are non-zero
- on confirm call `updates.startInstall({ targetVersion, force: true })`
- show manual command notice when `manual_required`
- show reconnect/restarting notice during `restarting` or websocket reconnect
- persist `autoCheckEnabled` and `checkIntervalSec` through the callback prop

- [ ] **Step 6: Add translation strings**

Add to both `zh.json` and `en.json`:

```json
"settings": {
  "about": {
    "title": "关于 / About",
    "hint": "...",
    "current_version": "...",
    "latest_version": "...",
    "server_instance": "...",
    "install_support": "...",
    "availability": "...",
    "update_status": "...",
    "last_checked": "...",
    "error_summary": "...",
    "supported": "...",
    "unsupported": "...",
    "check_updates": "...",
    "update_now": "...",
    "manual_required": "...",
    "restarting_notice": "...",
    "confirm_title": "...",
    "confirm_body": "...",
    "confirm_update": "..."
  }
}
```

- [ ] **Step 7: Run the focused About/settings tests and confirm GREEN**

```bash
pnpm --filter @coder-studio/web test -- packages/web/src/features/settings/components/about-settings.test.tsx packages/web/src/features/settings/components/settings-page.test.tsx packages/web/src/app/providers.test.tsx packages/web/src/features/topbar/index.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/features/settings/components/about-settings.tsx packages/web/src/features/settings/components/about-settings.test.tsx packages/web/src/features/settings/components/settings-sections.tsx packages/web/src/features/settings/components/settings-page.tsx packages/web/src/features/settings/components/settings-page.test.tsx packages/web/src/locales/zh.json packages/web/src/locales/en.json
git commit -m "feat: add settings about update surface"
```

---

## Task 9: Final Verification and Integration Pass

**Files:** none

- [ ] **Step 1: Run the focused package tests added by this plan**

```bash
pnpm --filter @coder-studio/core test -- packages/core/src/domain/update.test.ts
pnpm --filter @coder-studio/server test -- packages/server/src/__tests__/update-state-repo.test.ts packages/server/src/update/update-service.test.ts packages/server/src/commands/updates.test.ts packages/server/src/commands/settings.test.ts
pnpm --filter @spencer-kit/coder-studio test -- packages/cli/src/update-runtime.test.ts packages/cli/src/update-worker.test.ts
pnpm --filter @coder-studio/web test -- packages/web/src/features/settings/components/about-settings.test.tsx packages/web/src/features/settings/components/settings-page.test.tsx packages/web/src/app/providers.test.tsx packages/web/src/features/topbar/index.test.tsx
```

Expected: PASS across all focused update-related suites.

- [ ] **Step 2: Run workspace typecheck**

```bash
pnpm ci:typecheck
```

Expected: PASS.

- [ ] **Step 3: Run a narrow production-minded behavior check**

```text
1. Start the managed app from a supported global npm install.
2. Open Settings > About and confirm current version/support metadata render.
3. Trigger Query Updates and confirm latest version / last checked timestamp changes.
4. Seed active terminals or sessions and click Update Now; confirm the warning dialog appears.
5. Confirm the dialog, observe update-state.json move through installing/restarting, and verify the app reconnects on the new version.
6. Simulate a permission-denied install and confirm the About page shows manual command text instead of a broken spinner.
```

- [ ] **Step 4: Commit the final integration if verification required cleanup edits**

If the verification pass required code or test cleanup:

```bash
git add packages/core/src/domain/update.ts packages/core/src/domain/update.test.ts packages/server/src/storage/repositories/update-state-repo.ts packages/server/src/__tests__/update-state-repo.test.ts packages/server/src/update/update-service.ts packages/server/src/update/update-service.test.ts packages/server/src/commands/updates.ts packages/server/src/commands/updates.test.ts packages/server/src/commands/settings.ts packages/server/src/commands/settings.test.ts packages/server/src/config.ts packages/server/src/config.test.ts packages/server/src/ws/dispatch.ts packages/server/src/server.ts packages/cli/src/package-manifest.ts packages/cli/src/server-runner.ts packages/cli/src/update-runtime.ts packages/cli/src/update-runtime.test.ts packages/cli/src/update-worker.ts packages/cli/src/update-worker.test.ts packages/web/src/features/updates/atoms.ts packages/web/src/app/providers.tsx packages/web/src/app/providers.test.tsx packages/web/src/theme/icon-theme.ts packages/web/src/features/topbar/index.tsx packages/web/src/features/topbar/index.test.tsx packages/web/src/features/workspace/views/mobile/mobile-topbar.tsx packages/web/src/features/settings/components/about-settings.tsx packages/web/src/features/settings/components/about-settings.test.tsx packages/web/src/features/settings/components/settings-sections.tsx packages/web/src/features/settings/components/settings-page.tsx packages/web/src/features/settings/components/settings-page.test.tsx packages/web/src/locales/zh.json packages/web/src/locales/en.json
git commit -m "fix: finalize in-app auto update verification"
```

If no cleanup edits were needed, skip this commit and leave the prior task commits intact.
