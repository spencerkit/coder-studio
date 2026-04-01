import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('settings page declares the flat document shell structure classes', async () => {
  const source = await fs.readFile(
    new URL('../apps/web/src/components/Settings/Settings.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /settings-document-shell/);
  assert.match(source, /settings-section-stack/);
});

test('settings cards avoid large per-card header blocks', async () => {
  const settingsSource = await fs.readFile(
    new URL('../apps/web/src/components/Settings/Settings.tsx', import.meta.url),
    'utf8',
  );
  const providerSource = await fs.readFile(
    new URL('../apps/web/src/components/Settings/ProviderSettingsPanel.tsx', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(settingsSource, /settings-section-heading/);
  assert.doesNotMatch(providerSource, /settings-section-heading/);
  assert.doesNotMatch(providerSource, /claude-settings-hero/);
  assert.doesNotMatch(settingsSource, /settings-summary/);
  assert.doesNotMatch(settingsSource, /settings-group-label/);
  assert.doesNotMatch(providerSource, /settings-group-label/);
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
