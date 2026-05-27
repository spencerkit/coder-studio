# Diagnostics Monitoring Layout Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the diagnostics/settings monitoring surface into a single top control bar plus a data-first dashboard below it, while tightening monitoring typography on both desktop and mobile.

**Architecture:** Keep the existing monitoring websocket commands, optimistic settings behavior, and dashboard data model unchanged. Replace the current `stage + dock` / mobile-entry shell with a unified `settings-monitoring-shell` that renders a compact control bar, an inline advanced-settings disclosure, and the existing `MonitoringDashboard` underneath. Typography changes stay local to the monitoring selectors in `components.css` so the global token system remains untouched.

**Tech Stack:** TypeScript, React 19, Jotai, Vitest, Testing Library, and the shared token-driven stylesheet in `packages/web/src/styles/components.css`.

**Spec reference:** `docs/superpowers/specs/2026-05-27-diagnostics-monitoring-layout-refinement-design.md`

**Git hygiene:** The worktree already contains unrelated untracked files. Stage only the files named in each task, do not revert unrelated edits, and keep commits scoped to a single task.

---

## File Structure

**Modify:**
- `packages/web/src/features/settings/components/monitoring-settings-subpage.tsx`
  - Replace the stage/dock split with a unified shell that renders the compact control bar, an advanced-settings disclosure, and the dashboard stack underneath.
- `packages/web/src/features/settings/components/monitoring-settings-card.tsx`
  - Convert the monitoring settings card into a compact controls surface with optional advanced-settings rendering instead of a full standalone card.
- `packages/web/src/features/monitoring/page.tsx`
  - Keep dashboard data behavior intact, but tighten monitoring header semantics and card title hierarchy to match the refined layout.
- `packages/web/src/features/settings/components/monitoring-settings-subpage.test.tsx`
  - Replace dock/mobile-entry assertions with tests for the unified control bar, disclosure behavior, disabled state, and mobile parity.
- `packages/web/src/features/settings/components/settings-page.test.tsx`
  - Update the settings-level monitoring assertions that still expect the old dock-first mobile structure.
- `packages/web/src/styles/components.css`
  - Remove the old `stage`, `dock`, and mobile-entry layout rules; add the unified control-bar/disclosure styles and local typography reductions.
- `packages/web/src/styles/components.theme.test.ts`
  - Replace the stage/dock token assertions with checks for the new unified shell, control bar, disclosure, and tightened monitoring typography selectors.
- `packages/web/src/locales/en.json`
  - Update monitoring copy away from “dock/open configuration” wording toward “controls/advanced settings” wording where the component still references those keys.
- `packages/web/src/locales/zh.json`
  - Chinese counterparts for the monitoring control-bar and advanced-settings copy.

**Testing commands used in this plan:**
- `pnpm --filter @coder-studio/web exec vitest run src/features/settings/components/monitoring-settings-subpage.test.tsx src/features/settings/components/settings-page.test.tsx`
- `pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts`
- `pnpm --filter @coder-studio/web exec vitest run src/features/settings/components/monitoring-settings-subpage.test.tsx src/features/settings/components/settings-page.test.tsx src/styles/components.theme.test.ts`
- `pnpm --filter @coder-studio/web exec tsc -p tsconfig.json --noEmit`

---

### Task 1: Replace The Monitoring Shell With A Unified Control Bar

**Files:**
- Modify: `packages/web/src/features/settings/components/monitoring-settings-subpage.tsx`
- Modify: `packages/web/src/features/settings/components/monitoring-settings-subpage.test.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.test.tsx`

- [ ] **Step 1: Write the failing shell-structure tests**

Update `packages/web/src/features/settings/components/monitoring-settings-subpage.test.tsx` by replacing the old desktop/mobile structure assertions with these tests:

```tsx
  it("renders monitoring controls above the dashboard on desktop", async () => {
    const settings = {
      ...createDefaultMonitoringSettings(),
      enabled: true,
      runtimeSummaryEnabled: true,
      workspaceAttributionEnabled: true,
    };

    const { container } = renderSubpage(settings, createMonitoringDataResult(settings), {
      viewport: "desktop",
    });

    expect(await screen.findByText("Host overview")).toBeInTheDocument();
    expect(container.querySelector(".settings-monitoring-shell")).toBeInTheDocument();
    expect(container.querySelector(".settings-monitoring-control-bar")).toBeInTheDocument();
    expect(container.querySelector(".settings-monitoring-stage")).toBeNull();
    expect(container.querySelector(".settings-monitoring-dock")).toBeNull();
    expect(container.querySelector(".settings-monitoring-mobile-entry")).toBeNull();
    expect(screen.getByRole("switch", { name: "Enable performance monitoring" })).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "Preset" })).toBeInTheDocument();

    const shell = container.querySelector(".settings-monitoring-shell");
    expect(shell?.firstElementChild).toHaveClass("settings-monitoring-control-bar");
    expect(shell?.lastElementChild).toHaveClass("settings-monitoring-dashboard-stage");
  });

  it("keeps the same control-first structure on mobile without a configuration entry card", async () => {
    const settings = {
      ...createDefaultMonitoringSettings(),
      enabled: true,
      runtimeSummaryEnabled: true,
      workspaceAttributionEnabled: true,
    };

    const { container } = renderSubpage(settings, createMonitoringDataResult(settings), {
      viewport: "mobile",
    });

    expect(await screen.findByText("Host overview")).toBeInTheDocument();
    expect(container.querySelector(".settings-monitoring-control-bar")).toBeInTheDocument();
    expect(container.querySelector(".settings-monitoring-mobile-entry")).toBeNull();
    expect(screen.getByRole("switch", { name: "Enable performance monitoring" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show advanced monitoring settings" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
  });

  it("shows advanced monitoring settings only after expanding the disclosure", async () => {
    const settings = {
      ...createDefaultMonitoringSettings(),
      enabled: true,
      runtimeSummaryEnabled: true,
      workspaceAttributionEnabled: true,
    };

    renderSubpage(settings, createMonitoringDataResult(settings), {
      viewport: "desktop",
    });

    expect(await screen.findByRole("switch", { name: "Enable performance monitoring" })).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Host metrics" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show advanced monitoring settings" }));

    expect(screen.getByRole("button", { name: "Show advanced monitoring settings" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    expect(screen.getByRole("switch", { name: "Host metrics" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Runtime summary" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Workspace and session attribution" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Subprocess drill-down" })).toBeInTheDocument();
  });
```

Update the settings-page integration assertion in `packages/web/src/features/settings/components/settings-page.test.tsx`:

```tsx
    const shell = document.querySelector(".settings-monitoring-shell");
    expect(shell?.firstElementChild).toHaveClass("settings-monitoring-control-bar");
    expect(screen.queryByRole("button", { name: "打开监控配置" })).toBeNull();
    expect(screen.getByRole("button", { name: "显示高级监控设置" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
```

- [ ] **Step 2: Run the focused shell tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/settings/components/monitoring-settings-subpage.test.tsx \
  src/features/settings/components/settings-page.test.tsx
```

Expected:
- FAIL because the shell still renders `.settings-monitoring-stage`, `.settings-monitoring-dock`, and `.settings-monitoring-mobile-entry`
- FAIL because advanced switches are always visible and there is no disclosure trigger

- [ ] **Step 3: Implement the unified shell in `monitoring-settings-subpage.tsx`**

Replace the current component body in `packages/web/src/features/settings/components/monitoring-settings-subpage.tsx` with this structure:

```tsx
interface MonitoringSettingsCardProps {
  readonly settings: MonitoringSettings;
  readonly mode: MonitoringMode;
  readonly monitoringSettingsReady: boolean;
  readonly onChange: (next: MonitoringSettings) => Promise<void> | void;
  readonly headerActions?: ReactNode;
  readonly showHeaderChrome?: boolean;
  readonly advancedExpanded?: boolean;
  readonly onAdvancedExpandedChange?: (expanded: boolean) => void;
}

export function MonitoringSettingsSubpage({
  mode,
  monitoringSettingsReady,
  monitoringData,
  onChange,
  settings,
}: MonitoringSettingsSubpageProps) {
  const t = useTranslation();
  const isMobile = useViewport() === "mobile";
  const [advancedExpanded, setAdvancedExpanded] = useState(false);

  useEffect(() => {
    if (!settings.enabled) {
      setAdvancedExpanded(true);
    }
  }, [settings.enabled]);

  const stageResponse = monitoringData.response
    ? settings.enabled && !monitoringData.response.settings.enabled
      ? {
          ...createEmptyMonitoringResponse(settings),
          capabilities: monitoringData.response.capabilities,
          telemetry: monitoringData.response.telemetry,
        }
      : {
          ...monitoringData.response,
          settings,
          snapshot: {
            ...monitoringData.response.snapshot,
            mode,
          },
        }
    : null;

  return (
    <section
      className={`settings-section settings-monitoring-shell ${
        isMobile ? "settings-monitoring-shell--mobile" : "settings-monitoring-shell--desktop"
      }`}
      aria-label={t("monitoring.mobile_section")}
    >
      <div className="settings-monitoring-control-bar">
        <div className="settings-monitoring-control-bar__copy">
          <p className="settings-monitoring-control-bar__eyebrow">{t("monitoring.stage_eyebrow")}</p>
          <p className="settings-monitoring-control-bar__summary">{t("monitoring.stage_summary")}</p>
        </div>
        <MonitoringSettingsCard
          mode={mode}
          monitoringSettingsReady={monitoringSettingsReady}
          onChange={async (next) => {
            try {
              await onChange(next);
            } catch {
              return;
            }
          }}
          settings={settings}
          advancedExpanded={advancedExpanded}
          onAdvancedExpandedChange={setAdvancedExpanded}
          showHeaderChrome={false}
        />
      </div>

      <div className="settings-monitoring-dashboard-stage">
        <MonitoringDashboard
          error={monitoringData.error}
          loading={monitoringData.loading}
          refresh={monitoringData.refresh}
          response={stageResponse}
        />
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run the shell tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/settings/components/monitoring-settings-subpage.test.tsx \
  src/features/settings/components/settings-page.test.tsx
```

Expected: PASS for the new control-bar order, disclosure trigger, and no-mobile-entry behavior.

- [ ] **Step 5: Commit the shell restructure**

```bash
git add \
  packages/web/src/features/settings/components/monitoring-settings-subpage.tsx \
  packages/web/src/features/settings/components/monitoring-settings-subpage.test.tsx \
  packages/web/src/features/settings/components/settings-page.test.tsx
git commit -m "refactor: unify monitoring settings shell"
```

### Task 2: Convert Monitoring Settings Into Compact Core Controls Plus Advanced Disclosure

**Files:**
- Modify: `packages/web/src/features/settings/components/monitoring-settings-card.tsx`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`
- Modify: `packages/web/src/features/settings/components/monitoring-settings-subpage.test.tsx`

- [ ] **Step 1: Write the failing compact-controls tests**

Extend `packages/web/src/features/settings/components/monitoring-settings-subpage.test.tsx` with these assertions:

```tsx
  it("keeps core controls visible while hiding advanced switches by default", async () => {
    const settings = {
      ...createDefaultMonitoringSettings(),
      enabled: true,
      runtimeSummaryEnabled: true,
      workspaceAttributionEnabled: true,
    };

    renderSubpage(settings, createMonitoringDataResult(settings));

    expect(await screen.findByRole("switch", { name: "Enable performance monitoring" })).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "Preset" })).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "Refresh rate" })).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Host metrics" })).not.toBeInTheDocument();
  });

  it("auto-expands advanced settings when monitoring is disabled", async () => {
    const settings = {
      ...createDefaultMonitoringSettings(),
      enabled: false,
      runtimeSummaryEnabled: true,
    };

    renderSubpage(settings, createMonitoringDataResult(settings), {
      viewport: "mobile",
    });

    expect(await screen.findByRole("button", { name: "Show advanced monitoring settings" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    expect(screen.getByRole("switch", { name: "Host metrics" })).toBeDisabled();
    expect(screen.getByText("Monitoring disabled")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the subpage tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/settings/components/monitoring-settings-subpage.test.tsx
```

Expected:
- FAIL because `MonitoringSettingsCard` still renders all switches immediately
- FAIL because there is no advanced-settings disclosure state

- [ ] **Step 3: Refactor `MonitoringSettingsCard` into compact controls**

Update the props and render path in `packages/web/src/features/settings/components/monitoring-settings-card.tsx`:

```tsx
interface MonitoringSettingsCardProps {
  readonly settings: MonitoringSettings;
  readonly mode: MonitoringMode;
  readonly monitoringSettingsReady: boolean;
  readonly onChange: (next: MonitoringSettings) => Promise<void> | void;
  readonly headerActions?: ReactNode;
  readonly showHeaderChrome?: boolean;
  readonly advancedExpanded?: boolean;
  readonly onAdvancedExpandedChange?: (expanded: boolean) => void;
}
```

Render the compact structure:

```tsx
      <div className="settings-monitoring-core-controls">
        <div className="settings-toggle-row settings-toggle-row--compact">
          <div className="settings-toggle-info">
            <span className="settings-toggle-label">{t("monitoring.enable_monitoring")}</span>
            <span className="settings-toggle-desc">{t("monitoring.enable_monitoring_hint")}</span>
          </div>
          <Switch
            aria-label={t("monitoring.enable_monitoring")}
            checked={resolvedSettings.enabled}
            className="settings-toggle"
            disabled={controlsDisabled}
            onCheckedChange={(checked) => void onChange({ ...resolvedSettings, enabled: checked })}
          />
        </div>

        <div className="settings-info-row monitoring-settings-row monitoring-settings-row--compact">
          <span className="settings-info-label">{t("monitoring.preset")}</span>
          <SegmentedControl
            aria-disabled={controlsDisabled ? "true" : "false"}
            aria-label={t("monitoring.preset")}
            onChange={(value) => void applyPreset(value as MonitoringPreset)}
            options={[
              { value: "light", label: t("monitoring.mode_light"), disabled: controlsDisabled },
              { value: "standard", label: t("monitoring.mode_standard"), disabled: controlsDisabled },
              { value: "deep", label: t("monitoring.mode_deep"), disabled: controlsDisabled },
              { value: "custom", label: t("monitoring.mode_custom"), disabled: controlsDisabled },
            ]}
            size="sm"
            value={toPreset(resolvedSettings)}
          />
        </div>

        <div className="settings-info-row monitoring-settings-row monitoring-settings-row--compact">
          <span className="settings-info-label">{t("monitoring.refresh_rate")}</span>
          <SegmentedControl
            aria-disabled={controlsDisabled ? "true" : "false"}
            aria-label={t("monitoring.refresh_rate")}
            onChange={(value) =>
              void onChange({
                ...resolvedSettings,
                sampleIntervalMs: Number(value) as MonitoringSampleIntervalMs,
              })
            }
            options={MONITORING_SAMPLE_INTERVAL_OPTIONS.map((interval) => ({
              value: String(interval),
              label: `${interval / 1000}s`,
              disabled: controlsDisabled,
            }))}
            size="sm"
            value={String(resolvedSettings.sampleIntervalMs)}
          />
        </div>
      </div>

      <div className="settings-monitoring-advanced">
        <button
          type="button"
          className="settings-monitoring-advanced__toggle"
          aria-expanded={advancedExpanded ? "true" : "false"}
          aria-label={t("monitoring.advanced_settings")}
          onClick={() => onAdvancedExpandedChange?.(!advancedExpanded)}
        >
          <span className="settings-monitoring-advanced__label">{t("monitoring.advanced_settings")}</span>
          <span className="settings-monitoring-advanced__hint">
            {advancedExpanded ? t("action.collapse") : t("action.expand")}
          </span>
        </button>

        {advancedExpanded ? (
          <div className="monitoring-settings-grid">
            {/* keep the existing four switch rows here unchanged */}
          </div>
        ) : null}
      </div>
```

Add locale keys in `packages/web/src/locales/en.json`:

```json
    "advanced_settings": "Show advanced monitoring settings",
```

and in `packages/web/src/locales/zh.json`:

```json
    "advanced_settings": "显示高级监控设置",
```

- [ ] **Step 4: Run the subpage tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/settings/components/monitoring-settings-subpage.test.tsx
```

Expected: PASS for the compact-control visibility, disabled auto-expansion, and advanced disclosure behavior.

- [ ] **Step 5: Commit the compact controls refactor**

```bash
git add \
  packages/web/src/features/settings/components/monitoring-settings-card.tsx \
  packages/web/src/features/settings/components/monitoring-settings-subpage.test.tsx \
  packages/web/src/locales/en.json \
  packages/web/src/locales/zh.json
git commit -m "refactor: compact monitoring control bar"
```

### Task 3: Tighten Monitoring Typography And Local Layout Styles

**Files:**
- Modify: `packages/web/src/features/monitoring/page.tsx`
- Modify: `packages/web/src/styles/components.css`
- Modify: `packages/web/src/styles/components.theme.test.ts`

- [ ] **Step 1: Write the failing theme-style assertions**

Replace the old monitoring-subpage token test in `packages/web/src/styles/components.theme.test.ts` with:

```ts
  it("keeps the unified monitoring shell and compact typography on shared theme tokens", () => {
    const shell = getLastRuleBlock(".settings-monitoring-shell");
    const controlBar = getLastRuleBlock(".settings-monitoring-control-bar");
    const controlSummary = getLastRuleBlock(".settings-monitoring-control-bar__summary");
    const advancedToggle = getLastRuleBlock(".settings-monitoring-advanced__toggle");
    const dashboardStage = getLastRuleBlock(".settings-monitoring-dashboard-stage");
    const dashboardCardTitle = getLastRuleBlock(".monitoring-card__header h2");
    const detailHeading = getLastRuleBlock(".monitoring-detail h3");

    expect(shell).toContain("display: flex");
    expect(shell).toContain("flex-direction: column");
    expect(controlBar).toContain("border: 1px solid var(--surface-elevated-border)");
    expect(controlBar).toContain("background: var(--surface-elevated)");
    expect(controlBar).toContain("padding: var(--sp-4)");
    expect(controlSummary).toContain("font-size: var(--type-body-5-size)");
    expect(controlSummary).toContain("color: var(--text-secondary)");
    expect(advancedToggle).toContain("font-size: var(--type-body-5-size)");
    expect(advancedToggle).toContain("border-top: 1px solid var(--surface-elevated-border)");
    expect(dashboardStage).toContain("min-width: 0");
    expect(dashboardCardTitle).toContain("font-size: var(--type-heading-6-size)");
    expect(detailHeading).toContain("font-size: var(--type-body-3-size)");
  });
```

- [ ] **Step 2: Run the theme test to verify it fails**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts
```

Expected:
- FAIL because the stylesheet still defines grid-based stage/dock rules and larger title selectors

- [ ] **Step 3: Update the monitoring styles and local title semantics**

In `packages/web/src/features/monitoring/page.tsx`, downgrade the empty-state heading and selected-entity heading emphasis:

```tsx
      <div className="monitoring-card monitoring-card--empty">
        <h2 className="monitoring-card__title">{t("monitoring.disabled_title")}</h2>
        <p>{t("monitoring.disabled_description")}</p>
        {onOpenSettings ? (
          <div className="settings-actions-row">
            <Button variant="secondary" onClick={onOpenSettings}>
              {t("monitoring.open_settings")}
            </Button>
          </div>
        ) : null}
      </div>
```

and:

```tsx
            <p>{t("monitoring.select_entity")}</p>
            {selectedEntity ? (
              <>
                <h3 className="monitoring-detail__entity-title">{selectedEntity.label}</h3>
                {entityDetailRows(selectedEntity, t).map((row) => (
                  <MetricRow key={row.label} label={row.label} value={row.value} />
                ))}
```

In `packages/web/src/styles/components.css`, replace the old monitoring shell rules with:

```css
.settings-monitoring-shell {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}

.settings-monitoring-control-bar,
.settings-monitoring-dashboard-stage {
  min-width: 0;
  border: 1px solid var(--surface-elevated-border);
  background: var(--surface-elevated);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-sm);
}

.settings-monitoring-control-bar {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
  padding: var(--sp-4);
}

.settings-monitoring-control-bar__copy {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}

.settings-monitoring-control-bar__eyebrow {
  color: var(--text-tertiary);
  font-size: var(--type-body-6-size);
  line-height: var(--type-body-6-line-height);
  font-weight: var(--type-body-6-weight);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.settings-monitoring-control-bar__summary {
  color: var(--text-secondary);
  font-size: var(--type-body-5-size);
  line-height: var(--type-body-5-line-height);
  font-weight: var(--type-body-5-weight);
  max-width: 72ch;
}

.settings-monitoring-dashboard-stage {
  padding: var(--sp-4);
}

.settings-monitoring-core-controls {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--sp-3);
}

.monitoring-settings-row--compact,
.settings-toggle-row--compact {
  margin-bottom: 0;
}

.settings-monitoring-advanced {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

.settings-monitoring-advanced__toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  width: 100%;
  padding-top: var(--sp-3);
  border-top: 1px solid var(--surface-elevated-border);
  color: var(--text-primary);
  text-align: left;
  font-size: var(--type-body-5-size);
  line-height: var(--type-body-5-line-height);
  font-weight: var(--type-body-5-weight);
}

.monitoring-card__header h2,
.monitoring-tree .monitoring-card__header h2,
.monitoring-detail .monitoring-card__header h2,
.monitoring-card__title {
  font-size: var(--type-heading-6-size);
  line-height: var(--type-heading-6-line-height);
  font-weight: var(--font-medium);
}

.monitoring-detail__entity-title {
  font-size: var(--type-body-3-size);
  line-height: var(--type-body-3-line-height);
  font-weight: var(--font-medium);
}

.monitoring-card p,
.monitoring-detail p,
.settings-monitoring-shell p {
  font-size: var(--type-body-5-size);
  line-height: var(--type-body-5-line-height);
}

@media (max-width: 900px) {
  .settings-monitoring-control-bar,
  .settings-monitoring-dashboard-stage {
    padding: var(--sp-3);
  }

  .settings-monitoring-core-controls {
    grid-template-columns: 1fr;
  }
}
```

Delete the obsolete selectors:

```css
.settings-monitoring-shell--desktop
.settings-monitoring-shell--dock-priority .settings-monitoring-dock
.settings-monitoring-stage
.settings-monitoring-stage__header
.settings-monitoring-stage__eyebrow
.settings-monitoring-stage__title
.settings-monitoring-stage__summary
.settings-monitoring-dock
.settings-monitoring-dock__panel
.settings-monitoring-dock__header
.settings-monitoring-dock__copy
.settings-monitoring-dock__eyebrow
.settings-monitoring-dock__title
.settings-monitoring-dock__summary
.settings-monitoring-mobile-entry
.settings-monitoring-mobile-entry__header
.settings-monitoring-mobile-entry__copy
.settings-monitoring-mobile-entry__eyebrow
.settings-monitoring-mobile-entry__title
.settings-monitoring-mobile-entry__badge
.settings-monitoring-mobile-entry__summary
.settings-monitoring-mobile-entry__action
.settings-monitoring-dock-toggle
.settings-monitoring-dock__body
.settings-monitoring-dock__body > .settings-card--monitoring
.settings-monitoring-dock__body > .settings-card--monitoring .settings-toggle-row:last-child
.settings-monitoring-dock__body > .settings-card--monitoring .settings-info-row:last-child
```

- [ ] **Step 4: Run the theme test to verify it passes**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts
```

Expected: PASS for the unified shell selectors, token-backed surfaces, and reduced local typography.

- [ ] **Step 5: Commit the monitoring style refinement**

```bash
git add \
  packages/web/src/features/monitoring/page.tsx \
  packages/web/src/styles/components.css \
  packages/web/src/styles/components.theme.test.ts
git commit -m "style: refine monitoring layout and typography"
```

### Task 4: Run Final Verification And Land The Plan Scope

**Files:**
- Modify: `packages/web/src/features/settings/components/monitoring-settings-subpage.tsx`
- Modify: `packages/web/src/features/settings/components/monitoring-settings-subpage.test.tsx`
- Modify: `packages/web/src/features/settings/components/monitoring-settings-card.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.test.tsx`
- Modify: `packages/web/src/features/monitoring/page.tsx`
- Modify: `packages/web/src/styles/components.css`
- Modify: `packages/web/src/styles/components.theme.test.ts`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`

- [ ] **Step 1: Run the full focused test suite**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/settings/components/monitoring-settings-subpage.test.tsx \
  src/features/settings/components/settings-page.test.tsx \
  src/styles/components.theme.test.ts
```

Expected: PASS across the refined monitoring shell, the settings integration, and token-backed styles.

- [ ] **Step 2: Run the web typecheck**

Run:

```bash
pnpm --filter @coder-studio/web exec tsc -p tsconfig.json --noEmit
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 3: Commit any follow-up fixes from verification**

```bash
git add \
  packages/web/src/features/settings/components/monitoring-settings-subpage.tsx \
  packages/web/src/features/settings/components/monitoring-settings-subpage.test.tsx \
  packages/web/src/features/settings/components/monitoring-settings-card.tsx \
  packages/web/src/features/settings/components/settings-page.test.tsx \
  packages/web/src/features/monitoring/page.tsx \
  packages/web/src/styles/components.css \
  packages/web/src/styles/components.theme.test.ts \
  packages/web/src/locales/en.json \
  packages/web/src/locales/zh.json
git commit -m "test: verify monitoring layout refinement"
```

## Self-Review

### Spec coverage

- Unified head control bar plus dashboard below: covered by Task 1 and Task 3
- Advanced settings disclosure for the four low-frequency toggles: covered by Task 2
- No mobile configuration entry card: covered by Task 1 tests and implementation
- Typography reduction localized to monitoring selectors: covered by Task 3
- No backend/data-model changes: preserved by the file list and task scope

### Placeholder scan

- No `TODO`, `TBD`, or “implement later” placeholders remain
- Each code-edit step includes concrete snippets, concrete files, and concrete commands

### Type consistency

- `advancedExpanded` / `onAdvancedExpandedChange` are defined in Task 2 before being relied on by the shell from Task 1
- The new selectors referenced in tests match the selectors introduced in Task 3
