import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultAppSettings } from '../apps/web/src/shared/app/settings.ts';
import { persistConfirmedAppSettings } from '../apps/web/src/services/http/settings.service.ts';

test('persistConfirmedAppSettings returns the backend-confirmed settings on success', async () => {
  const confirmed = defaultAppSettings();
  const draft = defaultAppSettings();
  draft.general.terminalCompatibilityMode = 'compatibility';

  const saved = await persistConfirmedAppSettings(
    confirmed,
    draft,
    async (settings) => settings,
  );

  assert.equal(saved.general.terminalCompatibilityMode, 'compatibility');
});

test('persistConfirmedAppSettings keeps the last confirmed settings when save fails', async () => {
  const confirmed = defaultAppSettings();
  const draft = defaultAppSettings();
  draft.general.locale = 'zh';
  draft.general.idlePolicy.idleMinutes = 25;

  const saved = await persistConfirmedAppSettings(
    confirmed,
    draft,
    async () => {
      throw new Error('save failed');
    },
  );

  assert.equal(saved.general.locale, confirmed.general.locale);
  assert.equal(saved.general.idlePolicy.idleMinutes, confirmed.general.idlePolicy.idleMinutes);
});
