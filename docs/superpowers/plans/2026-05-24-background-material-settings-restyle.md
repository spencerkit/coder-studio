# Background Material Settings Restyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the `Background & Material` settings group into layered asset, material, and override surfaces without changing any appearance-personalization behavior.

**Architecture:** Keep the existing `appearance.personalization` state, field ids, `aria-*` labels, and `settings.update` dispatch flow intact. Only reorganize the `SettingsPage` markup around the current controls, then add token-driven CSS in `components.css` and lock the new structure down with component and theme assertions, including the mobile single-column fallback.

**Tech Stack:** React 19, Jotai, Vitest, Testing Library, Vite, and the shared token-driven stylesheet in `packages/web/src/styles/components.css`.

---

**Spec reference:** `docs/superpowers/specs/2026-05-24-background-material-settings-restyle-design.md`

**Git hygiene:** The current worktree already contains unrelated user changes and untracked docs files. Stage only the files listed in each task, and never revert or sweep unrelated edits.

## File Structure

**Modified files:**
- `packages/web/src/features/settings/components/settings-page.tsx` — regroup the background/material controls into dedicated asset, material, and override surfaces while preserving the existing state/update logic.
- `packages/web/src/features/settings/components/settings-page.test.tsx` — add structure-level regressions for the new grouped surfaces and nested override panels while keeping the existing persistence coverage intact.
- `packages/web/src/styles/components.css` — add token-driven surface, grid, action-row, nested override, and mobile collapse rules for the appearance section, including hiding the raw file input.
- `packages/web/src/styles/components.theme.test.ts` — assert the new appearance selectors stay on tokens, use a two-column desktop grid, and collapse to a single column on mobile.

**No backend changes:**
- `appearance.personalization` payload shape stays unchanged.
- `uploadAppearanceAsset` and `deleteAppearanceAsset` call sites stay unchanged.
- `settings.get` / `settings.update` commands stay unchanged.

**Testing commands used in this plan:**
- `pnpm --filter @coder-studio/web exec vitest run src/features/settings/components/settings-page.test.tsx`
- `pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts`
- `pnpm --filter @coder-studio/web exec vitest run src/features/settings/components/settings-page.test.tsx src/styles/components.theme.test.ts`

---

### Task 1: Regroup The Background-Material Markup

**Files:**
- Modify: `packages/web/src/features/settings/components/settings-page.test.tsx:1374-1563`
- Modify: `packages/web/src/features/settings/components/settings-page.tsx:2037-2605`

- [ ] **Step 1: Write the failing structure tests for grouped asset/material surfaces**

Add these two tests to `packages/web/src/features/settings/components/settings-page.test.tsx` immediately after the existing hydration and override coverage:

```tsx
  it("groups background material controls into asset and material surfaces", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "appearance.personalization.common.backgroundMode": "image",
          "appearance.personalization.common.backgroundAssetId": "asset-common",
          "appearance.personalization.common.backgroundFit": "contain",
          "appearance.personalization.common.backgroundDimness": 33,
          "appearance.personalization.common.backgroundBlur": 8,
          "appearance.personalization.common.glassEnabled": true,
          "appearance.personalization.common.glassIntensity": 44,
          "appearance.personalization.common.surfaceOpacity": 91,
        };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);
    fireEvent.click(screen.getByRole("button", { name: "外观" }));

    const backgroundMaterialGroup = (
      await screen.findByRole("heading", { name: "背景与材质" })
    ).closest(".settings-group");

    expect(backgroundMaterialGroup).not.toBeNull();

    const assetPanel = backgroundMaterialGroup?.querySelector(
      ".settings-appearance-panel--asset"
    );
    const materialPanel = backgroundMaterialGroup?.querySelector(
      ".settings-appearance-panel--material"
    );

    expect(assetPanel).not.toBeNull();
    expect(materialPanel).not.toBeNull();
    expect(document.getElementById("appearance-background-mode")?.closest(
      ".settings-appearance-panel--asset"
    )).toBe(assetPanel);
    expect(document.getElementById("appearance-background-fit")?.closest(
      ".settings-appearance-panel--asset"
    )).toBe(assetPanel);
    expect(screen.getByText("asset-common")).toHaveClass("settings-appearance-asset-id");
    expect(assetPanel?.querySelector(".settings-appearance-actions")).not.toBeNull();
    expect(
      screen
        .getByRole("spinbutton", { name: "背景压暗" })
        .closest(".settings-appearance-material-grid")
    ).toBeTruthy();
    expect(
      screen
        .getByRole("spinbutton", { name: "面板不透明度" })
        .closest(".settings-appearance-material-grid")
    ).toBeTruthy();
  });

  it("renders desktop and mobile override controls inside nested appearance panels", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "settings.get") {
        return {
          "appearance.personalization.common.backgroundMode": "image",
          "appearance.personalization.common.backgroundAssetId": "asset-common",
        };
      }
      return {};
    });
    const store = createConnectedStore(sendCommand);

    renderSettingsPage(store);
    fireEvent.click(screen.getByRole("button", { name: "外观" }));

    fireEvent.click(await screen.findByRole("switch", { name: "桌面端覆盖" }));

    const desktopSurfaceOpacity = document.getElementById("appearance-desktop-surface-opacity");

    expect(desktopSurfaceOpacity).not.toBeNull();
    expect(desktopSurfaceOpacity?.closest(".settings-appearance-override-panel")).toBeTruthy();
    expect(
      desktopSurfaceOpacity
        ?.closest(".settings-appearance-override-panel")
        ?.querySelector(".settings-appearance-actions")
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("switch", { name: "移动端覆盖" }));

    const mobileSurfaceOpacity = document.getElementById("appearance-mobile-surface-opacity");

    expect(mobileSurfaceOpacity).not.toBeNull();
    expect(mobileSurfaceOpacity?.closest(".settings-appearance-override-panel")).toBeTruthy();
  });
```

- [ ] **Step 2: Run the settings-page tests to verify failure**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/settings/components/settings-page.test.tsx
```

Expected:
- FAIL because `.settings-appearance-panel--asset` and `.settings-appearance-panel--material` do not exist yet
- FAIL because the override inputs are not wrapped in `.settings-appearance-override-panel`

- [ ] **Step 3: Implement the grouped asset/material/override markup in `settings-page.tsx`**

In `packages/web/src/features/settings/components/settings-page.tsx`, keep all existing update handlers and field ids, but add a small summary helper and regroup the JSX like this:

```tsx
  const renderAssetSummary = (
    target: AppearanceAssetScope,
    label: string,
    assetId: string | null | undefined,
    hasAsset: boolean
  ) => (
    <div className="settings-appearance-asset-summary">
      <div className="settings-toggle-info settings-appearance-asset-meta">
        <span className="settings-toggle-label">{label}</span>
        <span className="settings-toggle-desc settings-appearance-asset-id">
          {assetId ? assetId : t("settings.appearance_uses_shared_value")}
        </span>
      </div>
      {renderAssetButtons(target, hasAsset)}
    </div>
  );
```

Then replace the current loose rows inside the `背景与材质` group with this structure:

```tsx
        <div className="settings-appearance-panels">
          <div className="settings-appearance-panel settings-appearance-panel--asset">
            <div className="settings-config-field settings-config-field--inline">
              <label className="settings-config-label" htmlFor="appearance-background-mode">
                {t("settings.appearance_background_mode")}
              </label>
              <div className="settings-config-control">
                <Select
                  desktopMode="listbox"
                  id="appearance-background-mode"
                  aria-label={t("settings.appearance_background_mode")}
                  className="settings-input-compact"
                  mobileSheetTitle={t("settings.appearance_background_mode")}
                  options={[
                    { value: "none", label: t("settings.appearance_background_mode_off") },
                    { value: "image", label: t("settings.appearance_background_mode_image") },
                  ]}
                  value={personalization.common.backgroundMode}
                  onValueChange={(value) => {
                    const nextMode = value as AppearanceBackgroundMode;
                    const next = {
                      ...personalization,
                      common: buildCommonForBackgroundMode(nextMode),
                    };
                    next.common.backgroundMode = nextMode;
                    void saveNextPersonalization(next);
                  }}
                />
              </div>
            </div>

            {personalization.common.backgroundMode === "image"
              ? renderAssetSummary(
                  "common",
                  t("settings.appearance_background_upload"),
                  personalization.common.backgroundAssetId,
                  Boolean(personalization.common.backgroundAssetId)
                )
              : null}

            <div className="settings-config-field settings-config-field--inline">
              <label className="settings-config-label" htmlFor="appearance-background-fit">
                {t("settings.appearance_background_fit")}
              </label>
              <div className="settings-config-control">
                <Select
                  desktopMode="listbox"
                  id="appearance-background-fit"
                  aria-label={t("settings.appearance_background_fit")}
                  className="settings-input-compact"
                  mobileSheetTitle={t("settings.appearance_background_fit")}
                  options={[
                    { value: "cover", label: t("settings.appearance_background_fit_cover") },
                    { value: "contain", label: t("settings.appearance_background_fit_contain") },
                  ]}
                  value={personalization.common.backgroundFit}
                  onValueChange={(value) => {
                    void saveNextPersonalization(
                      updateCommon("backgroundFit", value as AppearanceBackgroundFit)
                    );
                  }}
                />
              </div>
            </div>
          </div>

          <div className="settings-appearance-panel settings-appearance-panel--material">
            <div className="settings-toggle-row">
              <div className="settings-toggle-info">
                <span className="settings-toggle-label" id={commonGlassLabelId}>
                  {t("settings.appearance_glass_enabled")}
                </span>
                <span className="settings-toggle-desc" id={commonGlassDescId}>
                  {t("settings.appearance_uses_shared_value")}
                </span>
              </div>
              <Switch
                aria-describedby={commonGlassDescId}
                aria-labelledby={commonGlassLabelId}
                checked={personalization.common.glassEnabled}
                className="settings-toggle"
                onCheckedChange={(nextValue) => {
                  void saveNextPersonalization(updateCommon("glassEnabled", nextValue));
                }}
              />
            </div>

            <div className="settings-appearance-material-grid">
              <div className="settings-config-field settings-config-field--inline settings-appearance-metric-field">
                <label className="settings-config-label" htmlFor="appearance-background-dimness">
                  {t("settings.appearance_background_dimness")}
                </label>
                <div className="settings-config-control">
                  <Input
                    id="appearance-background-dimness"
                    className="settings-input-compact"
                    inputMode="numeric"
                    invalid={Boolean(backgroundDimnessError)}
                    max={100}
                    min={0}
                    step={1}
                    type="number"
                    value={backgroundDimnessDraft}
                    onBlur={() => {
                      void commitBoundedCommonField(
                        backgroundDimnessDraft,
                        personalization.common.backgroundDimness,
                        0,
                        100,
                        setBackgroundDimnessDraft,
                        setBackgroundDimnessError,
                        "backgroundDimness"
                      );
                    }}
                    onChange={(event) => {
                      setBackgroundDimnessDraft(event.target.value);
                      setBackgroundDimnessError(null);
                    }}
                  />
                </div>
                {backgroundDimnessError ? (
                  <span className="form-error" role="alert">
                    {backgroundDimnessError}
                  </span>
                ) : null}
              </div>
              <div className="settings-config-field settings-config-field--inline settings-appearance-metric-field">
                <label className="settings-config-label" htmlFor="appearance-background-blur">
                  {t("settings.appearance_background_blur")}
                </label>
                <div className="settings-config-control">
                  <Input
                    id="appearance-background-blur"
                    className="settings-input-compact"
                    inputMode="numeric"
                    invalid={Boolean(backgroundBlurError)}
                    max={40}
                    min={0}
                    step={1}
                    type="number"
                    value={backgroundBlurDraft}
                    onBlur={() => {
                      void commitBoundedCommonField(
                        backgroundBlurDraft,
                        personalization.common.backgroundBlur,
                        0,
                        40,
                        setBackgroundBlurDraft,
                        setBackgroundBlurError,
                        "backgroundBlur"
                      );
                    }}
                    onChange={(event) => {
                      setBackgroundBlurDraft(event.target.value);
                      setBackgroundBlurError(null);
                    }}
                  />
                </div>
                {backgroundBlurError ? (
                  <span className="form-error" role="alert">
                    {backgroundBlurError}
                  </span>
                ) : null}
              </div>
              <div className="settings-config-field settings-config-field--inline settings-appearance-metric-field">
                <label className="settings-config-label" htmlFor="appearance-glass-intensity">
                  {t("settings.appearance_glass_intensity")}
                </label>
                <div className="settings-config-control">
                  <Input
                    id="appearance-glass-intensity"
                    className="settings-input-compact"
                    inputMode="numeric"
                    invalid={Boolean(glassIntensityError)}
                    max={100}
                    min={0}
                    step={1}
                    type="number"
                    value={glassIntensityDraft}
                    onBlur={() => {
                      void commitBoundedCommonField(
                        glassIntensityDraft,
                        personalization.common.glassIntensity,
                        0,
                        100,
                        setGlassIntensityDraft,
                        setGlassIntensityError,
                        "glassIntensity"
                      );
                    }}
                    onChange={(event) => {
                      setGlassIntensityDraft(event.target.value);
                      setGlassIntensityError(null);
                    }}
                  />
                </div>
                {glassIntensityError ? (
                  <span className="form-error" role="alert">
                    {glassIntensityError}
                  </span>
                ) : null}
              </div>
              <div className="settings-config-field settings-config-field--inline settings-appearance-metric-field">
                <label className="settings-config-label" htmlFor="appearance-surface-opacity">
                  {t("settings.appearance_surface_opacity")}
                </label>
                <div className="settings-config-control">
                  <Input
                    id="appearance-surface-opacity"
                    className="settings-input-compact"
                    inputMode="numeric"
                    invalid={Boolean(surfaceOpacityError)}
                    max={100}
                    min={0}
                    step={1}
                    type="number"
                    value={surfaceOpacityDraft}
                    onBlur={() => {
                      void commitBoundedCommonField(
                        surfaceOpacityDraft,
                        personalization.common.surfaceOpacity,
                        0,
                        100,
                        setSurfaceOpacityDraft,
                        setSurfaceOpacityError,
                        "surfaceOpacity"
                      );
                    }}
                    onChange={(event) => {
                      setSurfaceOpacityDraft(event.target.value);
                      setSurfaceOpacityError(null);
                    }}
                  />
                </div>
                {surfaceOpacityError ? (
                  <span className="form-error" role="alert">
                    {surfaceOpacityError}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="settings-appearance-overrides">
            <div className="settings-toggle-row">
              <div className="settings-toggle-info">
                <span className="settings-toggle-label" id={desktopOverrideLabelId}>
                  {t("settings.appearance_override_desktop")}
                </span>
                <span className="settings-toggle-desc" id={desktopOverrideDescId}>
                  {isOverrideEnabled("desktop")
                    ? t("settings.appearance_override_enabled")
                    : t("settings.appearance_uses_shared_value")}
                </span>
              </div>
              <Switch
                aria-describedby={desktopOverrideDescId}
                aria-labelledby={desktopOverrideLabelId}
                checked={isOverrideEnabled("desktop")}
                className="settings-toggle"
                onCheckedChange={(nextValue) => {
                  void saveNextPersonalization(toggleOverride("desktop", nextValue));
                }}
              />
            </div>

            {isOverrideEnabled("desktop") ? (
              <div className="settings-appearance-override-panel">
                {personalization.common.backgroundMode === "image"
                  ? renderAssetSummary(
                      "desktop",
                      t("settings.appearance_override_desktop"),
                      personalization.desktop.backgroundAssetId,
                      Object.prototype.hasOwnProperty.call(
                        personalization.desktop,
                        "backgroundAssetId"
                      )
                    )
                  : null}
                <div className="settings-toggle-row">
                  <div className="settings-toggle-info">
                    <span className="settings-toggle-label" id={desktopGlassLabelId}>
                      {t("settings.appearance_glass_enabled")}
                    </span>
                    <span className="settings-toggle-desc" id={desktopGlassDescId}>
                      {t("settings.appearance_override_desktop")}
                    </span>
                  </div>
                  <Switch
                    aria-describedby={desktopGlassDescId}
                    aria-labelledby={desktopGlassLabelId}
                    checked={
                      personalization.desktop.glassEnabled ?? personalization.common.glassEnabled
                    }
                    className="settings-toggle"
                    onCheckedChange={(nextValue) => {
                      void saveNextPersonalization(
                        updateOverride("desktop", "glassEnabled", nextValue)
                      );
                    }}
                  />
                </div>

                <div className="settings-config-field settings-config-field--inline settings-appearance-metric-field">
                  <label
                    className="settings-config-label"
                    htmlFor="appearance-desktop-surface-opacity"
                  >
                    {t("settings.appearance_surface_opacity")}
                  </label>
                  <div className="settings-config-control">
                    <Input
                      id="appearance-desktop-surface-opacity"
                      className="settings-input-compact"
                      inputMode="numeric"
                      invalid={Boolean(desktopSurfaceOpacityError)}
                      max={100}
                      min={0}
                      step={1}
                      type="number"
                      value={desktopSurfaceOpacityDraft}
                      onBlur={() => {
                        void commitBoundedOverrideField(
                          "desktop",
                          desktopSurfaceOpacityDraft,
                          personalization.desktop.surfaceOpacity ??
                            personalization.common.surfaceOpacity,
                          0,
                          100,
                          setDesktopSurfaceOpacityDraft,
                          setDesktopSurfaceOpacityError,
                          "surfaceOpacity"
                        );
                      }}
                      onChange={(event) => {
                        setDesktopSurfaceOpacityDraft(event.target.value);
                        setDesktopSurfaceOpacityError(null);
                      }}
                    />
                  </div>
                  {desktopSurfaceOpacityError ? (
                    <span className="form-error" role="alert">
                      {desktopSurfaceOpacityError}
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="settings-toggle-row">
              <div className="settings-toggle-info">
                <span className="settings-toggle-label" id={mobileOverrideLabelId}>
                  {t("settings.appearance_override_mobile")}
                </span>
                <span className="settings-toggle-desc" id={mobileOverrideDescId}>
                  {isOverrideEnabled("mobile")
                    ? t("settings.appearance_override_enabled")
                    : t("settings.appearance_uses_shared_value")}
                </span>
              </div>
              <Switch
                aria-describedby={mobileOverrideDescId}
                aria-labelledby={mobileOverrideLabelId}
                checked={isOverrideEnabled("mobile")}
                className="settings-toggle"
                onCheckedChange={(nextValue) => {
                  void saveNextPersonalization(toggleOverride("mobile", nextValue));
                }}
              />
            </div>

            {isOverrideEnabled("mobile") ? (
              <div className="settings-appearance-override-panel">
                {personalization.common.backgroundMode === "image"
                  ? renderAssetSummary(
                      "mobile",
                      t("settings.appearance_override_mobile"),
                      personalization.mobile.backgroundAssetId,
                      Object.prototype.hasOwnProperty.call(
                        personalization.mobile,
                        "backgroundAssetId"
                      )
                    )
                  : null}
                <div className="settings-toggle-row">
                  <div className="settings-toggle-info">
                    <span className="settings-toggle-label" id={mobileGlassLabelId}>
                      {t("settings.appearance_glass_enabled")}
                    </span>
                    <span className="settings-toggle-desc" id={mobileGlassDescId}>
                      {t("settings.appearance_override_mobile")}
                    </span>
                  </div>
                  <Switch
                    aria-describedby={mobileGlassDescId}
                    aria-labelledby={mobileGlassLabelId}
                    checked={
                      personalization.mobile.glassEnabled ?? personalization.common.glassEnabled
                    }
                    className="settings-toggle"
                    onCheckedChange={(nextValue) => {
                      void saveNextPersonalization(
                        updateOverride("mobile", "glassEnabled", nextValue)
                      );
                    }}
                  />
                </div>

                <div className="settings-config-field settings-config-field--inline settings-appearance-metric-field">
                  <label
                    className="settings-config-label"
                    htmlFor="appearance-mobile-surface-opacity"
                  >
                    {t("settings.appearance_surface_opacity")}
                  </label>
                  <div className="settings-config-control">
                    <Input
                      id="appearance-mobile-surface-opacity"
                      className="settings-input-compact"
                      inputMode="numeric"
                      invalid={Boolean(mobileSurfaceOpacityError)}
                      max={100}
                      min={0}
                      step={1}
                      type="number"
                      value={mobileSurfaceOpacityDraft}
                      onBlur={() => {
                        void commitBoundedOverrideField(
                          "mobile",
                          mobileSurfaceOpacityDraft,
                          personalization.mobile.surfaceOpacity ??
                            personalization.common.surfaceOpacity,
                          0,
                          100,
                          setMobileSurfaceOpacityDraft,
                          setMobileSurfaceOpacityError,
                          "surfaceOpacity"
                        );
                      }}
                      onChange={(event) => {
                        setMobileSurfaceOpacityDraft(event.target.value);
                        setMobileSurfaceOpacityError(null);
                      }}
                    />
                  </div>
                  {mobileSurfaceOpacityError ? (
                    <span className="form-error" role="alert">
                      {mobileSurfaceOpacityError}
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {assetActionError ? (
          <span className="form-error" role="alert">
            {assetActionError}
          </span>
        ) : null}
```

Important guardrails while applying that snippet:
- Keep every existing `id`, `aria-label`, and `aria-describedby` value unchanged.
- Keep every existing `settings.update` payload unchanged.
- Keep `renderAssetButtons()` behavior unchanged; only move where it renders.
- Do not rename the existing numeric draft states or validation state setters.

- [ ] **Step 4: Run the settings-page tests to verify the regrouped markup passes**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/settings/components/settings-page.test.tsx
```

Expected:
- PASS for the two new structure tests
- PASS for the existing hydration, override, upload, and delete tests

- [ ] **Step 5: Commit the markup regrouping**

```bash
git add \
  packages/web/src/features/settings/components/settings-page.tsx \
  packages/web/src/features/settings/components/settings-page.test.tsx
git commit -m "fix(web): regroup background material settings"
```

---

### Task 2: Add Layered CSS And Theme Assertions

**Files:**
- Modify: `packages/web/src/styles/components.theme.test.ts:2407-2485`
- Modify: `packages/web/src/styles/components.css:996-1405`
- Modify: `packages/web/src/styles/components.css:11960-12017`

- [ ] **Step 1: Write the failing theme assertions for the new appearance surfaces**

Add this test to `packages/web/src/styles/components.theme.test.ts` immediately after `keeps settings content groups and provider controls aligned with editor configuration panels`:

```tsx
  it("keeps background-material settings on layered surfaces with a responsive material grid", () => {
    const hiddenFileInput = getLastRuleBlock(".settings-appearance-file-input");
    const appearancePanel = getLastRuleBlock(".settings-appearance-panel");
    const assetSummaryBase = getRuleBlocksFrom(stylesheet, ".settings-appearance-asset-summary")[0];
    const assetId = getLastRuleBlock(".settings-appearance-asset-id");
    const actionsBase = getRuleBlocksFrom(stylesheet, ".settings-appearance-actions")[0];
    const materialGridBase = getRuleBlocksFrom(stylesheet, ".settings-appearance-material-grid")[0];
    const metricField = getLastRuleBlock(".settings-appearance-metric-field");
    const overridePanel = getLastRuleBlock(".settings-appearance-override-panel");
    const assetSummaryMobile = getLastRuleBlock(".settings-appearance-asset-summary");
    const actionsMobile = getLastRuleBlock(".settings-appearance-actions");
    const materialGridMobile = getLastRuleBlock(".settings-appearance-material-grid");

    expect(hiddenFileInput).toContain("position: absolute");
    expect(hiddenFileInput).toContain("clip-path: inset(50%)");
    expect(appearancePanel).toContain("border: 1px solid");
    expect(appearancePanel).toContain("border-radius: var(--radius-lg)");
    expect(appearancePanel).toContain("background: color-mix");
    expect(assetSummaryBase).toContain("grid-template-columns: minmax(0, 1fr) auto");
    expect(assetId).toContain("font-family: var(--font-mono)");
    expect(actionsBase).toContain("justify-content: flex-end");
    expect(materialGridBase).toContain("display: grid");
    expect(materialGridBase).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(metricField).toContain("margin-bottom: 0");
    expect(metricField).toContain("border-radius: var(--radius-md)");
    expect(overridePanel).toContain("background: color-mix");
    expect(overridePanel).toContain("border: 1px solid");
    expect(assetSummaryMobile).toContain("grid-template-columns: 1fr");
    expect(actionsMobile).toContain("justify-content: flex-start");
    expect(materialGridMobile).toContain("grid-template-columns: 1fr");
  });
```

- [ ] **Step 2: Run the theme test to verify failure**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/styles/components.theme.test.ts
```

Expected:
- FAIL because `.settings-appearance-file-input`, `.settings-appearance-panel`, `.settings-appearance-asset-summary`, `.settings-appearance-material-grid`, and `.settings-appearance-override-panel` rules do not exist yet

- [ ] **Step 3: Add the appearance surface and mobile-collapse rules in `components.css`**

Insert the desktop/base rules near the existing settings layout rules in `packages/web/src/styles/components.css`, directly after `.settings-input-compact`:

```css
.settings-appearance-file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

.settings-appearance-panels {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}

.settings-appearance-panel {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  padding: var(--sp-4);
  border: 1px solid color-mix(in srgb, var(--border) 78%, transparent);
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--bg-input) 72%, var(--bg-surface) 28%);
}

.settings-appearance-panel .settings-config-field:last-child,
.settings-appearance-panel .settings-toggle-row:last-child {
  margin-bottom: 0;
  border-bottom: none;
}

.settings-appearance-panel .settings-config-field {
  margin-bottom: 0;
}

.settings-appearance-asset-summary {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: var(--sp-3);
  padding: var(--sp-3);
  border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--bg-surface) 82%, transparent);
}

.settings-appearance-asset-meta {
  min-width: 0;
}

.settings-appearance-asset-id {
  display: block;
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
}

.settings-appearance-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--sp-2);
}

.settings-appearance-material-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--sp-3);
}

.settings-appearance-metric-field {
  margin-bottom: 0;
  padding: var(--sp-3);
  border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--bg-surface) 78%, transparent);
}

.settings-appearance-metric-field .settings-config-control {
  justify-content: flex-start;
}

.settings-appearance-metric-field .settings-input-compact {
  width: 100%;
  text-align: left;
}

.settings-appearance-overrides {
  display: flex;
  flex-direction: column;
}

.settings-appearance-override-panel {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  margin-top: var(--sp-3);
  padding: var(--sp-3) var(--sp-4);
  border: 1px solid color-mix(in srgb, var(--border) 68%, transparent);
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--bg-surface) 74%, transparent);
}

.settings-appearance-override-panel .settings-config-field:last-child,
.settings-appearance-override-panel .settings-toggle-row:last-child {
  margin-bottom: 0;
  border-bottom: none;
}

.settings-appearance-override-panel .settings-config-field {
  margin-bottom: 0;
}
```

Then add the mobile fallback rules inside the existing mobile settings block near `.settings-content--mobile .settings-content-surface`:

```css
  .settings-appearance-asset-summary {
    grid-template-columns: 1fr;
  }

  .settings-appearance-actions {
    justify-content: flex-start;
  }

  .settings-appearance-material-grid {
    grid-template-columns: 1fr;
  }

  .settings-appearance-metric-field .settings-input-compact {
    text-align: left;
  }
```

Important guardrails while applying those rules:
- Use existing tokens only; do not introduce hard-coded light-only fills.
- Keep the override panel visually weaker than the main appearance surfaces.
- Do not change unrelated settings-group spacing or global form rules.

- [ ] **Step 4: Run the combined settings and theme suites**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/settings/components/settings-page.test.tsx \
  src/styles/components.theme.test.ts
```

Expected:
- PASS for the grouped settings-page tests
- PASS for the new theme assertions
- PASS for the pre-existing settings/theme regressions

- [ ] **Step 5: Commit the CSS and theme coverage**

```bash
git add \
  packages/web/src/styles/components.css \
  packages/web/src/styles/components.theme.test.ts
git commit -m "fix(web): polish background material settings styling"
```
