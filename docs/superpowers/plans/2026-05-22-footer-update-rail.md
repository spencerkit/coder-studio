# Footer Update Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move update discovery and in-progress update visibility into the shared workspace footer on desktop and mobile, while reusing the existing update backend flow.

**Architecture:** Keep the current update state source (`updateStateAtom` plus `updates.prepareInstall` / `updates.startInstall`) and add a focused footer-side UI component that renders compact update status and actions. Restructure the shared workspace status bar into left and right zones, remove the toast and topbar badge discovery signals, and keep `Settings > About` as the details surface for failure and manual-action states.

**Tech Stack:** React 19, Jotai, React Router, Testing Library, Vitest, CSS compatibility styles in `packages/web/src/styles/components.css`.

**Spec reference:** `docs/superpowers/specs/2026-05-22-footer-update-rail-design.md`

**Git hygiene:** The worktree already contains unrelated user changes in `packages/web/src/features/topbar/components/tab.tsx`, `packages/web/src/features/topbar/components/tab.test.tsx`, `packages/web/src/features/topbar/components/workspace-session-mini-map.tsx`, `packages/web/src/features/topbar/components/workspace-session-mini-map.test.tsx`, and `packages/web/src/styles/components.css`. Do not revert those unrelated edits. Read carefully before patching `components.css`.

---

## File Structure

**New files:**
- `packages/web/src/features/workspace/views/shared/footer-update-rail.tsx` — compact right-side footer update UI, update action entry point, success auto-hide logic, and `Settings > About` navigation
- `packages/web/src/features/workspace/views/shared/footer-update-rail.test.tsx` — focused tests for footer update states, update commands, confirmation flow, timeout-based success hiding, and details navigation

**Modified files:**
- `packages/web/src/features/workspace/views/shared/workspace-status-bar.tsx` — reshape the shared footer into explicit left/right zones and host `FooterUpdateRail`
- `packages/web/src/features/workspace/views/shared/git-panel-status-strip.tsx` — lock Git content into the left zone without owning footer-wide alignment
- `packages/web/src/features/workspace/views/shared/git-panel-status-strip.test.tsx` — update layout assertions to the new left-zone contract
- `packages/web/src/features/workspace/index.test.tsx` — verify desktop shared footer still shows branch info and now exposes a right-side update region when state is active
- `packages/web/src/shells/mobile-shell/index.test.tsx` — verify mobile shared footer keeps Git on the left and can render update UI on the right
- `packages/web/src/styles/components.css` — add shared footer two-zone layout, update rail styling, truncation rules, and mobile-safe compact spacing
- `packages/web/src/features/updates/atoms.ts` — remove the derived topbar badge selector and keep only base update state atoms if no longer needed
- `packages/web/src/app/providers.tsx` — remove the update-available toast subscription and keep only state hydration/event routing
- `packages/web/src/app/providers.lifecycle.test.tsx` — replace the toast assertion with a no-toast assertion after `update.state.changed`
- `packages/web/src/features/topbar/index.tsx` — remove the update badge from the settings button
- `packages/web/src/features/topbar/index.test.tsx` — delete badge expectations and assert the settings entry remains plain
- `packages/web/src/features/workspace/views/shared/git-status-bar.tsx` — export a focused update-confirmation helper or shared action callback only if needed to avoid duplicating the existing confirmation behavior
- `packages/web/src/features/settings/components/settings-page.tsx` — accept `?section=about` so footer “查看详情” can open `Settings > About` directly
- `packages/web/src/features/settings/components/settings-page.test.tsx` — verify deep-linking or route-state opening of the About section
- `packages/web/src/locales/zh.json` — add compact footer update strings
- `packages/web/src/locales/en.json` — add compact footer update strings

**Testing commands used in this plan:**
- `pnpm --filter @coder-studio/web test -- src/features/workspace/views/shared/footer-update-rail.test.tsx`
- `pnpm --filter @coder-studio/web test -- src/features/workspace/views/shared/git-panel-status-strip.test.tsx src/features/workspace/index.test.tsx src/shells/mobile-shell/index.test.tsx`
- `pnpm --filter @coder-studio/web test -- src/app/providers.lifecycle.test.tsx src/features/topbar/index.test.tsx src/features/settings/components/settings-page.test.tsx`

---

### Task 1: Add Footer Update Rail Component With TDD

**Files:**
- Create: `packages/web/src/features/workspace/views/shared/footer-update-rail.tsx`
- Create: `packages/web/src/features/workspace/views/shared/footer-update-rail.test.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.test.tsx`
- Modify: `packages/web/src/locales/zh.json`
- Modify: `packages/web/src/locales/en.json`

- [ ] **Step 1: Write the failing footer update rail tests**

Create `packages/web/src/features/workspace/views/shared/footer-update-rail.test.tsx`:

```tsx
// @vitest-environment jsdom

import type { UpdatePrepareInstallResponse, UpdateStateView } from "@coder-studio/core";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serverInfoAtom, wsClientAtom } from "../../../../atoms/connection";
import { updatePrepareInstallAtom, updateStateAtom } from "../../../updates/atoms";
import { FooterUpdateRail } from "./footer-update-rail";

function baseUpdateState(overrides: Partial<UpdateStateView> = {}): UpdateStateView {
  return {
    version: 1,
    currentVersion: "0.4.0",
    latestVersion: "0.5.0",
    availability: "update_available",
    updateStatus: "idle",
    lastCheckedAt: 1,
    targetVersion: null,
    startedAt: null,
    finishedAt: null,
    requiresManualStep: false,
    manualCommand: null,
    errorSummary: null,
    supported: true,
    installKind: "global_npm",
    unsupportedReason: null,
    ...overrides,
  };
}

function basePrepareResponse(
  overrides: Partial<UpdatePrepareInstallResponse> = {}
): UpdatePrepareInstallResponse {
  return {
    ...baseUpdateState(),
    canStartInstall: true,
    activity: {
      runningTerminalCount: 0,
      runningSessionCount: 0,
      runningSupervisorCount: 0,
      hasActiveWork: false,
    },
    ...overrides,
  };
}

function renderRail({
  dispatch = vi.fn(),
  updateState = baseUpdateState(),
}: {
  dispatch?: ReturnType<typeof vi.fn>;
  updateState?: UpdateStateView | null;
} = {}) {
  const store = createStore();
  store.set(wsClientAtom, { sendCommand: dispatch } as never);
  store.set(serverInfoAtom, {
    version: "0.4.0",
    serverInstanceId: "server-123",
  });
  store.set(updateStateAtom, updateState);

  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/workspace"]}>
        <Routes>
          <Route path="/workspace" element={<FooterUpdateRail />} />
          <Route path="/settings" element={<div data-testid="settings-about-target">settings</div>} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );

  return { store, dispatch };
}

describe("FooterUpdateRail", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("renders update discovery with an immediate action when a newer version is available", () => {
    renderRail();

    expect(screen.getByText("检测到新版本 v0.5.0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "立即更新" })).toBeInTheDocument();
  });

  it("starts the existing update flow from the footer when no active work exists", async () => {
    const dispatch = vi.fn().mockImplementation(async (op: string) => {
      if (op === "updates.prepareInstall") {
        return basePrepareResponse();
      }
      if (op === "updates.startInstall") {
        return baseUpdateState({
          availability: "update_available",
          updateStatus: "installing",
          targetVersion: "0.5.0",
          startedAt: 10,
        });
      }
      throw new Error(`unexpected op: ${op}`);
    });
    const { store } = renderRail({ dispatch });

    fireEvent.click(screen.getByRole("button", { name: "立即更新" }));

    await waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith("updates.prepareInstall", {}, undefined);
    });
    await waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith(
        "updates.startInstall",
        { targetVersion: "0.5.0", force: false },
        undefined
      );
    });
    expect(store.get(updateStateAtom)?.updateStatus).toBe("installing");
  });

  it("opens the existing confirmation dialog before install when active work exists", async () => {
    const dispatch = vi.fn().mockResolvedValue(
      basePrepareResponse({
        activity: {
          runningTerminalCount: 1,
          runningSessionCount: 1,
          runningSupervisorCount: 0,
          hasActiveWork: true,
        },
      })
    );

    renderRail({ dispatch });

    fireEvent.click(screen.getByRole("button", { name: "立即更新" }));

    await waitFor(() => {
      expect(screen.getByText("确认更新")).toBeInTheDocument();
    });
  });

  it("renders failure and manual-required states with a details action", () => {
    const { rerender } = render(
      <Provider
        store={(() => {
          const store = createStore();
          store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
          store.set(updateStateAtom, baseUpdateState({ updateStatus: "failed", availability: "check_failed" }));
          return store;
        })()}
      >
        <MemoryRouter initialEntries={["/workspace"]}>
          <Routes>
            <Route path="/workspace" element={<FooterUpdateRail />} />
            <Route path="/settings" element={<div data-testid="settings-about-target">settings</div>} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    expect(screen.getByText("更新失败")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看详情" })).toBeInTheDocument();

    rerender(
      <Provider
        store={(() => {
          const store = createStore();
          store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
          store.set(updateStateAtom, baseUpdateState({ updateStatus: "manual_required" }));
          return store;
        })()}
      >
        <MemoryRouter initialEntries={["/workspace"]}>
          <Routes>
            <Route path="/workspace" element={<FooterUpdateRail />} />
            <Route path="/settings" element={<div data-testid="settings-about-target">settings</div>} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    expect(screen.getByText("需要手动处理")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看详情" })).toBeInTheDocument();
  });

  it("hides the success state three seconds after it appears", async () => {
    const { store } = renderRail({
      updateState: baseUpdateState({
        availability: "up_to_date",
        updateStatus: "succeeded",
        latestVersion: "0.5.0",
        targetVersion: "0.5.0",
        finishedAt: 42,
      }),
    });

    expect(screen.getByText("已更新到 v0.5.0")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    await waitFor(() => {
      expect(screen.queryByText("已更新到 v0.5.0")).toBeNull();
    });

    expect(store.get(updateStateAtom)?.updateStatus).toBe("succeeded");
  });
});
```

Modify `renderSettingsPage` in `packages/web/src/features/settings/components/settings-page.test.tsx`:

```tsx
function renderSettingsPage(
  store = createConnectedStore(vi.fn().mockResolvedValue({})),
  initialEntry = "/settings"
) {
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <SettingsPage />
      </MemoryRouter>
    </Provider>
  );
}
```

Add to `packages/web/src/features/settings/components/settings-page.test.tsx`:

```tsx
it("opens the About section when the route asks for it explicitly", async () => {
  renderSettingsPage(undefined, "/settings?section=about");

  await screen.findByTestId("about-settings");
  expect(screen.getByRole("button", { name: "关于" })).toHaveClass("settings-nav-item-active");
});
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```bash
pnpm --filter @coder-studio/web test -- src/features/workspace/views/shared/footer-update-rail.test.tsx src/features/settings/components/settings-page.test.tsx
```

Expected: FAIL because `FooterUpdateRail` does not exist and SettingsPage does not honor the explicit About-section route hint.

- [ ] **Step 3: Implement the minimal footer update rail, About deep-linking, and strings**

Create `packages/web/src/features/workspace/views/shared/footer-update-rail.tsx`:

```tsx
import type { UpdatePrepareInstallResponse, UpdateStateView } from "@coder-studio/core";
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { dispatchCommandAtom } from "../../../../atoms/connection";
import { Button, ConfirmDialog } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { updatePrepareInstallAtom, updateStateAtom } from "../../../updates/atoms";

type RailView =
  | { kind: "hidden" }
  | { kind: "available"; text: string; buttonLabel: string }
  | { kind: "installing"; text: string }
  | { kind: "restarting"; text: string }
  | { kind: "failed"; text: string; buttonLabel: string }
  | { kind: "manual_required"; text: string; buttonLabel: string }
  | { kind: "succeeded"; text: string };

function resolveTargetVersion(state: UpdateStateView | null): string | null {
  return state?.latestVersion ?? state?.targetVersion ?? null;
}

function buildView(
  state: UpdateStateView | null,
  showSucceeded: boolean,
  t: ReturnType<typeof useTranslation>
): RailView {
  if (!state) return { kind: "hidden" };

  if (state.updateStatus === "installing") {
    return { kind: "installing", text: t("settings.about.footer_installing") };
  }

  if (state.updateStatus === "restarting") {
    return { kind: "restarting", text: t("settings.about.footer_restarting") };
  }

  if (state.updateStatus === "failed") {
    return {
      kind: "failed",
      text: t("settings.about.footer_failed"),
      buttonLabel: t("settings.about.footer_view_details"),
    };
  }

  if (state.updateStatus === "manual_required") {
    return {
      kind: "manual_required",
      text: t("settings.about.footer_manual_required"),
      buttonLabel: t("settings.about.footer_view_details"),
    };
  }

  if (state.updateStatus === "succeeded" && showSucceeded) {
    const version = resolveTargetVersion(state) ?? state.currentVersion;
    return {
      kind: "succeeded",
      text: t("settings.about.footer_succeeded", { version }),
    };
  }

  if (state.availability === "update_available" && state.updateStatus === "idle" && state.latestVersion) {
    return {
      kind: "available",
      text: t("settings.about.footer_available", { version: state.latestVersion }),
      buttonLabel: t("settings.about.update_now"),
    };
  }

  return { kind: "hidden" };
}

export function FooterUpdateRail() {
  const t = useTranslation();
  const navigate = useNavigate();
  const dispatch = useAtomValue(dispatchCommandAtom);
  const updateState = useAtomValue(updateStateAtom);
  const setUpdateState = useSetAtom(updateStateAtom);
  const setUpdatePrepareInstall = useSetAtom(updatePrepareInstallAtom);
  const [confirmState, setConfirmState] = useState<UpdatePrepareInstallResponse | null>(null);
  const [busy, setBusy] = useState<"prepare" | "install" | null>(null);
  const [showSucceeded, setShowSucceeded] = useState(updateState?.updateStatus === "succeeded");

  useEffect(() => {
    if (updateState?.updateStatus !== "succeeded") {
      setShowSucceeded(false);
      return;
    }

    setShowSucceeded(true);
    const timer = window.setTimeout(() => {
      setShowSucceeded(false);
    }, 3000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [updateState?.finishedAt, updateState?.targetVersion, updateState?.updateStatus]);

  const view = buildView(updateState, showSucceeded, t);

  const openAbout = () => {
    navigate("/settings?section=about");
  };

  const startInstallCommand = async (
    prepared: UpdatePrepareInstallResponse,
    force: boolean
  ): Promise<UpdateStateView | null> => {
    const result = await dispatch<UpdateStateView>("updates.startInstall", {
      targetVersion: prepared.latestVersion ?? prepared.targetVersion ?? undefined,
      force,
    });
    if (!result.ok || !result.data) {
      return null;
    }
    return result.data;
  };

  const handleStartInstall = async (
    prepared: UpdatePrepareInstallResponse,
    force: boolean
  ) => {
    setBusy("install");
    const nextState = await startInstallCommand(prepared, force);
    setBusy(null);
    setConfirmState(null);
    if (!nextState) {
      return;
    }
    setUpdateState(nextState);
  };

  const handleUpdateNow = async () => {
    setBusy("prepare");
    const result = await dispatch<UpdatePrepareInstallResponse>("updates.prepareInstall", {});
    setBusy(null);
    if (!result.ok || !result.data) {
      return;
    }
    setUpdatePrepareInstall(result.data);
    if (result.data.activity.hasActiveWork) {
      setConfirmState(result.data);
      return;
    }
    await handleStartInstall(result.data, false);
  };

  if (view.kind === "hidden") {
    return null;
  }

  return (
    <>
      <div className={`footer-update-rail footer-update-rail--${view.kind}`}>
        <span className="footer-update-rail__text">{view.text}</span>
        {"buttonLabel" in view ? (
          <Button
            variant="ghost"
            size="sm"
            className="footer-update-rail__action"
            disabled={busy !== null}
            onClick={() => {
              if (view.kind === "available") {
                void handleUpdateNow();
                return;
              }
              openAbout();
            }}
          >
            {view.kind === "available" && busy !== null ? t("settings.about.installing") : view.buttonLabel}
          </Button>
        ) : null}
      </div>

      {confirmState ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setConfirmState(null);
            }
          }}
          title={t("settings.about.confirm_update_title")}
          description={
            <div className="settings-dialog-copy">
              <p>{t("settings.about.confirm_update_message")}</p>
              <p>
                {t("settings.about.confirm_update_activity", {
                  terminals: confirmState.activity.runningTerminalCount,
                  sessions: confirmState.activity.runningSessionCount,
                  supervisors: confirmState.activity.runningSupervisorCount,
                })}
              </p>
            </div>
          }
          cancelText={t("action.cancel")}
          confirmText={t("settings.about.update_now")}
          tone="danger"
          onConfirm={() => {
            void handleStartInstall(confirmState, true);
          }}
        />
      ) : null}
    </>
  );
}

export default FooterUpdateRail;
```

Modify `packages/web/src/features/settings/components/settings-page.tsx` near `navigationState` initialization:

```tsx
  const initialSearch =
    typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const initialSection = initialSearch.get("section");
  const requestedSection = initialSection === "about" ? "about" : null;

  const [navigationState, setNavigationState] = useState<SettingsNavigationState>(() =>
    isMobile
      ? { kind: "detail", section: requestedSection ?? DEFAULT_SETTINGS_SECTION }
      : { kind: "detail", section: requestedSection ?? DEFAULT_SETTINGS_SECTION }
  );
```

Add locale strings:

```json
"footer_available": "检测到新版本 v{version}",
"footer_installing": "更新中...",
"footer_restarting": "正在重启服务...",
"footer_failed": "更新失败",
"footer_manual_required": "需要手动处理",
"footer_succeeded": "已更新到 v{version}",
"footer_view_details": "查看详情"
```

```json
"footer_available": "Update available v{version}",
"footer_installing": "Installing update...",
"footer_restarting": "Restarting service...",
"footer_failed": "Update failed",
"footer_manual_required": "Manual action required",
"footer_succeeded": "Updated to v{version}",
"footer_view_details": "View details"
```

- [ ] **Step 4: Run the focused tests and confirm GREEN**

```bash
pnpm --filter @coder-studio/web test -- src/features/workspace/views/shared/footer-update-rail.test.tsx src/features/settings/components/settings-page.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/workspace/views/shared/footer-update-rail.tsx packages/web/src/features/workspace/views/shared/footer-update-rail.test.tsx packages/web/src/features/settings/components/settings-page.tsx packages/web/src/features/settings/components/settings-page.test.tsx packages/web/src/locales/zh.json packages/web/src/locales/en.json
git commit -m "feat: add footer update rail"
```

---

### Task 2: Reshape Shared Desktop and Mobile Footer Layout Around Left/Right Zones

**Files:**
- Modify: `packages/web/src/features/workspace/views/shared/workspace-status-bar.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/git-panel-status-strip.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/git-panel-status-strip.test.tsx`
- Modify: `packages/web/src/features/workspace/index.test.tsx`
- Modify: `packages/web/src/shells/mobile-shell/index.test.tsx`
- Modify: `packages/web/src/styles/components.css`

- [ ] **Step 1: Write the failing layout tests**

Add to `packages/web/src/features/workspace/views/shared/git-panel-status-strip.test.tsx`:

```tsx
it("renders the branch and git meta controls inside separate left-side strip slots", () => {
  const store = createStore();
  store.set(localeAtom, "en");

  const { container } = render(
    <Provider store={store}>
      <GitPanelStatusStrip
        workspaceId="ws-1"
        gitState={{
          branch: "develop",
          ahead: 2,
          behind: 1,
          staged: [],
          modified: [],
          deleted: [],
          untracked: [],
        }}
        onOpenBranchSwitcher={vi.fn()}
      />
    </Provider>
  );

  expect(container.querySelector(".git-panel-status-strip__left")).toBeTruthy();
  expect(container.querySelector(".git-panel-status-strip__right")).toBeNull();
  expect(container.querySelector(".git-panel-status-strip__left .git-panel-status-strip__branch")).toBeTruthy();
  expect(container.querySelector(".git-panel-status-strip__left .git-panel-status-strip__meta")).toBeTruthy();
});
```

Add to `packages/web/src/features/workspace/index.test.tsx`:

```tsx
it("renders a dedicated right-side update region in the desktop shared footer", async () => {
  const sendCommand = vi.fn().mockImplementation(async (op: string) => {
    if (op === "git.status") {
      return {
        branch: "feature/footer-update",
        ahead: 0,
        behind: 0,
        staged: [],
        modified: [],
        deleted: [],
        untracked: [],
      };
    }

    return [];
  });

  const store = createStore();
  store.set(connectionStatusAtom, "connected");
  store.set(wsClientAtom, { sendCommand } as never);
  store.set(updateStateAtom, {
    version: 1,
    currentVersion: "0.4.0",
    latestVersion: "0.5.0",
    availability: "update_available",
    updateStatus: "idle",
    lastCheckedAt: 1,
    targetVersion: null,
    startedAt: null,
    finishedAt: null,
    requiresManualStep: false,
    manualCommand: null,
    errorSummary: null,
    supported: true,
    installKind: "global_npm",
    unsupportedReason: null,
  });
  seedReadyWorkspaceState(store, {
    "ws-test": {
      id: "ws-test",
      path: "/home/spencer/workspace/coder-studio",
      targetRuntime: "native",
      openedAt: 1,
      lastActiveAt: 1,
      uiState: {
        leftPanelWidth: 280,
        bottomPanelHeight: 200,
        focusMode: false,
      },
    },
  });

  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/workspace"]}>
        <Routes>
          <Route path="/workspace" element={<WorkspaceDesktopView />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );

  await screen.findByText("feature/footer-update");

  expect(document.querySelector(".workspace-status-bar__left .git-panel-status-strip")).toBeTruthy();
  expect(document.querySelector(".workspace-status-bar__right")).toHaveTextContent("检测到新版本");
});
```

Add to `packages/web/src/shells/mobile-shell/index.test.tsx`:

```tsx
it("renders git on the left and footer update UI on the right in the shared mobile footer", async () => {
  const { store } = renderMobileShell({ initialEntry: "/workspace" });

  act(() => {
    store.set(gitStateAtomFamily("ws-1"), {
      branch: "feature/mobile-footer-update",
      ahead: 0,
      behind: 0,
      staged: [],
      modified: [],
      deleted: [],
      untracked: [],
    });
    store.set(updateStateAtom, {
      version: 1,
      currentVersion: "0.4.0",
      latestVersion: "0.5.0",
      availability: "update_available",
      updateStatus: "idle",
      lastCheckedAt: 1,
      targetVersion: null,
      startedAt: null,
      finishedAt: null,
      requiresManualStep: false,
      manualCommand: null,
      errorSummary: null,
      supported: true,
      installKind: "global_npm",
      unsupportedReason: null,
    });
  });

  expect(document.querySelector(".mobile-shell__bottom-stack .workspace-status-bar__left")).toHaveTextContent(
    "feature/mobile-footer-update"
  );
  expect(document.querySelector(".mobile-shell__bottom-stack .workspace-status-bar__right")).toHaveTextContent(
    "检测到新版本"
  );
});
```

- [ ] **Step 2: Run the layout tests and confirm RED**

```bash
pnpm --filter @coder-studio/web test -- src/features/workspace/views/shared/git-panel-status-strip.test.tsx src/features/workspace/index.test.tsx src/shells/mobile-shell/index.test.tsx
```

Expected: FAIL because the shared footer does not yet expose left/right slots or a right-side update region.

- [ ] **Step 3: Implement the minimal shared footer layout and styling**

Modify `packages/web/src/features/workspace/views/shared/workspace-status-bar.tsx`:

```tsx
import type { GitStatus } from "@coder-studio/core";
import { FooterUpdateRail } from "./footer-update-rail";
import { GitPanelStatusStrip } from "./git-panel-status-strip";

interface WorkspaceStatusBarProps {
  workspaceId: string;
  gitState: GitStatus | null | undefined;
  onOpenBranchSwitcher?: () => void;
  flush?: boolean;
}

export function WorkspaceStatusBar({
  workspaceId,
  gitState,
  onOpenBranchSwitcher,
  flush = false,
}: WorkspaceStatusBarProps) {
  return (
    <div className={`workspace-status-bar${flush ? " workspace-status-bar--flush" : ""}`}>
      <div className="workspace-status-bar__left">
        <GitPanelStatusStrip
          workspaceId={workspaceId}
          gitState={gitState}
          onOpenBranchSwitcher={onOpenBranchSwitcher}
        />
      </div>
      <div className="workspace-status-bar__right">
        <FooterUpdateRail />
      </div>
    </div>
  );
}
```

Modify `packages/web/src/features/workspace/views/shared/git-panel-status-strip.tsx`:

```tsx
  return (
    <div className="git-panel-status-strip">
      <div className="git-panel-status-strip__left">
        {viewport === "desktop" && onOpenBranchSwitcher ? (
          <DesktopBranchQuickPickPopover
            workspaceId={workspaceId}
            onOpenBranchSwitcher={onOpenBranchSwitcher}
          >
            {branchTrigger}
          </DesktopBranchQuickPickPopover>
        ) : (
          branchTrigger
        )}
        <div className="git-panel-status-strip__meta">
          <GitStatusBar
            workspaceId={workspaceId}
            gitState={gitState}
            inline
            onRefresh={refreshWorkspace}
            refreshStatus={refreshStatus}
          />
        </div>
      </div>
    </div>
  );
```

If duplicating the install-start command inside `FooterUpdateRail` feels too brittle after Step 3, extract the shared command launcher into `packages/web/src/features/workspace/views/shared/git-status-bar.tsx` as:

```tsx
export async function dispatchStartInstall(
  dispatch: ReturnType<typeof useAtomValue<typeof dispatchCommandAtom>>,
  prepared: UpdatePrepareInstallResponse,
  force: boolean
): Promise<UpdateStateView | null> {
  const result = await dispatch<UpdateStateView>("updates.startInstall", {
    targetVersion: prepared.latestVersion ?? prepared.targetVersion ?? undefined,
    force,
  });

  if (!result.ok || !result.data) {
    return null;
  }

  return result.data;
}
```

Use it from both the footer rail and About settings only if necessary. Otherwise leave `git-status-bar.tsx` untouched.

Modify `packages/web/src/styles/components.css`:

```css
.workspace-status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: var(--desktop-statusbar-height);
  flex-shrink: 0;
  border-top: 1px solid color-mix(in srgb, var(--border) 62%, transparent);
  background: var(--bg-panel);
}

.workspace-status-bar__left,
.workspace-status-bar__right {
  display: inline-flex;
  align-items: center;
  min-width: 0;
}

.workspace-status-bar__left {
  flex: 1 1 auto;
}

.workspace-status-bar__right {
  flex: 0 1 auto;
  justify-content: flex-end;
}

.git-panel-status-strip {
  display: flex;
  align-items: center;
  min-height: 24px;
  width: 100%;
  padding: 0 12px;
  color: var(--text-tertiary);
  font-size: var(--type-body-6-size);
  line-height: var(--type-body-6-line-height);
  font-weight: var(--type-body-6-weight);
}

.git-panel-status-strip__left {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  gap: 10px;
}

.footer-update-rail {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  gap: 8px;
  color: var(--text-secondary);
  font-size: var(--type-body-6-size);
  line-height: var(--type-body-6-line-height);
  font-weight: var(--type-body-6-weight);
}

.footer-update-rail__text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.footer-update-rail__action {
  flex-shrink: 0;
}

.mobile-shell__bottom-stack .workspace-status-bar {
  gap: 8px;
}

.mobile-shell__bottom-stack .workspace-status-bar__right,
.mobile-sheet__footer .workspace-status-bar__right {
  min-width: 0;
  max-width: 48%;
}
```

- [ ] **Step 4: Run the layout tests and confirm GREEN**

```bash
pnpm --filter @coder-studio/web test -- src/features/workspace/views/shared/git-panel-status-strip.test.tsx src/features/workspace/index.test.tsx src/shells/mobile-shell/index.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/workspace/views/shared/workspace-status-bar.tsx packages/web/src/features/workspace/views/shared/git-panel-status-strip.tsx packages/web/src/features/workspace/views/shared/git-panel-status-strip.test.tsx packages/web/src/features/workspace/index.test.tsx packages/web/src/shells/mobile-shell/index.test.tsx packages/web/src/styles/components.css
git commit -m "feat: move update status into shared footer"
```

---

### Task 3: Remove Toast and Topbar Badge Discovery Signals

**Files:**
- Modify: `packages/web/src/app/providers.tsx`
- Modify: `packages/web/src/app/providers.lifecycle.test.tsx`
- Modify: `packages/web/src/features/updates/atoms.ts`
- Modify: `packages/web/src/features/topbar/index.tsx`
- Modify: `packages/web/src/features/topbar/index.test.tsx`

- [ ] **Step 1: Write the failing tests for removing the old discovery signals**

Modify `packages/web/src/app/providers.lifecycle.test.tsx` by replacing the toast test with:

```tsx
it("does not show a toast when an update becomes available after connect", async () => {
  const updateState: UpdateStateView = {
    version: 1,
    currentVersion: "0.4.0",
    latestVersion: "0.5.0",
    availability: "update_available",
    updateStatus: "idle",
    lastCheckedAt: 123,
    targetVersion: null,
    startedAt: null,
    finishedAt: null,
    requiresManualStep: false,
    manualCommand: null,
    errorSummary: null,
    supported: true,
    installKind: "global_npm",
    unsupportedReason: null,
  };
  wsState.client!.sendCommand = createWsSendCommandMock(async (op) => {
    if (op === "updates.getState") {
      return {
        ...updateState,
        latestVersion: null,
        availability: "unknown" as const,
        lastCheckedAt: null,
      };
    }
    return undefined;
  });
  const store = createStore();
  setVisibilityState("visible");

  renderProviders(store);

  await vi.waitFor(() => {
    expect(wsState.client?.connect).toHaveBeenCalled();
  });

  act(() => {
    wsState.client?.statusHandler?.("connected");
  });

  await vi.waitFor(() => {
    expect(wsState.client?.sendCommand).toHaveBeenCalledWith("updates.getState", {}, undefined);
  });

  act(() => {
    wsState.client?.eventHandler?.("update.state.changed", updateState, 1);
  });

  await vi.waitFor(() => {
    expect(store.get(updateStateAtom)?.latestVersion).toBe("0.5.0");
  });

  expect(store.get(toastsAtom)).toHaveLength(0);
});
```

Modify `packages/web/src/features/topbar/index.test.tsx`:

```tsx
it("keeps the settings entry plain when an update is available", () => {
  const store = createStore();
  store.set(localeAtom, "en");
  store.set(workspacesLoadStateAtom, "ready");
  store.set(updateStateAtom, {
    version: 1,
    currentVersion: "0.4.0",
    latestVersion: "0.5.0",
    availability: "update_available",
    updateStatus: "idle",
    lastCheckedAt: 1,
    targetVersion: null,
    startedAt: null,
    finishedAt: null,
    requiresManualStep: false,
    manualCommand: null,
    errorSummary: null,
    supported: true,
    installKind: "global_npm",
    unsupportedReason: null,
  });

  render(
    <Provider store={store}>
      <TopBar />
    </Provider>
  );

  const settingsEntry = screen.getByTestId("settings-open");
  expect(settingsEntry.querySelector(".topbar-unread")).toBeNull();
});
```

- [ ] **Step 2: Run the old-discovery tests and confirm RED**

```bash
pnpm --filter @coder-studio/web test -- src/app/providers.lifecycle.test.tsx src/features/topbar/index.test.tsx
```

Expected: FAIL because the toast subscription and topbar badge are still present.

- [ ] **Step 3: Remove the toast and badge implementation**

Modify `packages/web/src/app/providers.tsx` by deleting the `announcedUpdateVersionRef` bookkeeping and the `store.sub(updateStateAtom, ...)` effect that calls `pushToast`.

Modify `packages/web/src/features/updates/atoms.ts`:

```ts
import type { UpdatePrepareInstallResponse, UpdateStateView } from "@coder-studio/core";
import { atom } from "jotai";

export const updateStateAtom = atom<UpdateStateView | null>(null);
export const updatePrepareInstallAtom = atom<UpdatePrepareInstallResponse | null>(null);
```

Modify `packages/web/src/features/topbar/index.tsx`:

```tsx
import { useAtom } from "jotai";
// remove updateMarkerVisibleAtom import

// remove updateMarkerVisible lookup

<IconButton
  aria-label={t("settings.title")}
  className="topbar-btn"
  data-testid="settings-open"
  icon={<ThemedIcon semantic="nav.settings" size={14} />}
  onClick={() => navigate("/settings")}
/>
```

- [ ] **Step 4: Run the old-discovery tests and confirm GREEN**

```bash
pnpm --filter @coder-studio/web test -- src/app/providers.lifecycle.test.tsx src/features/topbar/index.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/providers.tsx packages/web/src/app/providers.lifecycle.test.tsx packages/web/src/features/updates/atoms.ts packages/web/src/features/topbar/index.tsx packages/web/src/features/topbar/index.test.tsx
git commit -m "refactor: remove legacy update discovery signals"
```

---

### Task 4: Run Focused Regression Verification

**Files:**
- No code changes required unless a regression appears

- [ ] **Step 1: Run the full focused web regression set**

```bash
pnpm --filter @coder-studio/web test -- src/features/workspace/views/shared/footer-update-rail.test.tsx src/features/workspace/views/shared/git-panel-status-strip.test.tsx src/features/workspace/index.test.tsx src/shells/mobile-shell/index.test.tsx src/app/providers.lifecycle.test.tsx src/features/topbar/index.test.tsx src/features/settings/components/settings-page.test.tsx
```

Expected: PASS with all targeted footer-update, settings, mobile-shell, topbar, and provider lifecycle tests green.

- [ ] **Step 2: Run web type-adjacent smoke coverage via the package test suite slice**

```bash
pnpm --filter @coder-studio/web test -- src/features/workspace/views/shared/git-status-bar.test.tsx src/features/settings/components/about-settings.test.tsx
```

Expected: PASS, confirming the reused update flow and existing Git footer actions remain intact.

- [ ] **Step 3: Inspect the diff before branch completion**

Run:

```bash
git diff --stat
```

Expected: Only the planned footer-update-related files appear, plus no accidental staging of unrelated dirty files.

- [ ] **Step 4: Commit any regression-fix follow-up if needed**

If Step 1 or Step 2 required additional fixes:

```bash
git add packages/web/src/features/workspace/views/shared/footer-update-rail.tsx packages/web/src/features/workspace/views/shared/footer-update-rail.test.tsx packages/web/src/features/workspace/views/shared/workspace-status-bar.tsx packages/web/src/features/workspace/views/shared/git-panel-status-strip.tsx packages/web/src/features/workspace/views/shared/git-panel-status-strip.test.tsx packages/web/src/features/workspace/index.test.tsx packages/web/src/shells/mobile-shell/index.test.tsx packages/web/src/app/providers.tsx packages/web/src/app/providers.lifecycle.test.tsx packages/web/src/features/updates/atoms.ts packages/web/src/features/topbar/index.tsx packages/web/src/features/topbar/index.test.tsx packages/web/src/features/settings/components/settings-page.tsx packages/web/src/features/settings/components/settings-page.test.tsx packages/web/src/locales/zh.json packages/web/src/locales/en.json packages/web/src/styles/components.css
git commit -m "test: finalize footer update rail coverage"
```

If no extra fixes were needed, skip this step.

---

## Self-Review

**Spec coverage:** This plan covers the footer right-side update entry, desktop/mobile shared footer normalization, reuse of existing update commands and confirmation dialog, success auto-hide after 3 seconds, removal of the update toast, removal of the topbar settings badge, and direct navigation to `Settings > About` for details states.

**Placeholder scan:** No TODO/TBD placeholders remain. Each task includes concrete files, tests, commands, and minimal implementation snippets.

**Type consistency:** The plan uses existing names from the current codebase: `updateStateAtom`, `updatePrepareInstallAtom`, `updates.prepareInstall`, `updates.startInstall`, `WorkspaceStatusBar`, `GitPanelStatusStrip`, and `SettingsPage`.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-22-footer-update-rail.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
