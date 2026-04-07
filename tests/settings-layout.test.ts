import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

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
  assert.match(source, /settings-panel-summary/);
  assert.match(source, /settings-section-slab/);
  assert.match(source, /settings-section-header/);
  assert.match(source, /settingsProviderSummaryHint/);
});

test('settings page groups general and appearance content into named sections and wires provider hook injection callbacks', async () => {
  const source = await fs.readFile(
    new URL('../apps/web/src/components/Settings/Settings.tsx', import.meta.url),
    'utf8',
  );
  const screenSource = await fs.readFile(
    new URL('../apps/web/src/features/settings/SettingsScreen.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /agentDefaults/);
  assert.match(source, /suspendStrategy/);
  assert.match(source, /completionNotifications/);
  assert.match(source, /settings-section-agent-defaults/);
  assert.match(source, /settings-section-suspend-strategy/);
  assert.match(source, /settings-section-notifications/);
  assert.match(source, /settings-section-appearance/);
  assert.match(source, /onInjectProviderHooks/);
  assert.match(source, /canInjectProviderHooks/);
  assert.match(source, /injectProviderHooksHint/);
  assert.match(source, /<ProviderSettingsPanel[\s\S]*onInjectHooks=\{onInjectProviderHooks\}/);
  assert.match(screenSource, /installProviderHooks/);
  assert.match(screenSource, /if \(!activeWorkspaceProject\) \{/);
  assert.match(screenSource, /throw new Error\(t\("injectHooksWorkspaceRequired"\)\)/);
  assert.doesNotMatch(screenSource, /activeTab\?\.project\?\.path \?\? "\."/);
  assert.doesNotMatch(screenSource, /activeTab\?\.project\?\.target \?\? \{ type: "native" \}/);
});

test('provider settings panel exposes a single hook action section ahead of provider-specific sections', async () => {
  const providerSource = await fs.readFile(
    new URL('../apps/web/src/components/Settings/ProviderSettingsPanel.tsx', import.meta.url),
    'utf8',
  );

  const actionsSectionMatches = providerSource.match(/provider-settings-\$\{providerId\}-actions/g) ?? [];
  const hookRowMatches = providerSource.match(/provider-settings-\$\{providerId\}-hook-actions/g) ?? [];
  const injectButtonMatches = providerSource.match(/provider-settings-\$\{providerId\}-inject-hooks/g) ?? [];
  const sectionLoopIndex = providerSource.indexOf('{manifest.settingsSections.map((section) => (');
  const actionsSectionIndex = providerSource.indexOf('provider-settings-${providerId}-actions');

  assert.equal(actionsSectionMatches.length, 1);
  assert.equal(hookRowMatches.length, 1);
  assert.equal(injectButtonMatches.length, 1);
  assert.ok(actionsSectionIndex >= 0);
  assert.ok(sectionLoopIndex > actionsSectionIndex);
});

test('provider settings panel supports disabling hook injection with an explicit unavailable hint', async () => {
  const providerSource = await fs.readFile(
    new URL('../apps/web/src/components/Settings/ProviderSettingsPanel.tsx', import.meta.url),
    'utf8',
  );

  assert.match(providerSource, /canInjectHooks\?: boolean/);
  assert.match(providerSource, /injectHooksHint\?: string/);
  assert.match(providerSource, /disabled=\{injectState === "loading" \|\| !canInjectHooks\}/);
  assert.match(providerSource, /injectHooksHint \?\? t\("injectHooksHint"\)/);
});

test('provider settings panel uses shared section and row structure', async () => {
  const providerSource = await fs.readFile(
    new URL('../apps/web/src/components/Settings/ProviderSettingsPanel.tsx', import.meta.url),
    'utf8',
  );

  assert.match(providerSource, /provider-settings-panel/);
  assert.match(providerSource, /settings-section-slab/);
  assert.match(providerSource, /settings-row-copy/);
  assert.match(providerSource, /settings-row-control/);
  assert.match(providerSource, /settings-command-field/);
  assert.match(providerSource, /provider-settings-textarea/);
  assert.doesNotMatch(providerSource, /claude-textarea/);
});

test('provider settings panel includes unknown provider fallback copy', async () => {
  const providerSource = await fs.readFile(
    new URL('../apps/web/src/components/Settings/ProviderSettingsPanel.tsx', import.meta.url),
    'utf8',
  );

  assert.match(providerSource, /providerUnknownHint/);
  assert.match(providerSource, /provider-settings-section-unknown/);
  assert.match(providerSource, /settings-section-header/);
});

test('provider settings panel keeps multiline field draft state instead of reformatting on every keystroke', async () => {
  const providerSource = await fs.readFile(
    new URL('../apps/web/src/components/Settings/ProviderSettingsPanel.tsx', import.meta.url),
    'utf8',
  );

  assert.match(providerSource, /fieldDrafts/);
  assert.match(providerSource, /value=\{fieldDrafts\[field\.id\] \?\? listToText\(value\)\}/);
  assert.match(providerSource, /value=\{fieldDrafts\[field\.id\] \?\? envMapToText\(value\)\}/);
});

test('provider settings panel exposes runtime summary, section slabs, multiline rows, and hook injection action selectors', async () => {
  const providerSource = await fs.readFile(
    new URL('../apps/web/src/components/Settings/ProviderSettingsPanel.tsx', import.meta.url),
    'utf8',
  );

  assert.match(providerSource, /provider-settings-summary/);
  assert.match(providerSource, /provider-settings-section-/);
  assert.match(providerSource, /settings-section-header/);
  assert.match(providerSource, /settings-row--multiline/);
  assert.match(providerSource, /provider-settings-textarea/);
  assert.match(providerSource, /provider-settings-\$\{providerId\}-hook-actions/);
  assert.match(providerSource, /provider-settings-\$\{providerId\}-inject-hooks/);
  assert.match(providerSource, /injectHooks/);
  assert.match(providerSource, /injectingHooks/);
  assert.match(providerSource, /injectHooksSuccess/);
});

test('provider settings panel resets injection feedback when the workspace-scoped injection context changes', async () => {
  const providerSource = await fs.readFile(
    new URL('../apps/web/src/components/Settings/ProviderSettingsPanel.tsx', import.meta.url),
    'utf8',
  );
  const settingsSource = await fs.readFile(
    new URL('../apps/web/src/components/Settings/Settings.tsx', import.meta.url),
    'utf8',
  );
  const screenSource = await fs.readFile(
    new URL('../apps/web/src/features/settings/SettingsScreen.tsx', import.meta.url),
    'utf8',
  );

  assert.match(settingsSource, /injectionContextKey=/);
  assert.match(screenSource, /const providerInjectionContextKey = \[/);
  assert.match(screenSource, /activeWorkspaceProject\?\.path \?\? "no-workspace"/);
  assert.match(screenSource, /activeWorkspaceProject\?\.target\.type \?\? "native"/);
  assert.match(screenSource, /activeWorkspaceProject\?\.target\.type === "wsl" \? \(activeWorkspaceProject\?\.target\.distro \?\? ""\) : ""/);
  assert.match(providerSource, /injectionContextKey: string;/);
  assert.match(providerSource, /\}, \[providerId, injectionContextKey\]\);/);
});

test('provider settings panel ignores stale async injection completions after the context changes', async () => {
  const providerSource = await fs.readFile(
    new URL('../apps/web/src/components/Settings/ProviderSettingsPanel.tsx', import.meta.url),
    'utf8',
  );

  assert.match(providerSource, /useRef/);
  assert.match(providerSource, /const latestInjectionContextKeyRef = useRef\(injectionContextKey\);/);
  assert.match(providerSource, /latestInjectionContextKeyRef\.current = injectionContextKey;/);
  assert.match(providerSource, /const requestContextKey = latestInjectionContextKeyRef\.current;/);
  assert.match(providerSource, /if \(latestInjectionContextKeyRef\.current !== requestContextKey\) \{/);
  assert.match(providerSource, /return;/);
});

test('generic settings styles no longer keep Claude-named textarea residue', async () => {
  const stylesSource = await fs.readFile(
    new URL('../apps/web/src/styles/app.css', import.meta.url),
    'utf8',
  );

  assert.match(stylesSource, /\.provider-settings-textarea/);
  assert.doesNotMatch(stylesSource, /\.claude-textarea/);
  assert.doesNotMatch(stylesSource, /\.claude-json-editor/);
  assert.doesNotMatch(stylesSource, /\.claude-settings-panel/);
});

test('settings shell styles define baseline panel and section selectors', async () => {
  const stylesSource = await fs.readFile(
    new URL('../apps/web/src/styles/app.css', import.meta.url),
    'utf8',
  );

  assert.match(stylesSource, /\.settings-panel-header\b/);
  assert.match(stylesSource, /\.settings-panel-kicker\b/);
  assert.match(stylesSource, /\.settings-panel-title\b/);
  assert.match(stylesSource, /\.settings-panel-intro\b/);
  assert.match(stylesSource, /\.settings-panel-summary\b/);
  assert.match(stylesSource, /\.settings-section-slab\b/);
  assert.match(stylesSource, /\.settings-section-header\b/);
  assert.match(stylesSource, /\.settings-section-kicker\b/);
  assert.match(stylesSource, /\.settings-section-title\b/);
  assert.match(stylesSource, /\.settings-section-description\b/);
  assert.match(stylesSource, /\.settings-section-body\b/);
});

test('settings shell styles define the final workspace visual selectors', async () => {
  const stylesSource = await fs.readFile(
    new URL('../apps/web/src/styles/app.css', import.meta.url),
    'utf8',
  );

  assert.match(stylesSource, /\.provider-settings-summary\b/);
  assert.match(stylesSource, /\.provider-settings-section\b/);
  assert.match(stylesSource, /\.settings-panel-heading\b/);
  assert.match(stylesSource, /\.settings-section-copy\b/);
  assert.match(stylesSource, /\.settings-row--multiline\s+\.settings-row-copy\b/);
  assert.match(stylesSource, /\.settings-row--multiline\s+\.settings-command-field\b/);
});

test('settings shell compact path keeps the new surface treatment and excludes unrelated session dot styles', async () => {
  const stylesSource = await fs.readFile(
    new URL('../apps/web/src/styles/app.css', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(stylesSource, /\.settings-route\[data-density="compact"\]\s+\.settings-sidebar-v2\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--surface-strip\) 92%, var\(--bg\) 8%\);/);
  assert.doesNotMatch(stylesSource, /\.settings-route\[data-density="compact"\]\s+\.settings-content-v2\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--bg\) 96%, var\(--surface\) 4%\);/);
  assert.doesNotMatch(stylesSource, /\.session-top-dot\.interrupted\b/);
  assert.doesNotMatch(stylesSource, /\.session-top-dot\.archived\b/);
});

test('settings shell scopes compact nav state and tablet multiline stacking rules', async () => {
  const stylesSource = await fs.readFile(
    new URL('../apps/web/src/styles/app.css', import.meta.url),
    'utf8',
  );

  assert.match(stylesSource, /\.settings-route\[data-density="compact"\]\s+\.settings-nav-item\.active\b/);
  assert.match(stylesSource, /@media\s*\(max-width:\s*960px\)\s*\{[\s\S]*?\.settings-row--multiline\s*\{[\s\S]*?flex-direction:\s*column;/);
});

test('settings footer exposes build version and published time metadata', async () => {
  const settingsSource = await fs.readFile(
    new URL('../apps/web/src/components/Settings/Settings.tsx', import.meta.url),
    'utf8',
  );

  assert.match(settingsSource, /settings-page-meta/);
  assert.match(settingsSource, /settings-build-version/);
  assert.match(settingsSource, /settings-build-published-at/);
  assert.match(settingsSource, /buildVersionLabel/);
  assert.match(settingsSource, /buildPublishedLabel/);
});
