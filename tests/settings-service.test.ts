import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultAppSettings } from '../apps/web/src/shared/app/settings.ts';
import {
  createAppSettingsDraftStore,
  createSequencedAppSettingsSaver,
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

test('createAppSettingsDraftStore composes new saves from the latest in-memory draft', () => {
  const store = createAppSettingsDraftStore(defaultAppSettings());

  const localeDraft = store.update((draft) => {
    draft.general.locale = 'zh';
  });
  const mixedDraft = store.update((draft) => {
    draft.general.idlePolicy.idleMinutes = 25;
  });

  assert.equal(localeDraft.general.locale, 'zh');
  assert.equal(mixedDraft.general.locale, 'zh');
  assert.equal(mixedDraft.general.idlePolicy.idleMinutes, 25);
});

test('createSequencedAppSettingsSaver ignores stale save responses', async () => {
  const saver = createSequencedAppSettingsSaver();
  const confirmed = defaultAppSettings();
  const firstDraft = defaultAppSettings();
  const secondDraft = defaultAppSettings();
  firstDraft.general.locale = 'zh';
  secondDraft.general.idlePolicy.idleMinutes = 25;

  let resolveFirst: ((settings: typeof firstDraft) => void) | undefined;
  let resolveSecond: ((settings: typeof secondDraft) => void) | undefined;
  const firstPersist = new Promise<typeof firstDraft>((resolve) => {
    resolveFirst = resolve;
  });
  const secondPersist = new Promise<typeof secondDraft>((resolve) => {
    resolveSecond = resolve;
  });

  const firstSave = saver.save(
    confirmed,
    firstDraft,
    async () => firstPersist,
  );
  const secondSave = saver.save(
    confirmed,
    secondDraft,
    async () => secondPersist,
  );

  resolveSecond?.(secondDraft);
  const secondResult = await secondSave;
  assert.equal(secondResult.shouldApply, true);
  assert.equal(secondResult.settings.general.idlePolicy.idleMinutes, 25);

  resolveFirst?.(firstDraft);
  const firstResult = await firstSave;
  assert.equal(firstResult.shouldApply, false);
});

test('createSequencedAppSettingsSaver applies the latest confirmed save after a newer request fails', async () => {
  const saver = createSequencedAppSettingsSaver();
  const confirmed = defaultAppSettings();
  const firstDraft = defaultAppSettings();
  const secondDraft = defaultAppSettings();
  firstDraft.general.locale = 'zh';
  secondDraft.general.idlePolicy.idleMinutes = 25;

  let resolveFirst: ((settings: typeof firstDraft) => void) | undefined;
  let rejectSecond: ((error: Error) => void) | undefined;
  const firstPersist = new Promise<typeof firstDraft>((resolve) => {
    resolveFirst = resolve;
  });
  const secondPersist = new Promise<typeof secondDraft>((_, reject) => {
    rejectSecond = reject;
  });

  const firstSave = saver.save(
    confirmed,
    firstDraft,
    async () => firstPersist,
  );
  const secondSave = saver.save(
    confirmed,
    secondDraft,
    async () => secondPersist,
  );

  resolveFirst?.(firstDraft);
  const firstResult = await firstSave;
  assert.equal(firstResult.shouldApply, false);

  rejectSecond?.(new Error('save failed'));
  const secondResult = await secondSave;
  assert.equal(secondResult.shouldApply, true);
  assert.equal(secondResult.settings.general.locale, 'zh');
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
  assert.equal(hydrated.backendConfirmed, true);
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
  assert.equal(hydrated.backendConfirmed, false);
  assert.equal(hydrated.clearLegacyStorage, false);
});
