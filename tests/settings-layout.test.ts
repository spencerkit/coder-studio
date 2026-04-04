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
  assert.match(source, /settings-section-slab/);
  assert.match(source, /settings-section-header/);
});

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

test('provider settings panel uses shared settings card and row structure', async () => {
  const providerSource = await fs.readFile(
    new URL('../apps/web/src/components/Settings/ProviderSettingsPanel.tsx', import.meta.url),
    'utf8',
  );

  assert.match(providerSource, /settings-group-card/);
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
  assert.match(providerSource, /settings-group-card--document/);
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

test('provider settings panel only resets draft state when the selected provider changes', async () => {
  const providerSource = await fs.readFile(
    new URL('../apps/web/src/components/Settings/ProviderSettingsPanel.tsx', import.meta.url),
    'utf8',
  );

  assert.match(providerSource, /\}, \[providerId\]\);/);
  assert.doesNotMatch(providerSource, /settings\.providers/);
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
