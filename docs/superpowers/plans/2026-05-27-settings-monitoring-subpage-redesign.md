# Settings Monitoring Subpage Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move monitoring fully into `Settings > Monitoring`, remove the standalone `/monitoring` page, and ship a data-first desktop/mobile monitoring subpage with an integrated control dock.

**Architecture:** Keep the existing monitoring websocket commands, formatting helpers, and sparkline logic, but stop rendering monitoring as a routed top-level page. Instead, add a dedicated `monitoring` settings section, extract the monitoring UI into a settings-owned subpage component, and reshape the layout into a desktop two-column stage/dock surface with a mobile single-column, data-first fallback.

**Tech Stack:** TypeScript, React 19, React Router, Jotai, Vitest, Testing Library, and the shared token-driven stylesheet in `packages/web/src/styles/components.css`.

**Spec reference:** `docs/superpowers/specs/2026-05-27-settings-monitoring-subpage-redesign-design.md`

**Git hygiene:** The worktree already contains unrelated untracked files. Stage only the files listed in each task and never revert or sweep unrelated edits.

---

## File Structure

**Create:**
- `packages/web/src/features/settings/components/monitoring-settings-subpage.tsx`
  - Settings-owned monitoring subpage surface that loads monitoring data, renders the desktop/mobile dashboard, and hosts the integrated control dock.
- `packages/web/src/features/settings/components/monitoring-settings-subpage.test.tsx`
  - Regression coverage for desktop/mobile rendering, disabled state behavior, refresh, and embedded configuration behavior.

**Modify:**
- `packages/web/src/features/settings/components/settings-sections.tsx`
  - Add the `monitoring` section id and metadata.
- `packages/web/src/features/settings/components/settings-page.tsx`
  - Remove monitoring from `General`, route the new settings section to the monitoring subpage, and wire shared monitoring settings persistence into the new component.
- `packages/web/src/features/settings/components/monitoring-settings-card.tsx`
  - Convert the existing card into a reusable control-dock body that can render with optional embedded title/action chrome.
- `packages/web/src/features/monitoring/index.ts`
  - Stop exporting the routed `MonitoringPage`; export reusable helpers/components only if needed by the settings subpage.
- `packages/web/src/features/monitoring/page.tsx`
  - Remove or reduce the routed-page wrapper; keep only reusable monitoring helper components if they are still needed by the embedded subpage.
- `packages/web/src/features/monitoring/page.test.tsx`
  - Remove standalone-route assumptions or replace the file with focused helper-level tests if shared monitoring helpers remain there.
- `packages/web/src/features/command-palette/components/command-palette.tsx`
  - Update the command action to navigate to `/settings?section=monitoring`.
- `packages/web/src/features/command-palette/components/command-palette.test.tsx`
  - Assert the command now deep-links into settings.
- `packages/web/src/shells/desktop-shell.tsx`
  - Remove the `/monitoring` route and its auth-bypass special case.
- `packages/web/src/shells/mobile-shell/index.tsx`
  - Remove the `/monitoring` route and its auth-bypass special case.
- `packages/web/src/shells/desktop-shell.test.tsx`
  - Remove the `/monitoring` route expectation and assert unknown `/monitoring` no longer bypasses into monitoring.
- `packages/web/src/shells/mobile-shell/index.test.tsx`
  - Remove the mobile `/monitoring` route expectation and assert the standalone path is no longer handled.
- `packages/web/src/features/settings/components/settings-page.test.tsx`
  - Replace the old general-page monitoring assertions with navigation, section, and deep-link coverage.
- `packages/web/src/styles/components.css`
  - Add `settings-monitoring-*` layout and responsive styles; remove standalone monitoring page shell styles that are no longer used.
- `packages/web/src/styles/components.theme.test.ts`
  - Lock the new monitoring subpage selectors to token-driven surfaces and responsive layout rules.
- `packages/web/src/locales/en.json`
  - Add or update settings-monitoring copy for embedded title, config entry card, and disabled-state language if needed.
- `packages/web/src/locales/zh.json`
  - Chinese counterparts for the new settings-monitoring copy.

**Testing commands used in this plan:**
- `pnpm --filter @coder-studio/web exec vitest run src/features/settings/components/settings-page.test.tsx src/features/command-palette/components/command-palette.test.tsx src/shells/desktop-shell.test.tsx src/shells/mobile-shell/index.test.tsx`
- `pnpm --filter @coder-studio/web exec vitest run src/features/settings/components/monitoring-settings-subpage.test.tsx`
- `pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts`
- `pnpm --filter @coder-studio/web exec vitest run src/features/settings/components/settings-page.test.tsx src/features/settings/components/monitoring-settings-subpage.test.tsx src/features/command-palette/components/command-palette.test.tsx src/shells/desktop-shell.test.tsx src/shells/mobile-shell/index.test.tsx src/styles/components.theme.test.ts`
- `pnpm --filter @coder-studio/web exec tsc -p tsconfig.json --noEmit`

---

### Task 1: Move Monitoring Entry Points Into Settings

**Files:**
- Modify: `packages/web/src/features/settings/components/settings-sections.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.test.tsx`
- Modify: `packages/web/src/features/command-palette/components/command-palette.tsx`
- Modify: `packages/web/src/features/command-palette/components/command-palette.test.tsx`
- Modify: `packages/web/src/shells/desktop-shell.tsx`
- Modify: `packages/web/src/shells/mobile-shell/index.tsx`
- Modify: `packages/web/src/shells/desktop-shell.test.tsx`
- Modify: `packages/web/src/shells/mobile-shell/index.test.tsx`

- [ ] **Step 1: Write the failing navigation and route tests**

Add a settings navigation regression to `packages/web/src/features/settings/components/settings-page.test.tsx`:

```tsx
  it("renders monitoring as a dedicated settings section and deep-links into it", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "monitoring.enabled": true,
          "monitoring.hostMetricsEnabled": true,
          "monitoring.runtimeSummaryEnabled": true,
          "monitoring.workspaceAttributionEnabled": true,
          "monitoring.subprocessDrilldownEnabled": false,
          "monitoring.sampleIntervalMs": 5000,
        };
      }

      if (op === "monitoring.get") {
        return {
          settings: {
            enabled: true,
            hostMetricsEnabled: true,
            runtimeSummaryEnabled: true,
            workspaceAttributionEnabled: true,
            subprocessDrilldownEnabled: false,
            sampleIntervalMs: 5000,
          },
          snapshot: {
            sampledAt: 10,
            mode: "standard",
            host: null,
            runtime: null,
            workspaces: [],
            sessions: [],
            subprocessGroups: [],
            backgroundGroups: [],
          },
          history: {
            host: { points: [] },
            runtime: null,
            workspaces: {},
            sessions: {},
            subprocessGroups: {},
          },
          capabilities: {
            loadAverageAvailable: true,
            processMetricsAvailable: true,
            subprocessHistoryLimited: false,
          },
          telemetry: null,
        };
      }

      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store, { initialEntry: "/settings?section=monitoring" });

    expect(await screen.findByRole("button", { name: "监控" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "监控" })).toHaveClass("settings-nav-item-active");
    expect(screen.queryByRole("button", { name: "打开监控" })).not.toBeInTheDocument();
    expect(screen.queryByText("通知")).not.toContainElement(
      screen.queryByRole("switch", { name: "启用性能监控" })
    );
  });
```

Update `packages/web/src/features/command-palette/components/command-palette.test.tsx`:

```tsx
  it("opens monitoring through the settings deep link", () => {
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(commandPaletteOpenAtom, true);

    render(
      <Provider store={store}>
        <CommandPalette />
      </Provider>
    );

    fireEvent.click(screen.getByText("Performance monitoring"));

    expect(routerMocks.navigate).toHaveBeenCalledWith("/settings?section=monitoring");
  });
```

Replace the standalone route assertions in the shell tests:

```tsx
  it("does not bypass auth-loading for standalone /monitoring anymore", () => {
    window.history.replaceState({}, "", "/monitoring");

    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(authEnabledAtom, null);
    store.set(authenticatedAtom, false);

    renderShell(store);

    expect(screen.getByText("正在连接工作区...")).toBeInTheDocument();
    expect(screen.queryByText("MonitoringPage")).not.toBeInTheDocument();
  });
```

and the mobile equivalent:

```tsx
  it("does not resolve standalone /monitoring on mobile anymore", () => {
    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(authEnabledAtom, null);
    store.set(authenticatedAtom, false);

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/monitoring"]}>
          <LocationProbe />
          <MobileShell />
        </MemoryRouter>
      </Provider>
    );

    expect(screen.queryByText("MonitoringPage")).not.toBeInTheDocument();
    expect(screen.getByText("正在连接工作区...")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/settings/components/settings-page.test.tsx \
  src/features/command-palette/components/command-palette.test.tsx \
  src/shells/desktop-shell.test.tsx \
  src/shells/mobile-shell/index.test.tsx
```

Expected:
- FAIL because `settings-sections.tsx` does not define `monitoring`
- FAIL because the settings page still renders monitoring in `General`
- FAIL because command palette still navigates to `/monitoring`
- FAIL because both shells still special-case the standalone route

- [ ] **Step 3: Implement the settings-first navigation changes**

Update `packages/web/src/features/settings/components/settings-sections.tsx`:

```tsx
export type SettingsSection =
  | "general"
  | "monitoring"
  | "appearance"
  | "providers"
  | "shortcuts"
  | "about";

export const SETTINGS_SECTIONS = [
  { id: "general", labelKey: "settings.general", iconSemantic: "nav.settings.general" },
  { id: "monitoring", labelKey: "monitoring.title", iconSemantic: "nav.diagnostics" },
  { id: "providers", labelKey: "settings.providers", iconSemantic: "nav.settings.providers" },
  { id: "appearance", labelKey: "settings.appearance", iconSemantic: "nav.settings.appearance" },
  { id: "shortcuts", labelKey: "settings.shortcuts.title", iconSemantic: "nav.settings.shortcuts" },
  { id: "about", labelKey: "settings.about.title", iconSemantic: "nav.settings.about" },
] as const satisfies readonly SettingsSectionMeta[];
```

Update the mobile grouping in `packages/web/src/features/settings/components/settings-page.tsx`:

```tsx
const MOBILE_SETTINGS_GROUPS = [
  {
    titleKey: "settings.mobile_groups.workspace_runtime",
    sections: ["general", "monitoring", "providers"],
  },
  {
    titleKey: "settings.mobile_groups.interface_interaction",
    sections: ["appearance", "shortcuts", "about"],
  },
] as const;
```

Change the command palette action in `packages/web/src/features/command-palette/components/command-palette.tsx`:

```tsx
    {
      id: "open-monitoring",
      label: t("monitoring.command_label"),
      description: t("monitoring.command_description"),
      action: () => {
        navigate("/settings?section=monitoring");
      },
    },
```

Remove the standalone route and bypass conditions from both shells:

```tsx
  const shouldBypassAuthLoading =
    location.pathname.startsWith("/settings") ||
    location.pathname.startsWith("/diagnostics") ||
    location.pathname === "/session-gate";
```

and delete:

```tsx
            <Route path="/monitoring" element={<MonitoringPage />} />
```

- [ ] **Step 4: Run the focused tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/settings/components/settings-page.test.tsx \
  src/features/command-palette/components/command-palette.test.tsx \
  src/shells/desktop-shell.test.tsx \
  src/shells/mobile-shell/index.test.tsx
```

Expected: PASS with the new settings navigation and without any `/monitoring` route expectations.

- [ ] **Step 5: Commit the navigation/route slice**

```bash
git add \
  packages/web/src/features/settings/components/settings-sections.tsx \
  packages/web/src/features/settings/components/settings-page.tsx \
  packages/web/src/features/settings/components/settings-page.test.tsx \
  packages/web/src/features/command-palette/components/command-palette.tsx \
  packages/web/src/features/command-palette/components/command-palette.test.tsx \
  packages/web/src/shells/desktop-shell.tsx \
  packages/web/src/shells/mobile-shell/index.tsx \
  packages/web/src/shells/desktop-shell.test.tsx \
  packages/web/src/shells/mobile-shell/index.test.tsx
git commit -m "feat: move monitoring entrypoints into settings"
```

---

### Task 2: Build The Embedded Monitoring Settings Subpage

**Files:**
- Create: `packages/web/src/features/settings/components/monitoring-settings-subpage.tsx`
- Create: `packages/web/src/features/settings/components/monitoring-settings-subpage.test.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.tsx`
- Modify: `packages/web/src/features/settings/components/monitoring-settings-card.tsx`
- Modify: `packages/web/src/features/monitoring/page.tsx`
- Modify: `packages/web/src/features/monitoring/index.ts`
- Modify: `packages/web/src/features/monitoring/page.test.tsx`

- [ ] **Step 1: Write the failing embedded-subpage tests**

Create `packages/web/src/features/settings/components/monitoring-settings-subpage.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { connectionStatusAtom, wsClientAtom } from "../../../atoms/connection";
import { localeAtom } from "../../../atoms/app-ui";
import { MonitoringSettingsSubpage } from "./monitoring-settings-subpage";

function buildResponse(overrides: Record<string, unknown> = {}) {
  return {
    settings: {
      enabled: true,
      hostMetricsEnabled: true,
      runtimeSummaryEnabled: true,
      workspaceAttributionEnabled: true,
      subprocessDrilldownEnabled: false,
      sampleIntervalMs: 2000,
    },
    snapshot: {
      sampledAt: 10,
      mode: "standard",
      host: {
        cpuPercent: 72,
        memoryUsedBytes: 800,
        memoryTotalBytes: 1000,
        memoryAvailableBytes: 200,
        loadAverage: [1, 1, 1],
        uptimeSec: 60,
        pressure: "elevated",
      },
      runtime: {
        serverCpuPercent: 10,
        serverMemoryBytes: 100,
        totalManagedCpuPercent: 30,
        totalManagedMemoryBytes: 300,
        managedProcessCount: 4,
        cpuShareOfHostPercent: 41.67,
        memoryShareOfHostPercent: 30,
      },
      workspaces: [],
      sessions: [],
      subprocessGroups: [],
      backgroundGroups: [],
      ...overrides,
    },
    history: {
      host: { points: [{ sampledAt: 10, cpuPercent: 72, memoryBytes: 800 }] },
      runtime: { points: [{ sampledAt: 10, cpuPercent: 30, memoryBytes: 300, processCount: 4 }] },
      workspaces: {},
      sessions: {},
      subprocessGroups: {},
    },
    capabilities: {
      loadAverageAvailable: true,
      processMetricsAvailable: true,
      subprocessHistoryLimited: false,
    },
    telemetry: null,
  };
}

describe("MonitoringSettingsSubpage", () => {
  it("renders the desktop stage and control dock together", async () => {
    const response = buildResponse();
    const sendCommand = vi.fn().mockResolvedValue(response);
    const subscribe = vi.fn((_topics, handler) => {
      handler("monitoring.snapshot.updated", response);
      return () => {};
    });
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(connectionStatusAtom, "connected");
    store.set(wsClientAtom, { sendCommand, subscribe } as never);

    render(
      <Provider store={store}>
        <MonitoringSettingsSubpage
          monitoringSettings={response.settings}
          onMonitoringSettingsChange={vi.fn()}
        />
      </Provider>
    );

    expect(await screen.findByText("Performance monitoring")).toBeInTheDocument();
    expect(document.querySelector(".settings-monitoring__layout")).toBeTruthy();
    expect(document.querySelector(".settings-monitoring__stage")).toBeTruthy();
    expect(document.querySelector(".settings-monitoring__dock")).toBeTruthy();
  });

  it("prioritizes the control panel when monitoring is disabled", async () => {
    const response = buildResponse({
      mode: "disabled",
      host: null,
      runtime: null,
      workspaces: [],
      sessions: [],
      subprocessGroups: [],
      backgroundGroups: [],
    });
    response.settings.enabled = false;
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(connectionStatusAtom, "connected");
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue(response),
      subscribe: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <MonitoringSettingsSubpage
          monitoringSettings={response.settings}
          onMonitoringSettingsChange={vi.fn()}
        />
      </Provider>
    );

    expect(await screen.findByText("Monitoring disabled")).toBeInTheDocument();
    expect(document.querySelector(".settings-monitoring__dock--expanded")).toBeTruthy();
  });
});
```

Add a settings-page rendering assertion:

```tsx
  it("renders monitoring inside the settings content surface instead of general settings", async () => {
    const sendCommand = vi.fn().mockResolvedValue({});
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store, { initialEntry: "/settings?section=monitoring" });

    expect(await screen.findByText("性能监控")).toBeInTheDocument();
    expect(document.querySelector(".settings-content-surface .settings-monitoring")).toBeTruthy();
    expect(screen.queryByText("通知")).not.toContainElement(
      screen.queryByRole("switch", { name: "启用性能监控" })
    );
  });
```

- [ ] **Step 2: Run the embedded-subpage tests to verify failure**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/settings/components/monitoring-settings-subpage.test.tsx \
  src/features/settings/components/settings-page.test.tsx
```

Expected:
- FAIL because `MonitoringSettingsSubpage` does not exist
- FAIL because settings still render monitoring controls through `GeneralSettings`

- [ ] **Step 3: Implement the embedded monitoring subpage and remove monitoring from General**

Create `packages/web/src/features/settings/components/monitoring-settings-subpage.tsx` with this skeleton:

```tsx
import type { MonitoringResponse, MonitoringSettings } from "@coder-studio/core";
import { Topics } from "@coder-studio/core";
import { useAtomValue } from "jotai";
import { useEffect, useMemo, useState } from "react";
import { connectionStatusAtom, wsClientAtom } from "../../../atoms/connection";
import { Button, Notice, SegmentedControl, Tag } from "../../../components/ui";
import { useViewport } from "../../../hooks/use-viewport";
import { useTranslation } from "../../../lib/i18n";
import { Sparkline } from "../../monitoring/sparkline";
import { formatBytes, formatPercent, formatRefreshInterval, formatTimestamp } from "../../monitoring/formatters";
import { MonitoringSettingsCard } from "./monitoring-settings-card";

export function MonitoringSettingsSubpage({
  monitoringSettings,
  onMonitoringSettingsChange,
}: {
  monitoringSettings: MonitoringSettings;
  onMonitoringSettingsChange: (value: MonitoringSettings) => Promise<void> | void;
}) {
  const t = useTranslation();
  const viewport = useViewport();
  const isMobile = viewport === "mobile";
  const wsClient = useAtomValue(wsClientAtom);
  const connectionStatus = useAtomValue(connectionStatusAtom);
  const [response, setResponse] = useState<MonitoringResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeWindow, setTimeWindow] = useState<"5m" | "15m" | "30m">("15m");
  const [controlsOpen, setControlsOpen] = useState(false);

  useEffect(() => {
    if (!wsClient || connectionStatus !== "connected") {
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const next = await wsClient.sendCommand<MonitoringResponse>("monitoring.get", {}, undefined);
        if (!cancelled) {
          setResponse(next);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : t("monitoring.load_failed"));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();
    const unsubscribe = wsClient.subscribe([Topics.monitoringSnapshotUpdated], (_topic, payload) => {
      setResponse(payload as MonitoringResponse);
      setLoading(false);
      setError(null);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [connectionStatus, t, wsClient]);

  const dockExpanded = !monitoringSettings.enabled || !response?.settings.enabled || controlsOpen;

  return (
    <section className="settings-monitoring">
      <div className="settings-monitoring__header">
        <div>
          <h2 className="settings-group-title">{t("monitoring.title")}</h2>
          <p className="settings-group-desc">{t("monitoring.description")}</p>
        </div>
        <div className="settings-monitoring__header-actions">
          <Tag color="neutral" caps={false}>
            {response ? formatRefreshInterval(response.settings.sampleIntervalMs) : "--"}
          </Tag>
          <Button size="sm" variant="secondary" onClick={() => setControlsOpen((current) => !current)}>
            {t("monitoring.configure")}
          </Button>
        </div>
      </div>

      <div className="settings-monitoring__layout">
        <div className="settings-monitoring__stage">{/* move the existing overview/attribution/process content here */}</div>
        <aside className={`settings-monitoring__dock ${dockExpanded ? "settings-monitoring__dock--expanded" : ""}`}>
          <MonitoringSettingsCard
            mode={response?.snapshot.mode ?? "disabled"}
            onChange={onMonitoringSettingsChange}
            settings={monitoringSettings}
            docked
            showHeader={false}
          />
        </aside>
      </div>
    </section>
  );
}
```

In `packages/web/src/features/settings/components/settings-page.tsx`, remove `monitoringSettings` from `GeneralSettingsProps` and switch the section renderer:

```tsx
      case "monitoring":
        return (
          <MonitoringSettingsSubpage
            monitoringSettings={monitoringSettings}
            onMonitoringSettingsChange={saveMonitoringSettings}
          />
        );
```

and delete this block from `GeneralSettings`:

```tsx
      <div className="settings-group">
        <MonitoringSettingsCard
          mode={deriveMonitoringMode(monitoringSettings)}
          onChange={onMonitoringSettingsChange}
          onOpenMonitoring={() => navigate("/monitoring")}
          settings={monitoringSettings}
        />
      </div>
```

Update `MonitoringSettingsCard` to support embedded dock usage:

```tsx
interface MonitoringSettingsCardProps {
  readonly settings: MonitoringSettings;
  readonly mode: MonitoringMode;
  readonly onChange: (next: MonitoringSettings) => Promise<void> | void;
  readonly onOpenMonitoring?: () => void;
  readonly showHeader?: boolean;
  readonly docked?: boolean;
}
```

and gate the old ghost button/header chrome behind `showHeader !== false`.

- [ ] **Step 4: Run the embedded-subpage tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/settings/components/monitoring-settings-subpage.test.tsx \
  src/features/settings/components/settings-page.test.tsx
```

Expected: PASS with monitoring rendered only inside the dedicated settings section.

- [ ] **Step 5: Commit the embedded-subpage slice**

```bash
git add \
  packages/web/src/features/settings/components/monitoring-settings-subpage.tsx \
  packages/web/src/features/settings/components/monitoring-settings-subpage.test.tsx \
  packages/web/src/features/settings/components/settings-page.tsx \
  packages/web/src/features/settings/components/settings-page.test.tsx \
  packages/web/src/features/settings/components/monitoring-settings-card.tsx \
  packages/web/src/features/monitoring/page.tsx \
  packages/web/src/features/monitoring/index.ts \
  packages/web/src/features/monitoring/page.test.tsx
git commit -m "feat: embed monitoring inside settings"
```

---

### Task 3: Restyle The Monitoring Subpage For Desktop And Mobile

**Files:**
- Modify: `packages/web/src/styles/components.css`
- Modify: `packages/web/src/styles/components.theme.test.ts`
- Modify: `packages/web/src/features/settings/components/monitoring-settings-subpage.test.tsx`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`

- [ ] **Step 1: Write the failing style and mobile-behavior tests**

Add to `packages/web/src/features/settings/components/monitoring-settings-subpage.test.tsx`:

```tsx
  it("renders the mobile configuration entry collapsed while monitoring is enabled", async () => {
    viewportMocks.viewport = "mobile";
    const response = buildResponse();
    const store = createStore();
    store.set(localeAtom, "en");
    store.set(connectionStatusAtom, "connected");
    store.set(wsClientAtom, {
      sendCommand: vi.fn().mockResolvedValue(response),
      subscribe: vi.fn(() => () => {}),
    } as never);

    render(
      <Provider store={store}>
        <MonitoringSettingsSubpage
          monitoringSettings={response.settings}
          onMonitoringSettingsChange={vi.fn()}
        />
      </Provider>
    );

    expect(await screen.findByRole("button", { name: "Configure monitoring" })).toBeInTheDocument();
    expect(document.querySelector(".settings-monitoring__dock--expanded")).toBeNull();
  });
```

Add monitoring layout assertions to `packages/web/src/styles/components.theme.test.ts`:

```ts
  it("keeps the monitoring settings subpage on token-driven dashboard surfaces", () => {
    const layout = getLastRuleBlock(".settings-monitoring__layout");
    const stage = getLastRuleBlock(".settings-monitoring__stage");
    const dock = getLastRuleBlock(".settings-monitoring__dock");
    const mobileDock = getLastRuleBlock("@media (max-width: 899px)", ".settings-monitoring__dock");

    expect(layout).toContain("grid-template-columns: minmax(0, 1.7fr) minmax(280px, 0.95fr)");
    expect(stage).toContain("gap: var(--sp-4)");
    expect(dock).toContain("border: 1px solid var(--surface-elevated-border)");
    expect(dock).toContain("background: var(--surface-elevated)");
    expect(mobileDock).toContain("grid-column: 1");
  });
```

- [ ] **Step 2: Run the monitoring subpage and theme tests to verify failure**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/settings/components/monitoring-settings-subpage.test.tsx \
  src/styles/components.theme.test.ts
```

Expected:
- FAIL because there is no mobile collapsed-dock behavior yet
- FAIL because `settings-monitoring__layout` and related selectors do not exist in the stylesheet

- [ ] **Step 3: Implement the dashboard and responsive styles**

Add this selector block to `packages/web/src/styles/components.css` near the existing monitoring rules:

```css
.settings-monitoring {
  display: grid;
  gap: var(--sp-4);
}

.settings-monitoring__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--sp-3);
}

.settings-monitoring__layout {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(280px, 0.95fr);
  gap: var(--sp-4);
  align-items: start;
}

.settings-monitoring__stage {
  display: grid;
  gap: var(--sp-4);
}

.settings-monitoring__dock {
  display: grid;
  gap: var(--sp-3);
  border: 1px solid var(--surface-elevated-border);
  background: var(--surface-elevated);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-sm);
  padding: var(--sp-4);
}

.settings-monitoring__dock-entry {
  display: none;
}

@media (max-width: 899px) {
  .settings-monitoring__layout {
    grid-template-columns: minmax(0, 1fr);
  }

  .settings-monitoring__dock {
    grid-column: 1;
  }

  .settings-monitoring__dock:not(.settings-monitoring__dock--expanded) {
    display: none;
  }

  .settings-monitoring__dock-entry {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-3);
    border: 1px solid var(--surface-elevated-border);
    background: var(--surface-elevated);
    border-radius: var(--radius-lg);
    padding: var(--sp-3);
  }
}
```

Render the mobile entry card in `MonitoringSettingsSubpage`:

```tsx
      {isMobile && !dockExpanded ? (
        <button
          type="button"
          className="settings-monitoring__dock-entry"
          onClick={() => setControlsOpen(true)}
        >
          <span>{t("monitoring.configure")}</span>
          <Tag color="neutral" caps={false}>
            {response ? formatRefreshInterval(response.settings.sampleIntervalMs) : "--"}
          </Tag>
        </button>
      ) : null}
```

Add locale keys:

```json
"configure": "Configure monitoring"
```

and:

```json
"configure": "配置监控"
```

- [ ] **Step 4: Run the style and monitoring subpage tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/settings/components/monitoring-settings-subpage.test.tsx \
  src/styles/components.theme.test.ts
```

Expected: PASS with the desktop two-column layout and mobile collapsed-entry behavior locked down.

- [ ] **Step 5: Commit the layout/style slice**

```bash
git add \
  packages/web/src/styles/components.css \
  packages/web/src/styles/components.theme.test.ts \
  packages/web/src/features/settings/components/monitoring-settings-subpage.test.tsx \
  packages/web/src/locales/en.json \
  packages/web/src/locales/zh.json
git commit -m "feat: restyle monitoring settings subpage"
```

---

### Task 4: Verify The Full Web Slice

**Files:**
- Test only; no new source files unless a regression is found during this step.

- [ ] **Step 1: Run the full targeted web verification**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/settings/components/settings-page.test.tsx \
  src/features/settings/components/monitoring-settings-subpage.test.tsx \
  src/features/command-palette/components/command-palette.test.tsx \
  src/shells/desktop-shell.test.tsx \
  src/shells/mobile-shell/index.test.tsx \
  src/styles/components.theme.test.ts
```

Expected: PASS with no `/monitoring` route assumptions left.

- [ ] **Step 2: Run the web typecheck**

Run:

```bash
pnpm --filter @coder-studio/web exec tsc -p tsconfig.json --noEmit
```

Expected: exit code `0`.

- [ ] **Step 3: Commit the verification checkpoint**

```bash
git add -A
git commit -m "test: verify monitoring settings subpage redesign"
```

Only include files touched by Tasks 1-3. If unrelated user files are still untracked, stage explicit paths instead of `-A`.

---

## Self-Review

- Spec coverage: the plan covers information architecture (`Task 1`), embedded monitoring composition (`Task 2`), and desktop/mobile visual redesign (`Task 3`), with explicit verification in `Task 4`.
- Placeholder scan: no `TODO`, `TBD`, or “similar to above” placeholders remain.
- Type consistency: the plan consistently uses `monitoring` as the new settings section id, `MonitoringSettingsSubpage` as the embedded component, and `/settings?section=monitoring` as the only navigation target.
