import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultAppSettings } from '../apps/web/src/shared/app/settings';
import {
  applyGeneralSettingsPatch,
  forceClaudeExecutableDefaults,
  patchClaudeStructuredSettings,
} from '../apps/web/src/shared/app/claude-settings';
import {
  applyAppSettingsUpdater,
  createAppSettingsDraftStore,
  createPersistableAppSettings,
  createSequencedAppSettingsSaver,
  deriveRuntimeAppSettings,
  hydrateConfirmedAppSettings,
  persistConfirmedAppSettings,
} from '../apps/web/src/services/http/settings.service';

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

test('applyAppSettingsUpdater preserves consecutive general changes created from stale UI snapshots', () => {
  const store = createAppSettingsDraftStore(defaultAppSettings());

  const disableCompletionNotifications = (current: ReturnType<typeof defaultAppSettings>) => (
    applyGeneralSettingsPatch(current, {
      completionNotifications: {
        enabled: false,
      },
    })
  );
  const disableBackgroundOnlyNotifications = (current: ReturnType<typeof defaultAppSettings>) => (
    applyGeneralSettingsPatch(current, {
      completionNotifications: {
        onlyWhenBackground: false,
      },
    })
  );

  applyAppSettingsUpdater(store, disableCompletionNotifications);
  const updated = applyAppSettingsUpdater(store, disableBackgroundOnlyNotifications);

  assert.equal(updated.general.completionNotifications.enabled, false);
  assert.equal(updated.general.completionNotifications.onlyWhenBackground, false);
});

test('applyAppSettingsUpdater preserves general changes when a later claude update is committed', () => {
  const store = createAppSettingsDraftStore(defaultAppSettings());

  applyAppSettingsUpdater(store, (current) => applyGeneralSettingsPatch(current, {
    idlePolicy: {
      maxActive: 5,
    },
  }));
  const updated = applyAppSettingsUpdater(store, (current) => (
    patchClaudeStructuredSettings(forceClaudeExecutableDefaults(current), {
      startupArgs: ['--verbose', '--debug'],
    })
  ));

  assert.equal(updated.general.idlePolicy.maxActive, 5);
  assert.deepEqual(updated.claude.global.startupArgs, ['--verbose', '--debug']);
});

test('createPersistableAppSettings keeps the confirmed locale when the preference is implicit', () => {
  const confirmed = defaultAppSettings();
  const draft = defaultAppSettings();
  draft.general.locale = 'zh';
  draft.general.idlePolicy.idleMinutes = 25;

  const persisted = createPersistableAppSettings(draft, confirmed, false);

  assert.equal(persisted.general.locale, confirmed.general.locale);
  assert.equal(persisted.general.idlePolicy.idleMinutes, 25);
});

test('deriveRuntimeAppSettings uses the system locale when the preference is implicit', () => {
  const confirmed = defaultAppSettings();
  const runtime = deriveRuntimeAppSettings({
    settings: confirmed,
    localeExplicit: false,
    systemLocale: 'zh',
  });

  assert.equal(runtime.general.locale, 'zh');
});

test('deriveRuntimeAppSettings prefers the stored explicit locale over backend locale', () => {
  const confirmed = defaultAppSettings();
  const runtime = deriveRuntimeAppSettings({
    settings: confirmed,
    localeExplicit: true,
    systemLocale: 'zh',
    explicitLocale: 'zh',
  });

  assert.equal(runtime.general.locale, 'zh');
});

test('createSequencedAppSettingsSaver defers applying an earlier save while a newer save is pending', async () => {
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

  resolveFirst?.(firstDraft);
  const firstResult = await firstSave;
  assert.equal(firstResult.shouldApply, false);

  resolveSecond?.(secondDraft);
  const secondResult = await secondSave;
  assert.equal(secondResult.shouldApply, true);
  assert.equal(secondResult.settings.general.idlePolicy.idleMinutes, 25);
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

test('createSequencedAppSettingsSaver serializes backend saves to preserve request order', async () => {
  const saver = createSequencedAppSettingsSaver();
  const confirmed = defaultAppSettings();
  const firstDraft = defaultAppSettings();
  const secondDraft = defaultAppSettings();
  firstDraft.general.locale = 'zh';
  secondDraft.general.idlePolicy.idleMinutes = 25;

  const started: number[] = [];
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
    async () => {
      started.push(1);
      return firstPersist;
    },
  );
  const secondSave = saver.save(
    confirmed,
    secondDraft,
    async () => {
      started.push(2);
      return secondPersist;
    },
  );

  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(started, [1]);

  resolveFirst?.(firstDraft);
  const firstResult = await firstSave;
  assert.equal(firstResult.shouldApply, false);

  await Promise.resolve();
  assert.deepEqual(started, [1, 2]);

  resolveSecond?.(secondDraft);
  const secondResult = await secondSave;
  assert.equal(secondResult.shouldApply, true);
  assert.equal(secondResult.settings.general.idlePolicy.idleMinutes, 25);
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

test('hydrateConfirmedAppSettings keeps system locale implicit when backend locale is still default', async () => {
  const confirmed = defaultAppSettings();
  let persistCalls = 0;

  const hydrated = await hydrateConfirmedAppSettings({
    fallbackSettings: defaultAppSettings(),
    legacySettings: null,
    preferredLocale: 'zh',
    preferredLocaleIsExplicit: false,
    load: async () => confirmed,
    persist: async (settings) => {
      persistCalls += 1;
      return settings;
    },
  });

  assert.equal(hydrated.settings.general.locale, 'en');
  assert.equal(persistCalls, 0);
  assert.equal(hydrated.localeExplicit, false);
});

test('hydrateConfirmedAppSettings syncs an explicit locale preference when backend locale is still default', async () => {
  const confirmed = defaultAppSettings();
  let persistedLocale: string | null = null;

  const hydrated = await hydrateConfirmedAppSettings({
    fallbackSettings: defaultAppSettings(),
    legacySettings: null,
    preferredLocale: 'zh',
    preferredLocaleIsExplicit: true,
    load: async () => confirmed,
    persist: async (settings) => {
      persistedLocale = settings.general.locale;
      return settings;
    },
  });

  assert.equal(persistedLocale, 'zh');
  assert.equal(hydrated.settings.general.locale, 'zh');
  assert.equal(hydrated.localeExplicit, true);
});
