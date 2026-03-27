import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultAppSettings } from '../apps/web/src/shared/app/settings.ts';
import {
  hydrateConfirmedAppSettings,
  persistConfirmedAppSettings,
} from '../apps/web/src/services/http/settings.service.ts';

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

test('hydrateConfirmedAppSettings keeps confirmed backend settings when legacy migration save fails', async () => {
  const confirmed = defaultAppSettings();
  confirmed.general.locale = 'en';
  const legacy = defaultAppSettings();
  legacy.general.locale = 'zh';

  const hydrated = await hydrateConfirmedAppSettings({
    fallbackSettings: defaultAppSettings(),
    legacySettings: legacy,
    preferredLocale: 'zh',
    load: async () => confirmed,
    persist: async () => {
      throw new Error('save failed');
    },
  });

  assert.equal(hydrated.settings.general.locale, 'en');
  assert.equal(hydrated.clearLegacyStorage, false);
});

test('hydrateConfirmedAppSettings ignores legacy local settings when backend hydrate fails', async () => {
  const legacy = defaultAppSettings();
  legacy.general.locale = 'zh';
  legacy.general.idlePolicy.idleMinutes = 25;

  const hydrated = await hydrateConfirmedAppSettings({
    fallbackSettings: defaultAppSettings(),
    legacySettings: legacy,
    preferredLocale: 'zh',
    load: async () => {
      throw new Error('backend unavailable');
    },
  });

  assert.equal(hydrated.settings.general.locale, 'en');
  assert.equal(hydrated.settings.general.idlePolicy.idleMinutes, 10);
  assert.equal(hydrated.clearLegacyStorage, false);
});
