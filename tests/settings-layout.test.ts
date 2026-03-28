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
  const claudeSource = await fs.readFile(
    new URL('../apps/web/src/components/Settings/ClaudeSettingsPanel.tsx', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(settingsSource, /settings-section-heading/);
  assert.doesNotMatch(claudeSource, /settings-section-heading/);
  assert.doesNotMatch(claudeSource, /claude-settings-hero/);
  assert.doesNotMatch(settingsSource, /settings-summary/);
  assert.doesNotMatch(settingsSource, /settings-group-label/);
  assert.doesNotMatch(claudeSource, /settings-group-label/);
});

test('claude settings use dedicated inline select rows for enum fields', async () => {
  const claudeSource = await fs.readFile(
    new URL('../apps/web/src/components/Settings/ClaudeSettingsPanel.tsx', import.meta.url),
    'utf8',
  );

  assert.match(claudeSource, /claude-select-row/);
  assert.match(claudeSource, /ClaudeSelectField/);
  assert.doesNotMatch(claudeSource, /meta=\{t\("claudePermissionModeMeta"\)\}/);
  assert.doesNotMatch(claudeSource, /meta=\{t\("claudeEffortMeta"\)\}/);
  assert.doesNotMatch(claudeSource, /meta=\{t\("claudeEditorModeMeta"\)\}/);
});

test('claude secret fields expose a reveal toggle', async () => {
  const claudeSource = await fs.readFile(
    new URL('../apps/web/src/components/Settings/ClaudeSettingsPanel.tsx', import.meta.url),
    'utf8',
  );

  assert.match(claudeSource, /allowSecretReveal/);
  assert.match(claudeSource, /claude-api-key-input/);
  assert.match(claudeSource, /claude-auth-token-input/);
  assert.match(claudeSource, /visibility-toggle/);
});
