import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useAtomValue } from 'jotai';
import { connectionStatusAtom, dispatchCommandAtom } from '../../../atoms/connection';
import { useTranslation } from '../../../lib/i18n';
import { ConfigEditor, type ConfigType } from './config-editor';

export interface ProviderInfo {
  id: 'claude' | 'codex';
  displayName: string;
}

interface ProviderSettingsProps {
  providers: ProviderInfo[];
  additionalArgsById: Record<string, string>;
  setAdditionalArgsById: Dispatch<SetStateAction<Record<string, string>>>;
  isMobile: boolean;
}

type ProviderDetailView = 'base' | 'config';

function parseProviderAdditionalArgs(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function createProviderRecord<T>(providers: ProviderInfo[], createValue: () => T): Record<string, T> {
  return Object.fromEntries(providers.map((provider) => [provider.id, createValue()]));
}

export function ProviderSettings({
  providers,
  additionalArgsById,
  setAdditionalArgsById,
  isMobile,
}: ProviderSettingsProps) {
  const t = useTranslation();
  const dispatch = useAtomValue(dispatchCommandAtom);
  const connectionStatus = useAtomValue(connectionStatusAtom);
  const [selectedProvider, setSelectedProvider] = useState<ProviderInfo['id']>(providers[0]?.id ?? 'claude');
  const [desktopView, setDesktopView] = useState<ProviderDetailView>('base');
  const [mobileView, setMobileView] = useState<ProviderDetailView>('base');
  const [previewByProvider, setPreviewByProvider] = useState<Record<string, string>>(() =>
    createProviderRecord(providers, () => '')
  );
  const [visitedConfigProviders, setVisitedConfigProviders] = useState<Record<string, boolean>>(() =>
    createProviderRecord(providers, () => false)
  );
  const previewRequestVersionRef = useRef<Record<string, number>>(createProviderRecord(providers, () => 0));

  useEffect(() => {
    if (providers.some((provider) => provider.id === selectedProvider)) {
      return;
    }

    setSelectedProvider(providers[0]?.id ?? 'claude');
  }, [providers, selectedProvider]);

  useEffect(() => {
    setPreviewByProvider((previous) => {
      const next = createProviderRecord(providers, () => '');
      let changed = false;

      for (const provider of providers) {
        if (provider.id in previous) {
          next[provider.id] = previous[provider.id];
        } else {
          changed = true;
        }
      }

      if (Object.keys(previous).length !== providers.length) {
        changed = true;
      }

      return changed ? next : previous;
    });

    setVisitedConfigProviders((previous) => {
      const next = createProviderRecord(providers, () => false);
      let changed = false;

      for (const provider of providers) {
        if (provider.id in previous) {
          next[provider.id] = previous[provider.id];
        } else {
          changed = true;
        }
      }

      if (Object.keys(previous).length !== providers.length) {
        changed = true;
      }

      return changed ? next : previous;
    });

    const nextVersions = createProviderRecord(providers, () => 0);
    for (const provider of providers) {
      if (provider.id in previewRequestVersionRef.current) {
        nextVersions[provider.id] = previewRequestVersionRef.current[provider.id];
      }
    }
    previewRequestVersionRef.current = nextVersions;
  }, [providers]);

  const provider = providers.find((entry) => entry.id === selectedProvider);
  const additionalArgsText = provider ? additionalArgsById[provider.id] ?? '' : '';
  const additionalArgs = useMemo(
    () => parseProviderAdditionalArgs(additionalArgsText),
    [additionalArgsText]
  );
  const showBase = isMobile ? mobileView === 'base' : desktopView === 'base';
  const showConfig = isMobile ? mobileView === 'config' : desktopView === 'config';
  const currentPreview = provider ? previewByProvider[provider.id] ?? '' : '';

  useEffect(() => {
    if (connectionStatus !== 'connected') {
      return;
    }

    if (!provider) {
      return;
    }

    const version = (previewRequestVersionRef.current[provider.id] ?? 0) + 1;
    previewRequestVersionRef.current[provider.id] = version;
    let cancelled = false;

    const loadPreview = async () => {
      const result = await dispatch<{ preview: string }>('settings.previewCommand', {
        providerId: provider.id,
        config: { additionalArgs },
      });

      if (cancelled) {
        return;
      }

      if (previewRequestVersionRef.current[provider.id] !== version) {
        return;
      }

      setPreviewByProvider((previous) => ({
        ...previous,
        [provider.id]:
          result.ok && result.data ? result.data.preview : 'Error loading preview',
      }));
    };

    void loadPreview();

    return () => {
      cancelled = true;
    };
  }, [additionalArgs, additionalArgsText, connectionStatus, dispatch, provider]);

  useEffect(() => {
    if (!provider || !showConfig) {
      return;
    }

    setVisitedConfigProviders((previous) =>
      previous[provider.id] ? previous : { ...previous, [provider.id]: true }
    );
  }, [provider, showConfig]);

  const handleProviderSelect = (providerId: ProviderInfo['id']) => {
    setSelectedProvider(providerId);
    if (isMobile) {
      setMobileView('base');
    }
  };

  const saveSettings = async (providerId: ProviderInfo['id'], nextValue: string) => {
    await dispatch('settings.update', {
      settings: {
        providers: {
          [providerId]: {
            additionalArgs: parseProviderAdditionalArgs(nextValue),
          },
        },
      },
    });
  };

  return (
    <div className="settings-section">
      <div className="settings-provider-tabs">
        {providers.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`settings-provider-tab ${selectedProvider === entry.id ? 'settings-provider-tab-active' : ''}`}
            onClick={() => handleProviderSelect(entry.id)}
          >
            {entry.displayName}
          </button>
        ))}
      </div>

      {!isMobile ? (
        <div className="settings-provider-subnav" role="tablist" aria-label={t('settings.provider.config')}>
          <button
            type="button"
            className={`settings-provider-subnav-button ${desktopView === 'base' ? 'settings-provider-subnav-button-active' : ''}`}
            aria-pressed={desktopView === 'base'}
            onClick={() => setDesktopView('base')}
          >
            {t('settings.provider.base')}
          </button>
          <button
            type="button"
            className={`settings-provider-subnav-button ${desktopView === 'config' ? 'settings-provider-subnav-button-active' : ''}`}
            aria-pressed={desktopView === 'config'}
            onClick={() => setDesktopView('config')}
          >
            {t('settings.provider.config_file')}
          </button>
        </div>
      ) : null}

      {provider && showBase ? (
        <div className="settings-provider-content">
          <div className="settings-group">
            <h3 className="settings-group-title">{t('settings.provider.config')}</h3>
            <p className="settings-group-desc">{t('settings.provider.startup_args_hint')}</p>
            <div className="settings-config-field">
              <label className="settings-config-label" htmlFor="provider-startup-args">
                {t('settings.provider.startup_args')}
              </label>
              <textarea
                id="provider-startup-args"
                className="input settings-provider-args-input"
                rows={4}
                placeholder={t('settings.provider.startup_args_placeholder')}
                value={additionalArgsText}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setAdditionalArgsById((previous) => ({
                    ...previous,
                    [provider.id]: nextValue,
                  }));
                  void saveSettings(provider.id, nextValue);
                }}
              />
            </div>
          </div>

          <div className="settings-group">
            <h3 className="settings-group-title">Command Preview</h3>
            <p className="settings-group-desc">Preview of the effective provider command</p>
            <div className="settings-config-field">
              <code className="settings-command-preview">{currentPreview}</code>
            </div>
          </div>

          {isMobile ? (
            <button
              type="button"
              className="settings-provider-mobile-entry"
              aria-label={t('settings.provider.open_config_file_editor')}
              onClick={() => setMobileView('config')}
            >
              <span className="settings-provider-mobile-entry__title">
                {t('settings.provider.open_config_file_editor')}
              </span>
              <span className="settings-provider-mobile-entry__meta">
                {provider.id === 'codex'
                  ? t('settings.config_files.codex_config')
                  : t('settings.config_files.claude_config')}
              </span>
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="settings-provider-config-stack">
        {providers
          .filter((entry) => visitedConfigProviders[entry.id] || (provider?.id === entry.id && showConfig))
          .map((entry) => {
            const visible = provider?.id === entry.id && showConfig;

            return (
              <div
                key={entry.id}
                className={`settings-provider-config-panel ${visible ? '' : 'settings-provider-config-panel-hidden'}`}
                aria-hidden={!visible}
              >
                <div className="settings-provider-content">
                  <div className="settings-group">
                    {isMobile ? (
                      <div className="settings-provider-mobile-config-header">
                        <button
                          type="button"
                          className="settings-link"
                          onClick={() => setMobileView('base')}
                        >
                          {t('settings.provider.back_to_base')}
                        </button>
                      </div>
                    ) : null}
                    <h3 className="settings-group-title">{t('settings.config_files.title')}</h3>
                    <p className="settings-group-desc">
                      {entry.id === 'codex'
                        ? t('settings.config_files.codex_config')
                        : t('settings.config_files.claude_config')}
                    </p>
                    <ConfigEditor configType={entry.id as ConfigType} visible={visible} />
                  </div>
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}
