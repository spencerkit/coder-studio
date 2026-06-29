# Desktop Shell Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GitHub Releases-backed Electron shell updater for packaged desktop builds while preserving the current runtime updater as a separate channel.

**Architecture:** The Electron main process owns shell update state and updater transport through a dedicated `ShellUpdateService`. The renderer reaches that service through preload IPC, while runtime updates remain server-backed and continue to flow through the existing `UpdateService` and desktop runtime bridge.

**Tech Stack:** TypeScript, Electron, electron-builder, electron-updater, React, Jotai or local React state, Vitest.

**Spec reference:** `docs/superpowers/specs/2026-06-29-desktop-shell-update-design.md`

---

## File Structure

**Create:**

- `packages/desktop/src/shell-update-types.ts` — normalized shell update state/types shared by main/preload/tests
- `packages/desktop/src/shell-update-service.ts` — Electron main-process shell update orchestration
- `packages/desktop/src/shell-update-service.test.ts` — service unit tests with mocked updater
- `packages/web/src/features/desktop-shell/use-shell-update.ts` — renderer hook wrapping preload shell update API
- `packages/web/src/features/desktop-shell/use-shell-update.test.tsx` — hook tests for preload-backed state hydration/subscription

**Modify:**

- `packages/desktop/package.json` — add shell updater dependency and GitHub publish config
- `packages/desktop/src/main.ts` — instantiate `ShellUpdateService`, register IPC handlers/events
- `packages/desktop/src/preload.ts` — expose `shellUpdate` API
- `packages/desktop/src/error-page.ts` — optional type-only update for preload typing visibility if needed
- `packages/web/src/features/settings/components/about-settings.tsx` — add desktop shell update section
- `packages/web/src/features/settings/components/about-settings.test.tsx` — add shell update UI coverage
- `packages/web/src/global.d.ts` or existing desktop bridge typings file — declare `window.coderStudioDesktop.shellUpdate`

**No changes in this plan:**

- no Linux shell auto-update
- no runtime update refactor
- no server websocket/API changes for shell update
- no app self-update from plain browser mode

---

### Task 1: Add Shell Update State Types

**Files:**
- Create: `packages/desktop/src/shell-update-types.ts`
- Test: `packages/desktop/src/shell-update-service.test.ts`

- [ ] **Step 1: Write the failing service test for default unsupported state**

```ts
import { describe, expect, it } from "vitest";
import { createDefaultShellUpdateState } from "./shell-update-types";

describe("shell update types", () => {
  it("creates an unsupported default state", () => {
    expect(createDefaultShellUpdateState({ currentVersion: "1.2.3", supported: false })).toEqual({
      supported: false,
      currentVersion: "1.2.3",
      latestVersion: null,
      availability: "unknown",
      status: "idle",
      lastCheckedAt: null,
      errorSummary: null,
      releaseNotes: null,
    });
  });
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```bash
pnpm --filter @coder-studio/desktop test -- packages/desktop/src/shell-update-service.test.ts
```

Expected: FAIL because `shell-update-types.ts` does not exist yet.

- [ ] **Step 3: Write the minimal shared types**

Create `packages/desktop/src/shell-update-types.ts`:

```ts
export type ShellUpdateAvailability =
  | "unknown"
  | "up_to_date"
  | "update_available"
  | "downloaded"
  | "error";

export type ShellUpdateStatus =
  | "idle"
  | "checking"
  | "downloading"
  | "ready_to_restart"
  | "installing"
  | "failed";

export interface ShellUpdateState {
  supported: boolean;
  currentVersion: string;
  latestVersion: string | null;
  availability: ShellUpdateAvailability;
  status: ShellUpdateStatus;
  lastCheckedAt: number | null;
  errorSummary: string | null;
  releaseNotes: string | null;
}

export function createDefaultShellUpdateState(input: {
  currentVersion: string;
  supported: boolean;
}): ShellUpdateState {
  return {
    supported: input.supported,
    currentVersion: input.currentVersion,
    latestVersion: null,
    availability: "unknown",
    status: "idle",
    lastCheckedAt: null,
    errorSummary: null,
    releaseNotes: null,
  };
}
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run:

```bash
pnpm --filter @coder-studio/desktop test -- packages/desktop/src/shell-update-service.test.ts
```

Expected: PASS for the default-state test.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/shell-update-types.ts packages/desktop/src/shell-update-service.test.ts
git commit -m "feat: add desktop shell update state types"
```

### Task 2: Implement Main-Process Shell Update Service

**Files:**
- Create: `packages/desktop/src/shell-update-service.ts`
- Modify: `packages/desktop/package.json`
- Test: `packages/desktop/src/shell-update-service.test.ts`

- [ ] **Step 1: Write failing service tests for check, download, and restart state transitions**

Add tests covering:

```ts
it("reports unsupported when running unpackaged", async () => {
  const service = new ShellUpdateService({
    appVersion: "1.2.3",
    isPackaged: false,
    platform: "win32",
    updater: createMockUpdater(),
  });

  expect(service.getState().supported).toBe(false);
});

it("marks update_available after updater reports a newer version", async () => {
  const updater = createMockUpdater();
  const service = new ShellUpdateService({
    appVersion: "1.2.3",
    isPackaged: true,
    platform: "win32",
    updater,
  });

  updater.emitChecking();
  updater.emitAvailable({ version: "1.2.4", releaseNotes: "Bug fixes" });

  const state = await service.checkForUpdates();
  expect(state.latestVersion).toBe("1.2.4");
  expect(state.availability).toBe("update_available");
});

it("marks ready_to_restart after download completes", async () => {
  const updater = createMockUpdater();
  const service = new ShellUpdateService({
    appVersion: "1.2.3",
    isPackaged: true,
    platform: "darwin",
    updater,
  });

  updater.emitDownloaded({ version: "1.2.4" });

  expect(service.getState().status).toBe("ready_to_restart");
  expect(service.getState().availability).toBe("downloaded");
});
```

- [ ] **Step 2: Run the focused desktop tests and verify they fail**

Run:

```bash
pnpm --filter @coder-studio/desktop test -- packages/desktop/src/shell-update-service.test.ts
```

Expected: FAIL because `ShellUpdateService` is not implemented.

- [ ] **Step 3: Implement the service with a thin updater adapter**

Create `packages/desktop/src/shell-update-service.ts` with:

```ts
import { EventEmitter } from "node:events";
import { createDefaultShellUpdateState, type ShellUpdateState } from "./shell-update-types";

export interface ShellUpdateServiceUpdater {
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: string, listener: (...args: unknown[]) => void): this;
}

export class ShellUpdateService extends EventEmitter {
  private state: ShellUpdateState;

  constructor(
    private readonly deps: {
      appVersion: string;
      isPackaged: boolean;
      platform: NodeJS.Platform;
      updater: ShellUpdateServiceUpdater;
      now?: () => number;
    }
  ) {
    super();
    const supported =
      this.deps.isPackaged && (this.deps.platform === "win32" || this.deps.platform === "darwin");
    this.state = createDefaultShellUpdateState({
      currentVersion: this.deps.appVersion,
      supported,
    });
    if (supported) {
      this.bindUpdaterEvents();
    }
  }

  getState(): ShellUpdateState {
    return { ...this.state };
  }

  async checkForUpdates(): Promise<ShellUpdateState> {
    if (!this.state.supported) {
      return this.getState();
    }
    this.patch({
      status: "checking",
      errorSummary: null,
    });
    await this.deps.updater.checkForUpdates();
    return this.getState();
  }

  async downloadUpdate(): Promise<ShellUpdateState> {
    if (!this.state.supported) {
      return this.getState();
    }
    this.patch({
      status: "downloading",
      errorSummary: null,
    });
    await this.deps.updater.downloadUpdate();
    return this.getState();
  }

  async quitAndInstall(): Promise<void> {
    if (!this.state.supported) {
      return;
    }
    this.patch({ status: "installing" });
    this.deps.updater.quitAndInstall(false, true);
  }

  private bindUpdaterEvents(): void {
    const now = this.deps.now ?? Date.now;

    this.deps.updater.on("update-not-available", () => {
      this.patch({
        latestVersion: this.state.currentVersion,
        availability: "up_to_date",
        status: "idle",
        lastCheckedAt: now(),
        errorSummary: null,
      });
    });

    this.deps.updater.on("update-available", (info: { version?: unknown; releaseNotes?: unknown }) => {
      this.patch({
        latestVersion: typeof info.version === "string" ? info.version : null,
        availability: "update_available",
        status: "idle",
        lastCheckedAt: now(),
        errorSummary: null,
        releaseNotes: typeof info.releaseNotes === "string" ? info.releaseNotes : null,
      });
    });

    this.deps.updater.on("update-downloaded", (info: { version?: unknown }) => {
      this.patch({
        latestVersion: typeof info.version === "string" ? info.version : this.state.latestVersion,
        availability: "downloaded",
        status: "ready_to_restart",
        errorSummary: null,
      });
    });

    this.deps.updater.on("error", (error: unknown) => {
      this.patch({
        availability: "error",
        status: "failed",
        lastCheckedAt: now(),
        errorSummary: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private patch(patch: Partial<ShellUpdateState>): void {
    this.state = { ...this.state, ...patch };
    this.emit("state-changed", this.getState());
  }
}
```

Modify `packages/desktop/package.json`:

```json
"dependencies": {
  "@coder-studio/core": "workspace:*",
  "@coder-studio/server": "workspace:*",
  "electron-updater": "^6.6.2",
  "fflate": "^0.8.2",
  "tar": "^7.5.1"
}
```

- [ ] **Step 4: Run the focused desktop tests and verify they pass**

Run:

```bash
pnpm --filter @coder-studio/desktop test -- packages/desktop/src/shell-update-service.test.ts
```

Expected: PASS for shell updater service state transitions.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/package.json packages/desktop/src/shell-update-service.ts packages/desktop/src/shell-update-service.test.ts
git commit -m "feat: add desktop shell update service"
```

### Task 3: Expose Shell Update IPC Through Electron

**Files:**
- Modify: `packages/desktop/src/main.ts`
- Modify: `packages/desktop/src/preload.ts`
- Test: `packages/desktop/src/shell-update-service.test.ts`

- [ ] **Step 1: Write failing tests for preload and IPC registration**

Add tests that assert:

```ts
expect(window.coderStudioDesktop.shellUpdate).toBeDefined();
expect(typeof window.coderStudioDesktop.shellUpdate.check).toBe("function");
```

and main-process registration coverage for:

- `desktop:shell-update:get-state`
- `desktop:shell-update:check`
- `desktop:shell-update:install`
- `desktop:shell-update:restart-to-apply`
- state push event `desktop:shell-update:state-changed`

- [ ] **Step 2: Run the focused desktop tests and verify they fail**

Run:

```bash
pnpm --filter @coder-studio/desktop test -- packages/desktop/src/shell-update-service.test.ts
```

Expected: FAIL because IPC wiring is not present yet.

- [ ] **Step 3: Wire main/preload integration**

Modify `packages/desktop/src/preload.ts` to expose:

```ts
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("coderStudioDesktop", {
  retryStartup: () => ipcRenderer.send("desktop:retry-startup"),
  quit: () => ipcRenderer.send("desktop:quit"),
  shellUpdate: {
    getState: () => ipcRenderer.invoke("desktop:shell-update:get-state"),
    check: () => ipcRenderer.invoke("desktop:shell-update:check"),
    install: () => ipcRenderer.invoke("desktop:shell-update:install"),
    restartToApply: () => ipcRenderer.invoke("desktop:shell-update:restart-to-apply"),
    subscribe: (listener: (state: unknown) => void) => {
      const wrapped = (_event: unknown, state: unknown) => listener(state);
      ipcRenderer.on("desktop:shell-update:state-changed", wrapped);
      return () => {
        ipcRenderer.removeListener("desktop:shell-update:state-changed", wrapped);
      };
    },
  },
});
```

Modify `packages/desktop/src/main.ts` to:

```ts
const shellUpdateService = createShellUpdateService(...);

ipcMain.handle("desktop:shell-update:get-state", () => shellUpdateService.getState());
ipcMain.handle("desktop:shell-update:check", () => shellUpdateService.checkForUpdates());
ipcMain.handle("desktop:shell-update:install", () => shellUpdateService.downloadUpdate());
ipcMain.handle("desktop:shell-update:restart-to-apply", async () => {
  await shellUpdateService.quitAndInstall();
});

shellUpdateService.on("state-changed", (state) => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("desktop:shell-update:state-changed", state);
  }
});
```

- [ ] **Step 4: Run the focused desktop tests and verify they pass**

Run:

```bash
pnpm --filter @coder-studio/desktop test -- packages/desktop/src/shell-update-service.test.ts
```

Expected: PASS with IPC/preload coverage.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/main.ts packages/desktop/src/preload.ts packages/desktop/src/shell-update-service.test.ts
git commit -m "feat: expose desktop shell update ipc"
```

### Task 4: Add Desktop Shell Update UI in Settings

**Files:**
- Create: `packages/web/src/features/desktop-shell/use-shell-update.ts`
- Create: `packages/web/src/features/desktop-shell/use-shell-update.test.tsx`
- Modify: `packages/web/src/features/settings/components/about-settings.tsx`
- Modify: `packages/web/src/features/settings/components/about-settings.test.tsx`
- Modify: `packages/web/src/global.d.ts`

- [ ] **Step 1: Write failing renderer tests for shell update section visibility and actions**

Add tests covering:

```tsx
it("shows desktop app update controls when desktop bridge is available", async () => {
  mockDesktopShellUpdateApi();
  render(<AboutSettings ... />);
  expect(screen.getByText("Desktop app update")).toBeInTheDocument();
});

it("hides desktop app update controls outside desktop mode", async () => {
  delete window.coderStudioDesktop;
  render(<AboutSettings ... />);
  expect(screen.queryByText("Desktop app update")).not.toBeInTheDocument();
});

it("runs check and install through the desktop bridge", async () => {
  const api = mockDesktopShellUpdateApi();
  render(<AboutSettings ... />);
  await user.click(screen.getByRole("button", { name: "Check for app update" }));
  expect(api.check).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the focused web tests and verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web test -- packages/web/src/features/settings/components/about-settings.test.tsx packages/web/src/features/desktop-shell/use-shell-update.test.tsx
```

Expected: FAIL because the desktop shell update hook and UI do not exist yet.

- [ ] **Step 3: Implement the hook and About section**

Create `packages/web/src/features/desktop-shell/use-shell-update.ts`:

```ts
import { useEffect, useState } from "react";

export interface ShellUpdateState {
  supported: boolean;
  currentVersion: string;
  latestVersion: string | null;
  availability: "unknown" | "up_to_date" | "update_available" | "downloaded" | "error";
  status: "idle" | "checking" | "downloading" | "ready_to_restart" | "installing" | "failed";
  lastCheckedAt: number | null;
  errorSummary: string | null;
  releaseNotes: string | null;
}

export function useShellUpdate() {
  const api = window.coderStudioDesktop?.shellUpdate;
  const [state, setState] = useState<ShellUpdateState | null>(null);

  useEffect(() => {
    if (!api) {
      return;
    }
    void api.getState().then(setState);
    return api.subscribe((next) => {
      setState(next as ShellUpdateState);
    });
  }, [api]);

  return {
    available: Boolean(api),
    state,
    check: async () => {
      if (!api) return null;
      const next = await api.check();
      setState(next as ShellUpdateState);
      return next;
    },
    install: async () => {
      if (!api) return null;
      const next = await api.install();
      setState(next as ShellUpdateState);
      return next;
    },
    restartToApply: async () => {
      if (!api) return;
      await api.restartToApply();
    },
  };
}
```

Modify `about-settings.tsx` to render a second update section titled `Desktop app update` when `useShellUpdate().available` is true.

- [ ] **Step 4: Run the focused web tests and verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web test -- packages/web/src/features/settings/components/about-settings.test.tsx packages/web/src/features/desktop-shell/use-shell-update.test.tsx
```

Expected: PASS with desktop-only shell update UI coverage.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/desktop-shell/use-shell-update.ts packages/web/src/features/desktop-shell/use-shell-update.test.tsx packages/web/src/features/settings/components/about-settings.tsx packages/web/src/features/settings/components/about-settings.test.tsx packages/web/src/global.d.ts
git commit -m "feat: add desktop shell update settings ui"
```

### Task 5: Configure Desktop Release Publishing

**Files:**
- Modify: `packages/desktop/package.json`
- Modify: `.github/workflows/publish.yml` or add a dedicated desktop publish workflow
- Test: release dry-run commands and package build

- [ ] **Step 1: Write the failing release validation expectation**

Document expected packaged config:

```json
"build": {
  "publish": [
    {
      "provider": "github",
      "owner": "spencerkit",
      "repo": "coder-studio"
    }
  ]
}
```

and a workflow step that runs desktop publish packaging on tagged or manually triggered release jobs.

- [ ] **Step 2: Run the current desktop build to establish baseline behavior**

Run:

```bash
pnpm exec tsx scripts/build-desktop.ts
```

Expected: current desktop build succeeds but does not produce a publish-ready auto-update config.

- [ ] **Step 3: Implement publish config and workflow support**

Modify `packages/desktop/package.json` build section:

```json
"publish": [
  {
    "provider": "github",
    "owner": "spencerkit",
    "repo": "coder-studio"
  }
]
```

Add or modify GitHub Actions workflow so desktop release packaging:

- runs after runtime/server/web builds succeed
- publishes shell artifacts to GitHub Releases
- remains separable from npm CLI/runtime release publication

- [ ] **Step 4: Run the desktop build again and verify output still packages successfully**

Run:

```bash
pnpm exec tsx scripts/build-desktop.ts
```

Expected: PASS, with packaged desktop output still produced locally and no runtime bundle regressions.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/package.json .github/workflows
git commit -m "build: configure desktop shell release publishing"
```

### Task 6: Full Verification

**Files:**
- No new files

- [ ] **Step 1: Run focused desktop tests**

Run:

```bash
pnpm --filter @coder-studio/desktop test -- packages/desktop/src/shell-update-service.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run focused web tests**

Run:

```bash
pnpm --filter @coder-studio/web test -- packages/web/src/features/settings/components/about-settings.test.tsx packages/web/src/features/desktop-shell/use-shell-update.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run desktop build smoke**

Run:

```bash
pnpm exec tsx scripts/build-desktop.ts
```

Expected: PASS.

- [ ] **Step 4: Run repo-level verification relevant to touched packages**

Run:

```bash
pnpm ci:test:workspace
```

Expected: PASS for workspace package tests.

- [ ] **Step 5: Commit verification-only if needed**

```bash
git status
```

Expected: clean working tree for files touched by this feature.
