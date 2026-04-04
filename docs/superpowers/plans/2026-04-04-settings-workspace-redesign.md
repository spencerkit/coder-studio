# Settings Workspace Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Settings page into a sectioned runtime configuration workspace with a shared panel header, clearer section hierarchy, and provider forms that feel like runtime configuration instead of a flat admin form.

**Architecture:** Keep `Settings.tsx` and `ProviderSettingsPanel.tsx` as the main render entry points, but reorganize them around a shared page-header plus section-slab shell. Use provider manifest metadata plus localized copy to drive the header content, preserve the existing settings update/draft behavior, and do the visual lift mostly through class-based CSS in `app.css`.

**Tech Stack:** React 19 + TypeScript, shared app i18n in `apps/web/src/i18n.ts`, manifest-driven provider settings, class-based CSS in `apps/web/src/styles/app.css`, `node:test` source assertions, Playwright e2e.

---

## File Map

**Modify:**

- `apps/web/src/components/Settings/Settings.tsx`
  - Add panel metadata resolution, shared panel header markup, and section-slab wrappers for General and Appearance.
- `apps/web/src/components/Settings/ProviderSettingsPanel.tsx`
  - Add runtime summary slab, manifest-section slab markup, multiline row variants, and new test ids without changing draft/error behavior.
- `apps/web/src/features/providers/types.ts`
  - Extend `ProviderManifest` with localized presentation metadata needed by the shared header.
- `apps/web/src/features/providers/manifests/claude.ts`
  - Provide the provider header hint key for Claude.
- `apps/web/src/features/providers/manifests/codex.ts`
  - Provide the provider header hint key for Codex.
- `apps/web/src/i18n.ts`
  - Add shared Settings workspace copy for panel kickers, appearance intro text, and runtime summary title.
- `apps/web/src/styles/app.css`
  - Replace the flat settings shell styling with the sectioned workspace shell, panel header, section slab, control rhythm, and responsive adjustments.
- `tests/settings-layout.test.ts`
  - Update source assertions from the old flat-shell rules to the new header/section/summary structure.
- `tests/e2e/e2e.spec.ts`
  - Extend the existing settings persistence test so it asserts the new provider header and summary structure while preserving the existing form-persistence checks.

**Do not modify:**

- `apps/web/src/shared/app/provider-settings.ts`
  - Persistence and patch semantics stay unchanged.
- `apps/web/src/features/settings/SettingsScreen.tsx`
  - The screen-level wiring stays the same unless a compile fix is required.

## Task 1: Add the Shared Settings Panel Shell

**Files:**

- Modify: `tests/settings-layout.test.ts`
- Modify: `apps/web/src/features/providers/types.ts`
- Modify: `apps/web/src/features/providers/manifests/claude.ts`
- Modify: `apps/web/src/features/providers/manifests/codex.ts`
- Modify: `apps/web/src/i18n.ts`
- Modify: `apps/web/src/components/Settings/Settings.tsx`

- [ ] **Step 1: Rewrite the flat-shell source assertions so they expect the new panel header structure**

Edit `tests/settings-layout.test.ts` so the first settings-structure test becomes:

```ts
test('settings page declares the workspace panel header and section slab structure', async () => {
  const source = await fs.readFile(
    new URL('../apps/web/src/components/Settings/Settings.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /settings-document-shell/);
  assert.match(source, /settings-panel-header/);
  assert.match(source, /settings-panel-kicker/);
  assert.match(source, /settings-panel-title/);
  assert.match(source, /settings-panel-intro/);
  assert.match(source, /settings-section-slab/);
  assert.match(source, /settings-section-header/);
});
```

Replace the old anti-pattern test that banned headings/summaries with a positive assertion:

```ts
test('settings page groups general and appearance content into named sections', async () => {
  const source = await fs.readFile(
    new URL('../apps/web/src/components/Settings/Settings.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /agentDefaults/);
  assert.match(source, /suspendStrategy/);
  assert.match(source, /completionNotifications/);
  assert.match(source, /settings-panel-summary/);
});
```

- [ ] **Step 2: Run the focused source test and verify it fails before implementation**

Run:

```bash
node --test tests/settings-layout.test.ts
```

Expected: FAIL with a missing match such as `/settings-panel-header/` or `/settings-panel-summary/` because `Settings.tsx` still renders the flat shell.

- [ ] **Step 3: Add shared panel metadata and header markup in `Settings.tsx`, and extend provider manifests with a localized hint key**

Update `apps/web/src/features/providers/types.ts`:

```ts
export type ProviderManifest = {
  id: ProviderId;
  label: string;
  badgeLabel: string;
  description: string;
  settingsTitleKey: string;
  settingsHintKey: string;
  settingsSections: readonly ProviderSettingsSection[];
};
```

Set the new manifest key in both provider manifests:

```ts
// apps/web/src/features/providers/manifests/claude.ts
settingsTitleKey: "claudeSettingsTitle",
settingsHintKey: "claudeSettingsHint",
```

```ts
// apps/web/src/features/providers/manifests/codex.ts
settingsTitleKey: "codexSettingsTitle",
settingsHintKey: "codexSettingsHint",
```

Add the shared Settings copy in `apps/web/src/i18n.ts`:

```ts
// en
settingsGeneralKicker: "Workspace Defaults",
settingsProviderKicker: "Runtime",
settingsAppearanceKicker: "Interface",
settingsAppearanceHint: "Tune terminal rendering and language defaults for this machine.",
settingsRuntimeSummaryTitle: "Runtime summary",
```

```ts
// zh
settingsGeneralKicker: "工作区默认值",
settingsProviderKicker: "运行时",
settingsAppearanceKicker: "界面",
settingsAppearanceHint: "调整这台机器上的终端渲染和语言默认值。",
settingsRuntimeSummaryTitle: "运行时概览",
```

Refactor `apps/web/src/components/Settings/Settings.tsx` around a local section helper and panel metadata resolver:

```tsx
import type { ReactNode } from "react";

type SettingsSectionProps = {
  kicker: string;
  title: string;
  description?: string;
  testId?: string;
  children: ReactNode;
};

const SettingsSection = ({ kicker, title, description, testId, children }: SettingsSectionProps) => (
  <section className="settings-section-slab" data-testid={testId}>
    <header className="settings-section-header">
      <span className="settings-section-kicker">{kicker}</span>
      <div className="settings-section-copy">
        <h2 className="settings-section-title">{title}</h2>
        {description ? <p className="settings-section-description">{description}</p> : null}
      </div>
    </header>
    <div className="settings-section-body">
      {children}
    </div>
  </section>
);
```

```tsx
const resolvePanelMeta = (
  activeSettingsPanel: SettingsPanel,
  activeProviderId: string | null,
  t: Translator,
) => {
  if (activeSettingsPanel === "general") {
    return {
      kicker: t("settingsGeneralKicker"),
      title: t("settingsGeneral"),
      description: t("settingsDescription"),
    };
  }

  if (activeSettingsPanel === "appearance") {
    return {
      kicker: t("settingsAppearanceKicker"),
      title: t("settingsAppearance"),
      description: t("settingsAppearanceHint"),
    };
  }

  const providerId = activeProviderId ?? "";
  const manifest = BUILTIN_PROVIDER_MANIFESTS.find((entry) => entry.id === providerId);

  return {
    kicker: t("settingsProviderKicker"),
    title: manifest ? t(manifest.settingsTitleKey) : providerId,
    description: manifest ? t(manifest.settingsHintKey) : t("providerUnknownHint", { provider: providerId }),
    summary: manifest ? manifest.badgeLabel : providerId,
  };
};
```

Render the new header ahead of the panel body:

```tsx
const panelMeta = resolvePanelMeta(activeSettingsPanel, activeProviderId, t);

<div className="settings-panel-header" data-testid="settings-panel-header">
  <span className="settings-panel-kicker" data-testid="settings-panel-kicker">
    {panelMeta.kicker}
  </span>
  <div className="settings-panel-heading">
    <h1 className="settings-panel-title" data-testid="settings-panel-title">
      {panelMeta.title}
    </h1>
    <p className="settings-panel-intro" data-testid="settings-panel-intro">
      {panelMeta.description}
    </p>
  </div>
  {panelMeta.summary ? (
    <div className="settings-panel-summary" data-testid="settings-panel-summary">
      <span className="settings-panel-summary-badge">{panelMeta.summary}</span>
      <span className="settings-panel-summary-copy">{t("changesAffectNextLaunch")}</span>
    </div>
  ) : null}
</div>
```

Wrap the existing General and Appearance rows into named section slabs instead of bare `settings-group-card` blocks. Keep the existing controls and test ids intact, but move the rows into these exact wrappers:

```tsx
<div className="settings-panel-body">
  <div className="settings-section-stack">
    <SettingsSection
      kicker={t("settingsGeneralKicker")}
      title={t("agentDefaults")}
      description={t("agentDefaultsHint")}
      testId="settings-section-agent-defaults"
    >
      <div className="settings-row">
        <div className="settings-row-copy">
          <strong>{t("defaultProvider")}</strong>
          <span>{t("defaultProviderHint")}</span>
        </div>
        <div className="settings-row-control">
          <div className="settings-pill-select">
            {BUILTIN_PROVIDER_MANIFESTS.map((manifest) => (
              <button
                key={manifest.id}
                type="button"
                className={`settings-pill-option ${settingsDraft.agentDefaults.provider === manifest.id ? "active" : ""}`}
                onClick={() => onAgentDefaultsChange({ provider: manifest.id })}
                data-testid={`settings-default-provider-${manifest.id}`}
              >
                {manifest.badgeLabel}
              </button>
            ))}
          </div>
        </div>
      </div>
    </SettingsSection>
  </div>
</div>
```

Add a second `SettingsSection` with:

- `kicker={t("settingsGeneralKicker")}`
- `title={t("suspendStrategy")}`
- `description={t("suspendStrategyHint")}`
- `testId="settings-section-suspend-strategy"`

Inside that section, move the current `autoSuspend`, `idleAfter`, `maxActive`, and `memoryPressure` rows in their existing order without changing their inner controls or test ids.

Add a third `SettingsSection` with:

- `kicker={t("settingsGeneralKicker")}`
- `title={t("completionNotifications")}`
- `description={t("completionNotificationsHint")}`
- `testId="settings-section-notifications"`

Inside that section, move the current `completionNotifications`, `notifyOnlyInBackground`, and `notificationPermission` rows in their existing order without changing their inner controls or test ids.

- [ ] **Step 4: Run the focused source test again and verify the new shell structure passes**

Run:

```bash
node --test tests/settings-layout.test.ts
```

Expected: PASS for the updated Settings shell assertions; provider-specific tests may still fail until Task 2 lands.

- [ ] **Step 5: Commit the shared shell changes**

Run:

```bash
git add tests/settings-layout.test.ts apps/web/src/features/providers/types.ts apps/web/src/features/providers/manifests/claude.ts apps/web/src/features/providers/manifests/codex.ts apps/web/src/i18n.ts apps/web/src/components/Settings/Settings.tsx
git commit -m "feat: add settings workspace shell"
```

## Task 2: Rebuild the Provider Panel as a Sectioned Runtime Workspace

**Files:**

- Modify: `tests/settings-layout.test.ts`
- Modify: `tests/e2e/e2e.spec.ts`
- Modify: `apps/web/src/components/Settings/ProviderSettingsPanel.tsx`

- [ ] **Step 1: Add failing source assertions for the provider runtime summary and section slabs**

Append this test to `tests/settings-layout.test.ts`:

```ts
test('provider settings panel exposes runtime summary, section slabs, and multiline row variants', async () => {
  const providerSource = await fs.readFile(
    new URL('../apps/web/src/components/Settings/ProviderSettingsPanel.tsx', import.meta.url),
    'utf8',
  );

  assert.match(providerSource, /provider-settings-summary/);
  assert.match(providerSource, /provider-settings-section-/);
  assert.match(providerSource, /settings-section-header/);
  assert.match(providerSource, /settings-row--multiline/);
  assert.match(providerSource, /provider-settings-textarea/);
});
```

- [ ] **Step 2: Extend the existing Playwright settings-persistence test so it expects the new provider workspace markers**

Edit `tests/e2e/e2e.spec.ts` inside `test('claude settings persist across route changes and reloads'...)`:

```ts
await page.getByTestId('settings-nav-claude').click();
await expect(page.getByTestId('settings-panel-header')).toBeVisible();
await expect(page.getByTestId('settings-panel-title')).toContainText('Claude');
await expect(page.getByTestId('provider-settings-summary')).toBeVisible();
await expect(page.getByTestId('provider-settings-section-startup')).toBeVisible();
await expect(page.getByTestId('provider-settings-section-launch-auth')).toBeVisible();
```

After reload, assert the same structure again before the field value checks:

```ts
await page.getByTestId('settings-nav-claude').click();
await expect(page.getByTestId('provider-settings-summary')).toBeVisible();
await expect(page.getByTestId('provider-settings-section-startup')).toBeVisible();
await expect(page.getByTestId('provider-settings-section-launch-auth')).toBeVisible();
```

- [ ] **Step 3: Run the focused source test and focused e2e test to verify both fail before implementation**

Run:

```bash
node --test tests/settings-layout.test.ts
```

Expected: FAIL on `/provider-settings-summary/` or `/settings-row--multiline/`.

Run:

```bash
pnpm exec playwright test tests/e2e/e2e.spec.ts -g "claude settings persist across route changes and reloads"
```

Expected: FAIL because the new provider summary or section test ids do not exist yet.

- [ ] **Step 4: Refactor `ProviderSettingsPanel.tsx` into a runtime summary plus manifest-driven section slabs while preserving draft state behavior**

Keep `fieldDrafts`, `fieldErrors`, `commitValue`, and the `[providerId]` reset effect exactly as they are. Add a multiline helper plus a reusable row wrapper:

```tsx
import type { ReactNode } from "react";

const isMultilineField = (field: ProviderSettingsField) => (
  field.kind === "string_list" || field.kind === "env_map" || field.kind === "json"
);

const renderFieldRow = (
  field: ProviderSettingsField,
  hint: string | undefined,
  control: ReactNode,
) => (
  <div className={`settings-row${isMultilineField(field) ? " settings-row--multiline" : ""}`} key={field.id}>
    <FieldCopy label={t(field.labelKey)} hint={hint} />
    <div className="settings-row-control">
      {control}
    </div>
  </div>
);
```

Use `renderFieldRow` in each control branch. For example:

```tsx
if (field.kind === "command" || field.kind === "text") {
  return renderFieldRow(
    field,
    hint,
    <input
      className="settings-command-field"
      type="text"
      value={typeof value === "string" ? value : ""}
      onChange={(event) => commitValue(field.path, event.target.value)}
      placeholder={placeholder}
      data-testid={`provider-settings-${providerId}-${field.id}`}
    />,
  );
}

if (field.kind === "string_list") {
  return renderFieldRow(
    field,
    hint,
    <textarea
      className="settings-command-field provider-settings-textarea"
      rows={5}
      value={fieldDrafts[field.id] ?? listToText(value)}
      onChange={(event) => onTextAreaChange(field, event.target.value, textToList)}
      placeholder={placeholder}
      data-testid={`provider-settings-${providerId}-${field.id}`}
    />,
  );
}
```

Replace the current provider render with a summary slab plus per-section slabs:

```tsx
return (
  <div className="provider-settings-panel">
    <section
      className="settings-section-slab provider-settings-summary"
      data-testid="provider-settings-summary"
    >
      <header className="settings-section-header">
        <span className="settings-section-kicker">{t("settingsProviderKicker")}</span>
        <div className="settings-section-copy">
          <h2 className="settings-section-title">{t("settingsRuntimeSummaryTitle")}</h2>
          <p className="settings-section-description">{t(manifest.settingsHintKey)}</p>
        </div>
      </header>
      <div className="provider-settings-summary-body">
        <span className="provider-settings-summary-badge">{manifest.badgeLabel}</span>
        <p className="provider-settings-summary-note">{t("changesAffectNextLaunch")}</p>
      </div>
    </section>

    {manifest.settingsSections.map((section) => (
      <section
        className="settings-section-slab provider-settings-section"
        key={section.id}
        data-testid={`provider-settings-section-${section.id}`}
      >
        <header className="settings-section-header">
          <span className="settings-section-kicker">{section.id}</span>
          <div className="settings-section-copy">
            <h2 className="settings-section-title">{t(section.titleKey)}</h2>
            {section.descriptionKey ? (
              <p className="settings-section-description">{t(section.descriptionKey)}</p>
            ) : null}
          </div>
        </header>
        <div className="settings-section-body">
          {section.fields.map((field) => renderField(field))}
        </div>
      </section>
    ))}
  </div>
);
```

Render unknown providers through the same section vocabulary:

```tsx
return (
  <div className="provider-settings-panel">
    <section className="settings-section-slab" data-testid="provider-settings-section-unknown">
      <header className="settings-section-header">
        <span className="settings-section-kicker">{t("settingsProviderKicker")}</span>
        <div className="settings-section-copy">
          <h2 className="settings-section-title">{providerId}</h2>
          <p className="settings-section-description">
            {t("providerUnknownHint", { provider: providerId })}
          </p>
        </div>
      </header>
    </section>
  </div>
);
```

- [ ] **Step 5: Run the focused source test again and verify the provider structure assertions pass**

Run:

```bash
node --test tests/settings-layout.test.ts
```

Expected: PASS for the provider summary/section/multiline assertions while keeping the draft-state assertions green.

- [ ] **Step 6: Run the focused e2e test and verify the provider redesign still preserves form behavior**

Run:

```bash
pnpm exec playwright test tests/e2e/e2e.spec.ts -g "claude settings persist across route changes and reloads"
```

Expected: PASS, with the new header and summary assertions green and the existing persisted field assertions still passing.

- [ ] **Step 7: Commit the provider workspace changes**

Run:

```bash
git add tests/settings-layout.test.ts tests/e2e/e2e.spec.ts apps/web/src/components/Settings/ProviderSettingsPanel.tsx
git commit -m "feat: section provider settings workspace"
```

## Task 3: Apply the Sectioned Workspace Visual System in CSS

**Files:**

- Modify: `tests/settings-layout.test.ts`
- Modify: `apps/web/src/styles/app.css`

- [ ] **Step 1: Add failing CSS source assertions for the new panel header, summary slab, and multiline row styles**

Append this test to `tests/settings-layout.test.ts`:

```ts
test('settings styles define the workspace header, section slabs, and multiline provider controls', async () => {
  const stylesSource = await fs.readFile(
    new URL('../apps/web/src/styles/app.css', import.meta.url),
    'utf8',
  );

  assert.match(stylesSource, /\.settings-panel-header/);
  assert.match(stylesSource, /\.settings-panel-summary/);
  assert.match(stylesSource, /\.settings-section-slab/);
  assert.match(stylesSource, /\.settings-section-header/);
  assert.match(stylesSource, /\.settings-row--multiline/);
  assert.match(stylesSource, /\.provider-settings-summary/);
});
```

- [ ] **Step 2: Run the focused source test and verify the CSS assertions fail before styling work**

Run:

```bash
node --test tests/settings-layout.test.ts
```

Expected: FAIL on one of the new CSS selectors because `app.css` still only contains the old flat settings styles.

- [ ] **Step 3: Replace the flat settings styles with the sectioned workspace shell and differentiated form control rhythm**

Edit the settings block in `apps/web/src/styles/app.css` around the existing `.settings-sidebar-v2`, `.settings-content-v2`, `.settings-scroll-panel`, `.settings-row`, and mobile settings overrides.

Add the new workspace shell classes:

```css
.settings-panel-body,
.provider-settings-panel {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.settings-panel-header {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 4px 0 20px;
  border-bottom: 1px solid color-mix(in srgb, var(--border-muted) 74%, transparent);
}

.settings-panel-kicker,
.settings-section-kicker {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-tertiary);
}

.settings-panel-title,
.settings-section-title {
  margin: 0;
  color: var(--text);
}

.settings-panel-title {
  font-size: 18px;
  line-height: 1.2;
}

.settings-panel-intro,
.settings-section-description {
  margin: 0;
  font-size: 12px;
  line-height: 1.65;
  color: var(--text-secondary);
}

.settings-panel-summary,
.settings-section-slab {
  border: 1px solid color-mix(in srgb, var(--border-muted) 82%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--surface-strip) 90%, var(--bg) 10%);
}

.settings-panel-summary {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
}

.settings-panel-summary-badge,
.provider-settings-summary-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
}

.settings-section-slab {
  padding: 18px;
}

.settings-section-header {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 8px;
  padding-bottom: 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--border-muted) 68%, transparent);
}

.settings-section-body {
  display: flex;
  flex-direction: column;
}
```

Tighten the field rhythm and add multiline variants:

```css
.settings-row {
  align-items: flex-start;
  min-height: 0;
  padding: 14px 0;
  gap: 24px;
  border-top: 1px solid color-mix(in srgb, var(--border-muted) 68%, transparent);
}

.settings-row--multiline {
  flex-direction: column;
  gap: 10px;
}

.settings-row--multiline .settings-row-copy,
.settings-row--multiline .settings-row-control {
  width: 100%;
  max-width: none;
}

.settings-row-control {
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  min-width: 260px;
  padding-top: 2px;
}

.settings-command-field,
.settings-content-v2 select,
.settings-content-v2 textarea,
.settings-inline-input,
.settings-inline-number {
  width: min(420px, 100%);
  min-height: 40px;
  padding: 9px 12px;
  border: 1px solid color-mix(in srgb, var(--border-muted) 88%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface-elevated) 84%, var(--bg) 16%);
  box-shadow: inset 0 1px 0 color-mix(in srgb, white 3%, transparent);
}

.provider-settings-textarea {
  width: min(640px, 100%);
  min-height: 120px;
  resize: vertical;
  padding: 12px;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
}

.provider-settings-summary {
  gap: 0;
}

.provider-settings-summary-body {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 12px;
}

.provider-settings-summary-note {
  margin: 0;
  font-size: 12px;
  color: var(--text-secondary);
}
```

Strengthen the nav state without turning it into a dashboard:

```css
.settings-nav-item {
  position: relative;
  min-height: 40px;
  padding: 0 14px;
  border-radius: 6px !important;
  background: transparent;
  color: var(--text-secondary);
}

.settings-nav-item.active {
  color: var(--text);
  background: color-mix(in srgb, var(--surface) 68%, var(--accent) 32%);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 22%, transparent);
}
```

Update the mobile override block so the new shell collapses cleanly:

```css
@media (max-width: 720px) {
  .settings-panel-header {
    gap: 10px;
    padding-bottom: 16px;
  }

  .settings-panel-summary,
  .settings-section-slab {
    padding: 14px;
  }

  .settings-row,
  .settings-row--multiline {
    gap: 10px;
  }

  .settings-command-field,
  .provider-settings-textarea,
  .settings-inline-input,
  .settings-inline-number {
    width: 100%;
  }
}
```

- [ ] **Step 4: Run the focused source test again and verify the new CSS selectors are present**

Run:

```bash
node --test tests/settings-layout.test.ts
```

Expected: PASS for the CSS selector assertions plus the earlier Settings and provider structure assertions.

- [ ] **Step 5: Run the focused e2e test again to confirm the visual refactor did not break interaction**

Run:

```bash
pnpm exec playwright test tests/e2e/e2e.spec.ts -g "claude settings persist across route changes and reloads"
```

Expected: PASS, with the new layout still allowing the same provider form interactions and persisted values.

- [ ] **Step 6: Commit the styling pass**

Run:

```bash
git add tests/settings-layout.test.ts apps/web/src/styles/app.css
git commit -m "style: redesign settings workspace"
```

## Final Verification

- [ ] Run the focused settings source tests one more time:

```bash
node --test tests/settings-layout.test.ts
```

Expected: all Settings structure/style tests PASS.

- [ ] Run the broader web unit suite:

```bash
pnpm test:web:unit
```

Expected: PASS without regressions outside Settings.

- [ ] Run the targeted settings persistence Playwright test:

```bash
pnpm exec playwright test tests/e2e/e2e.spec.ts -g "claude settings persist across route changes and reloads"
```

Expected: PASS with the new header/summary markers and the existing persistence checks.

- [ ] Inspect the working tree before handoff:

```bash
git status --short
```

Expected: only the Settings redesign files from this plan are modified or committed.
