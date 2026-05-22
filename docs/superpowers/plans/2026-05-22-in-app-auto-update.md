# In-App Auto Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe in-app npm update flow with persisted update preferences, detached install/restart execution, and a Settings > About UI for manual checks and update actions.

**Architecture:** The server owns update discovery, state persistence, and UI-facing commands, while a detached CLI worker performs `npm install -g` and restart so the live server process does not self-terminate mid-update. Durable user preferences stay in `settings.json`, workflow checkpoints stay in `update-state.json`, and the web app hydrates/subscribes to update state through websocket events and settings commands.

**Tech Stack:** TypeScript, Vitest, Jotai, React, zod, Node child processes

---

### Task 1: Stabilize Shared Update Domain And Server State Plumbing

**Files:**
- Modify: `packages/server/src/storage/repositories/update-state-repo.ts`
- Modify: `packages/server/src/update/update-service.test.ts`
- Modify: `packages/server/src/commands/settings.test.ts`
- Test: `packages/server/src/update/update-service.test.ts`
- Test: `packages/server/src/__tests__/update-state-repo.test.ts`
- Test: `packages/server/src/commands/settings.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it("keeps check failure in availability without switching workflow to failed", async () => {
  const deps = createDeps({
    runLatestVersionLookup: vi.fn(async () => {
      throw new Error("registry down");
    }),
  });
  const service = new UpdateService(deps);

  const result = await service.checkForUpdates({ manual: true });

  expect(result.availability).toBe("check_failed");
  expect(result.updateStatus).toBe("idle");
});

it("treats older published versions as up_to_date", async () => {
  const deps = createDeps({
    runLatestVersionLookup: vi.fn(async () => "0.3.9"),
  });
  const service = new UpdateService(deps);

  const result = await service.checkForUpdates({ manual: true });

  expect(result.availability).toBe("up_to_date");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @coder-studio/server test -- packages/server/src/update/update-service.test.ts packages/server/src/commands/settings.test.ts packages/server/src/__tests__/update-state-repo.test.ts`
Expected: FAIL because `UpdateService` still marks check failures as `failed`, uses naive version comparison, and `settings.test.ts` is missing `vi` import.

- [ ] **Step 3: Write minimal implementation**

```ts
export class UpdateStateRepo {
  getFilePath(): string {
    return this.filePath;
  }
}

function compareVersions(currentVersion: string, latestVersion: string): number {
  const currentParts = currentVersion.split(".").map((part) => Number.parseInt(part, 10));
  const latestParts = latestVersion.split(".").map((part) => Number.parseInt(part, 10));
  const length = Math.max(currentParts.length, latestParts.length);
  for (let index = 0; index < length; index += 1) {
    const current = Number.isFinite(currentParts[index] ?? 0) ? (currentParts[index] ?? 0) : 0;
    const latest = Number.isFinite(latestParts[index] ?? 0) ? (latestParts[index] ?? 0) : 0;
    if (latest > current) return 1;
    if (latest < current) return -1;
  }
  return 0;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @coder-studio/server test -- packages/server/src/update/update-service.test.ts packages/server/src/commands/settings.test.ts packages/server/src/__tests__/update-state-repo.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/storage/repositories/update-state-repo.ts packages/server/src/update/update-service.test.ts packages/server/src/commands/settings.test.ts
git commit -m "fix: stabilize update service state handling"
```

### Task 2: Finish Server Command And Detached Worker Contract

**Files:**
- Modify: `packages/server/src/update/update-service.ts`
- Modify: `packages/server/src/commands/updates.test.ts`
- Modify: `packages/server/src/server.ts`
- Modify: `packages/cli/src/update-worker.test.ts`
- Modify: `packages/cli/src/update-runtime.test.ts`
- Test: `packages/server/src/commands/updates.test.ts`
- Test: `packages/cli/src/update-runtime.test.ts`
- Test: `packages/cli/src/update-worker.test.ts`
- Test: `packages/cli/src/server-runner.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it("passes the update state file path into the detached worker contract", async () => {
  const spawnDetachedWorker = vi.fn(async () => {});
  const deps = createDeps({ spawnDetachedWorker });
  const service = new UpdateService(deps);

  await service.startInstall({ targetVersion: "0.5.0", force: true });

  expect(spawnDetachedWorker).toHaveBeenCalledWith(
    expect.objectContaining({
      stateFilePath: "/tmp/update-state.json",
    })
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @coder-studio/server test -- packages/server/src/commands/updates.test.ts packages/server/src/update/update-service.test.ts && pnpm --filter @spencer-kit/coder-studio test -- packages/cli/src/update-runtime.test.ts packages/cli/src/update-worker.test.ts packages/cli/src/server-runner.test.ts`
Expected: FAIL until the server passes a clean repo contract and all runtime expectations are aligned.

- [ ] **Step 3: Write minimal implementation**

```ts
await this.spawnDetachedWorker({
  workerEntryPath: this.runtime.workerEntryPath,
  stateFilePath: this.deps.updateStateRepo.getFilePath(),
  logFilePath: this.updateWorkerLogFilePath,
  packageName: this.runtime.packageName,
  targetVersion,
  cliCommand: this.runtime.cliCommand,
  currentVersion: this.runtime.currentVersion,
  npmCommand: this.runtime.npmCommand ?? "npm",
  restartArgs: this.runtime.restartArgs ?? ["serve", "--restart"],
  installArgsPrefix: this.runtime.installArgsPrefix ?? ["install", "-g"],
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @coder-studio/server test -- packages/server/src/commands/updates.test.ts packages/server/src/update/update-service.test.ts && pnpm --filter @spencer-kit/coder-studio test -- packages/cli/src/update-runtime.test.ts packages/cli/src/update-worker.test.ts packages/cli/src/server-runner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/update/update-service.ts packages/server/src/commands/updates.test.ts packages/server/src/server.ts packages/cli/src/update-runtime.test.ts packages/cli/src/update-worker.test.ts packages/cli/src/server-runner.test.ts
git commit -m "feat: finish detached updater contract"
```

### Task 3: Hydrate Update State In The Web App And Surface Entry Markers

**Files:**
- Modify: `packages/web/src/app/providers.tsx`
- Modify: `packages/web/src/app/providers.test.tsx`
- Modify: `packages/web/src/app/providers.lifecycle.test.tsx`
- Modify: `packages/web/src/features/updates/atoms.ts`
- Modify: `packages/web/src/features/topbar/index.tsx`
- Modify: `packages/web/src/features/topbar/index.test.tsx`
- Modify: `packages/web/src/features/workspace/views/mobile/mobile-topbar.tsx`
- Test: `packages/web/src/app/providers.test.tsx`
- Test: `packages/web/src/app/providers.lifecycle.test.tsx`
- Test: `packages/web/src/features/topbar/index.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
it("stores update state events from update.state.changed", () => {
  routeEventToAtom(
    "update.state.changed",
    {
      currentVersion: "0.4.0",
      latestVersion: "0.5.0",
      availability: "update_available",
      updateStatus: "idle",
      supported: true,
      installKind: "global_npm",
      unsupportedReason: null,
    },
    store
  );

  expect(store.get(updateStateAtom)?.latestVersion).toBe("0.5.0");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @coder-studio/web test -- packages/web/src/app/providers.test.tsx packages/web/src/app/providers.lifecycle.test.tsx packages/web/src/features/topbar/index.test.tsx`
Expected: FAIL because update hydration/subscription and marker rendering are not wired yet.

- [ ] **Step 3: Write minimal implementation**

```tsx
if (topic === "update.state.changed") {
  store.set(updateStateAtom, payload as UpdateStateView);
  return;
}

const updateResult = await dispatch<UpdateStateView>("updates.getState", {});
if (updateResult.ok && updateResult.data) {
  setUpdateState(updateResult.data);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @coder-studio/web test -- packages/web/src/app/providers.test.tsx packages/web/src/app/providers.lifecycle.test.tsx packages/web/src/features/topbar/index.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/providers.tsx packages/web/src/app/providers.test.tsx packages/web/src/app/providers.lifecycle.test.tsx packages/web/src/features/updates/atoms.ts packages/web/src/features/topbar/index.tsx packages/web/src/features/topbar/index.test.tsx packages/web/src/features/workspace/views/mobile/mobile-topbar.tsx
git commit -m "feat: surface update state markers in the app shell"
```

### Task 4: Complete Settings About UI And Persist Update Preferences

**Files:**
- Modify: `packages/web/src/features/settings/components/settings-sections.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.test.tsx`
- Modify: `packages/web/src/features/settings/components/about-settings.tsx`
- Add: `packages/web/src/features/settings/components/about-settings.test.tsx`
- Modify: `packages/web/src/theme/icon-theme.ts`
- Modify: `packages/web/src/locales/zh.json`
- Modify: `packages/web/src/locales/en.json`
- Test: `packages/web/src/features/settings/components/about-settings.test.tsx`
- Test: `packages/web/src/features/settings/components/settings-page.test.tsx`
- Test: `packages/web/src/theme/icon-theme.test.ts`

- [ ] **Step 1: Write the failing tests**

```tsx
it("renders the About section and saves update preferences through settings.update", async () => {
  renderSettingsPage();

  await user.click(await screen.findByRole("button", { name: "关于" }));
  await user.click(screen.getByRole("button", { name: "已启用" }));

  expect(sendCommand).toHaveBeenCalledWith(
    "settings.update",
    expect.objectContaining({
      settings: { updates: { autoCheckEnabled: false } },
    }),
    undefined
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @coder-studio/web test -- packages/web/src/features/settings/components/about-settings.test.tsx packages/web/src/features/settings/components/settings-page.test.tsx packages/web/src/theme/icon-theme.test.ts`
Expected: FAIL because the About section is not registered, settings do not hydrate update prefs, and locale/icon keys are missing.

- [ ] **Step 3: Write minimal implementation**

```tsx
case "about":
  return (
    <AboutSettings
      autoCheckEnabled={updateAutoCheckEnabled}
      checkIntervalSec={updateCheckIntervalSec}
      onAutoCheckEnabledChange={handleUpdateAutoCheckChange}
      onCheckIntervalChange={handleUpdateIntervalChange}
      locale={locale}
    />
  );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @coder-studio/web test -- packages/web/src/features/settings/components/about-settings.test.tsx packages/web/src/features/settings/components/settings-page.test.tsx packages/web/src/theme/icon-theme.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/settings/components/settings-sections.tsx packages/web/src/features/settings/components/settings-page.tsx packages/web/src/features/settings/components/settings-page.test.tsx packages/web/src/features/settings/components/about-settings.tsx packages/web/src/features/settings/components/about-settings.test.tsx packages/web/src/theme/icon-theme.ts packages/web/src/locales/zh.json packages/web/src/locales/en.json
git commit -m "feat: add settings about update surface"
```

### Task 5: Final Verification

**Files:**
- Verify only

- [ ] **Step 1: Run focused package verification**

Run: `pnpm --filter @coder-studio/core test -- packages/core/src/domain/update.test.ts && pnpm --filter @coder-studio/server test -- packages/server/src/commands/settings.test.ts packages/server/src/__tests__/update-state-repo.test.ts packages/server/src/update/update-service.test.ts packages/server/src/commands/updates.test.ts && pnpm --filter @spencer-kit/coder-studio test -- packages/cli/src/update-runtime.test.ts packages/cli/src/update-worker.test.ts packages/cli/src/server-runner.test.ts && pnpm --filter @coder-studio/web test -- packages/web/src/features/settings/components/about-settings.test.tsx packages/web/src/app/providers.test.tsx packages/web/src/app/providers.lifecycle.test.tsx packages/web/src/features/settings/components/settings-page.test.tsx packages/web/src/features/topbar/index.test.tsx packages/web/src/theme/icon-theme.test.ts`
Expected: PASS

- [ ] **Step 2: Run broader confidence checks**

Run: `pnpm --filter @coder-studio/server test && pnpm --filter @coder-studio/web test`
Expected: PASS, or document any unrelated baseline failures explicitly.

- [ ] **Step 3: Review git diff**

Run: `git status --short && git diff --stat`
Expected: only the intended auto-update feature files are changed.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat: implement in-app auto update flow"
```
