/**
 * Settings Page Component
 *
 * Configuration page for provider, appearance, and notifications.
 */

import { useState, useEffect } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronRight, ArrowLeft } from 'lucide-react';
import {
  localeAtom,
  themeAtom,
  notificationPreferencesAtom,
} from '../../../atoms/ui';
import { resolvedActiveWorkspaceIdAtom } from '../../../atoms/workspaces';
import { useViewport } from '../../../hooks/use-viewport';
import { useTranslation } from '../../../lib/i18n';
import { dispatchCommandAtom } from '../../../atoms/connection';
import { ShortcutsSettings } from './shortcuts-settings';
import { ConfigDriftBanner } from '../../config-drift-banner';
import { ConfigEditor } from './config-editor';
import { resolveSettingsExitTargetFromBrowserHistory } from './settings-navigation';
import {
  SETTINGS_SECTIONS,
  type SettingsSection,
} from './settings-sections';

interface ProviderInfo {
  id: string;
  displayName: string;
  capability: 'full' | 'limited' | 'unsupported';
  hooksRegistered: boolean;
}

type SettingsNavigationState =
  | {
      kind: 'root';
      lastSection: SettingsSection;
    }
  | {
      kind: 'detail';
      section: SettingsSection;
    };

const DEFAULT_SETTINGS_SECTION: SettingsSection = SETTINGS_SECTIONS[0].id;

function parseProviderAdditionalArgs(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function formatProviderAdditionalArgs(value: unknown): string {
  if (!Array.isArray(value)) {
    return '';
  }

  return value.filter((item): item is string => typeof item === 'string').join('\n');
}

function loadProviderAdditionalArgs(
  settings: Record<string, unknown>,
  providers: ProviderInfo[]
): Record<string, string> {
  return Object.fromEntries(
    providers.map((provider) => [
      provider.id,
      formatProviderAdditionalArgs(settings[`providers.${provider.id}.additionalArgs`]),
    ])
  );
}

/**
 * Settings Page
 *
 * PRD §13:
 *   - Two-column layout: sidebar (200px) + content area
 *   - Navigation sections: General, Provider (per provider), Appearance
 *   - General: notifications
 *   - Provider: config fields, hooks injection, command preview
 *   - Appearance: theme, terminal renderer, language
 */
export function SettingsPage() {
  const t = useTranslation();
  const settingsLoadFailedUnknown = t('settings.load_failed_unknown');
  const navigate = useNavigate();
  const viewport = useViewport();
  const isMobile = viewport === 'mobile';
  const dispatch = useAtomValue(dispatchCommandAtom);
  const activeWorkspaceId = useAtomValue(resolvedActiveWorkspaceIdAtom);
  const [navigationState, setNavigationState] = useState<SettingsNavigationState>(() =>
    isMobile
      ? { kind: 'root', lastSection: DEFAULT_SETTINGS_SECTION }
      : { kind: 'detail', section: DEFAULT_SETTINGS_SECTION }
  );

  // Provider settings state (would come from server in real implementation)
  const [providers, setProviders] = useState<ProviderInfo[]>([
    { id: 'claude', displayName: 'Claude', capability: 'full', hooksRegistered: false },
    { id: 'codex', displayName: 'Codex', capability: 'limited', hooksRegistered: false },
  ]);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [terminalRenderer, setTerminalRenderer] = useState<'standard' | 'compatibility'>('standard');
  const [providerAdditionalArgsById, setProviderAdditionalArgsById] = useState<Record<string, string>>({});
  const [commandPreview, setCommandPreview] = useState('');
  const [settingsLoadError, setSettingsLoadError] = useState<string | null>(null);
  const [settingsRefreshKey, setSettingsRefreshKey] = useState(0);
  const [locale, setLocale] = useAtom(localeAtom);
  const [theme, setTheme] = useAtom(themeAtom);
  const setNotificationPreferences = useSetAtom(notificationPreferencesAtom);
  const detailSection =
    navigationState.kind === 'detail'
      ? navigationState.section
      : navigationState.lastSection;
  const activeSectionMeta =
    SETTINGS_SECTIONS.find((section) => section.id === detailSection) ?? SETTINGS_SECTIONS[0];

  useEffect(() => {
    setNavigationState((state) => {
      if (isMobile) {
        return state.kind === 'root'
          ? state
          : { kind: 'root', lastSection: state.section };
      }

      return state.kind === 'detail'
        ? state
        : { kind: 'detail', section: state.lastSection };
    });
  }, [isMobile]);

  useEffect(() => {
    let cancelled = false;

    const loadSettings = async () => {
      const result = await dispatch<Record<string, unknown>>('settings.get', {});
      if (!result.ok || !result.data) {
        if (!cancelled) {
          setSettingsLoadError(result.error?.message ?? settingsLoadFailedUnknown);
        }
        return;
      }

      const settings = result.data;
      if (cancelled) return;
      setSettingsLoadError(null);
      if (typeof settings['notifications.enabled'] === 'boolean') {
        setNotificationsEnabled(settings['notifications.enabled']);
      }
      if (typeof settings['notifications.soundEnabled'] === 'boolean') {
        setSoundEnabled(settings['notifications.soundEnabled']);
      }
      setNotificationPreferences({
        enabled: typeof settings['notifications.enabled'] === 'boolean'
          ? settings['notifications.enabled']
          : true,
        soundEnabled: typeof settings['notifications.soundEnabled'] === 'boolean'
          ? settings['notifications.soundEnabled']
          : true,
      });
      if (settings['appearance.terminalRenderer'] === 'standard' || settings['appearance.terminalRenderer'] === 'compatibility') {
        setTerminalRenderer(settings['appearance.terminalRenderer']);
      }
      if (settings['appearance.locale'] === 'zh' || settings['appearance.locale'] === 'en') {
        setLocale(settings['appearance.locale']);
      }
      setProviderAdditionalArgsById(loadProviderAdditionalArgs(settings, providers));
      if (Array.isArray(settings.hookRegistrations)) {
        setProviders((prev) => prev.map((provider) => {
          const registration = (settings.hookRegistrations as Array<{ providerId: string; lastStatus?: string }>).find(
            (item) => item.providerId === provider.id
          );
          return {
            ...provider,
            hooksRegistered: registration?.lastStatus === 'ok',
          };
        }));
      }
    };

    void loadSettings();
    return () => {
      cancelled = true;
    };
  }, [dispatch, setLocale, setNotificationPreferences, settingsLoadFailedUnknown, settingsRefreshKey]);

  const handlePageExit = () => {
    const target = resolveSettingsExitTargetFromBrowserHistory(Boolean(activeWorkspaceId));

    if (target === 'history') {
      navigate(-1);
      return;
    }

    navigate(target);
  };

  const handleBack = () => {
    if (isMobile && navigationState.kind === 'detail') {
      setNavigationState({ kind: 'root', lastSection: navigationState.section });
      return;
    }

    if (!isMobile) {
      navigate('/workspace');
      return;
    }

    handlePageExit();
  };

  // Render content based on active section
  const renderContent = () => {
    switch (detailSection) {
      case 'general':
        return (
          <GeneralSettings
            notificationsEnabled={notificationsEnabled}
            setNotificationsEnabled={setNotificationsEnabled}
            soundEnabled={soundEnabled}
            setSoundEnabled={setSoundEnabled}
          />
        );
      case 'appearance':
        return (
          <AppearanceSettings
            locale={locale}
            setLocale={setLocale}
            terminalRenderer={terminalRenderer}
            setTerminalRenderer={setTerminalRenderer}
            theme={theme}
            setTheme={setTheme}
          />
        );
      case 'providers':
        return (
          <ProviderSettings
            providers={providers}
            setProviders={setProviders}
            additionalArgsById={providerAdditionalArgsById}
            setAdditionalArgsById={setProviderAdditionalArgsById}
            commandPreview={commandPreview}
            setCommandPreview={setCommandPreview}
          />
        );
      case 'shortcuts':
        return <ShortcutsSettings />;
      default:
        return null;
    }
  };

  const renderMobileRoot = () => (
    <main className="settings-content settings-content--mobile-root">
      <div className="settings-mobile-list">
        {SETTINGS_SECTIONS.map(({ id, labelKey, Icon }) => (
          <button
            key={id}
            type="button"
            className="settings-mobile-item"
            onClick={() => setNavigationState({ kind: 'detail', section: id })}
          >
            <span className="settings-mobile-item__icon">
              <Icon size={18} />
            </span>
            <span className="settings-mobile-item__label">{t(labelKey)}</span>
            <ChevronRight size={16} className="settings-mobile-item__arrow" />
          </button>
        ))}
      </div>
    </main>
  );

  const shouldShowMobileRoot = isMobile && navigationState.kind === 'root';

  return (
    <div className={`settings-page ${isMobile ? 'settings-page--mobile' : ''}`}>
      <header className="settings-header">
        <button className="settings-back-btn" onClick={handleBack}>
          <ArrowLeft size={16} />
          <span>{t('action.back')}</span>
        </button>
        {isMobile ? (
          <div className="settings-header__title">
            {t(shouldShowMobileRoot ? 'settings.title' : activeSectionMeta.labelKey)}
          </div>
        ) : null}
      </header>

      {shouldShowMobileRoot ? (
        renderMobileRoot()
      ) : (
        <div className={`settings-body ${isMobile ? 'settings-body--mobile' : ''}`}>
          {isMobile ? null : (
            <aside className="settings-sidebar">
              <nav className="settings-nav">
                {SETTINGS_SECTIONS.map(({ id, labelKey, Icon }) => (
                  <SettingsNavItem
                    key={id}
                    icon={<Icon size={16} />}
                    label={t(labelKey)}
                    active={detailSection === id}
                    onClick={() => setNavigationState({ kind: 'detail', section: id })}
                  />
                ))}
              </nav>
            </aside>
          )}

          <main className={`settings-content ${isMobile ? 'settings-content--mobile' : ''}`}>
            {settingsLoadError && (
              <div className="settings-page__notice settings-page__notice--error" role="alert">
                <div className="settings-page__notice-copy">
                  <span className="settings-page__notice-title">{t('settings.load_failed')}</span>
                  <span className="settings-page__notice-message">{settingsLoadError}</span>
                </div>
                <button
                  type="button"
                  className="settings-link"
                  onClick={() => setSettingsRefreshKey((value) => value + 1)}
                >
                  {t('action.refresh')}
                </button>
              </div>
            )}
            <ConfigDriftBanner variant="embedded" showLoadError={!settingsLoadError} />
            {renderContent()}
          </main>
        </div>
      )}

      <footer className={`settings-footer ${isMobile ? 'settings-footer--mobile' : ''}`}>
        <span className="settings-autosave">{t('settings.autosave_hint')}</span>
        <span className="settings-version">v0.2.6</span>
      </footer>
    </div>
  );
}

interface SettingsNavItemProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}

function SettingsNavItem({ icon, label, active, onClick }: SettingsNavItemProps) {
  return (
    <button
      className={`settings-nav-item ${active ? 'settings-nav-item-active' : ''}`}
      onClick={onClick}
    >
      <span className="settings-nav-icon">{icon}</span>
      <span className="settings-nav-label">{label}</span>
      {active && <ChevronRight size={14} className="settings-nav-arrow" />}
    </button>
  );
}

interface GeneralSettingsProps {
  notificationsEnabled: boolean;
  setNotificationsEnabled: (value: boolean) => void;
  soundEnabled: boolean;
  setSoundEnabled: (value: boolean) => void;
}

function GeneralSettings({
  notificationsEnabled,
  setNotificationsEnabled,
  soundEnabled,
  setSoundEnabled,
}: GeneralSettingsProps) {
  const t = useTranslation();
  const dispatch = useAtomValue(dispatchCommandAtom);
  const setNotificationPreferences = useSetAtom(notificationPreferencesAtom);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default');

  const saveSettings = async (settings: Record<string, unknown>) => {
    await dispatch('settings.update', { settings });
  };

  const syncNotificationPreferences = (next: {
    enabled: boolean;
    soundEnabled: boolean;
  }) => {
    setNotificationPreferences(next);
  };

  useEffect(() => {
    if ('Notification' in window) {
      setNotificationPermission(Notification.permission);
    }
  }, []);

  const requestNotificationPermission = async () => {
    if ('Notification' in window) {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
    }
  };

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">{t('settings.general')}</h2>

      <div className="settings-group">
        <h3 className="settings-group-title">{t('settings.notifications')}</h3>
        <p className="settings-group-desc">{t('settings.notifications_channel_hint')}</p>

        <div className="settings-toggle-row">
          <div className="settings-toggle-info">
            <span className="settings-toggle-label">{t('settings.notifications_enabled')}</span>
            <span className="settings-toggle-desc">{t('settings.notifications_enabled_hint')}</span>
          </div>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={notificationsEnabled}
              onChange={(e) => {
                const nextEnabled = e.target.checked;
                setNotificationsEnabled(nextEnabled);
                syncNotificationPreferences({
                  enabled: nextEnabled,
                  soundEnabled,
                });
                void saveSettings({ notifications: { enabled: nextEnabled } });
              }}
            />
            <span className="settings-toggle-slider" />
          </label>
        </div>

        <div className="settings-toggle-row">
          <div className="settings-toggle-info">
            <span className="settings-toggle-label">{t('settings.notification_sound')}</span>
            <span className="settings-toggle-desc">{t('settings.notification_sound_hint')}</span>
          </div>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={soundEnabled}
              onChange={(e) => {
                const nextSoundEnabled = e.target.checked;
                setSoundEnabled(nextSoundEnabled);
                syncNotificationPreferences({
                  enabled: notificationsEnabled,
                  soundEnabled: nextSoundEnabled,
                });
                void saveSettings({ notifications: { soundEnabled: nextSoundEnabled } });
              }}
              disabled={!notificationsEnabled}
            />
            <span className="settings-toggle-slider" />
          </label>
        </div>

        <div className="settings-info-row">
          <span className="settings-info-label">{t('settings.notification_permission')}</span>
          <span className={`settings-info-value settings-permission-${notificationPermission}`}>
            {notificationPermission === 'granted' && t('settings.permission_granted')}
            {notificationPermission === 'denied' && (
              <>
                {t('settings.permission_denied')}
                <span className="settings-deny-hint">
                  {t('settings.permission_denied_hint')}
                </span>
              </>
            )}
            {notificationPermission === 'default' && (
              <button className="settings-link" onClick={requestNotificationPermission}>
                {t('settings.permission_request')}
              </button>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

interface AppearanceSettingsProps {
  locale: string;
  setLocale: (value: 'zh' | 'en') => void;
  terminalRenderer: 'standard' | 'compatibility';
  setTerminalRenderer: (value: 'standard' | 'compatibility') => void;
  theme: 'dark' | 'light';
  setTheme: (value: 'dark' | 'light') => void;
}

function AppearanceSettings({
  locale,
  setLocale,
  terminalRenderer,
  setTerminalRenderer,
  theme,
  setTheme,
}: AppearanceSettingsProps) {
  const t = useTranslation();
  const dispatch = useAtomValue(dispatchCommandAtom);

  const saveSettings = async (settings: Record<string, unknown>) => {
    await dispatch('settings.update', { settings });
  };

  const handleThemeChange = (newTheme: 'dark' | 'light') => {
    setTheme(newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
    void saveSettings({ appearance: { theme: newTheme } });
  };

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">{t('settings.appearance')}</h2>

      <div className="settings-group">
        <h3 className="settings-group-title">{t('settings.theme.title')}</h3>
        <p className="settings-group-desc">{t('settings.theme.hint')}</p>

        <div className="settings-pills">
          <button
            className={`settings-pill ${theme === 'dark' ? 'settings-pill-active' : ''}`}
            onClick={() => handleThemeChange('dark')}
          >
            {theme === 'dark' && <Check size={12} />}
            <span>{t('settings.theme.dark')}</span>
          </button>
          <button
            className={`settings-pill ${theme === 'light' ? 'settings-pill-active' : ''}`}
            onClick={() => handleThemeChange('light')}
          >
            {theme === 'light' && <Check size={12} />}
            <span>{t('settings.theme.light')}</span>
          </button>
        </div>
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title">{t('settings.terminal_renderer')}</h3>
        <p className="settings-group-desc">{t('settings.terminal_renderer_hint')}</p>

        <div className="settings-pills">
          <button
            className={`settings-pill ${terminalRenderer === 'standard' ? 'settings-pill-active' : ''}`}
            onClick={() => {
              setTerminalRenderer('standard');
              void saveSettings({ appearance: { terminalRenderer: 'standard' } });
            }}
          >
            {terminalRenderer === 'standard' && <Check size={12} />}
            <span>{t('settings.terminal_standard')}</span>
          </button>
          <button
            className={`settings-pill ${terminalRenderer === 'compatibility' ? 'settings-pill-active' : ''}`}
            onClick={() => {
              setTerminalRenderer('compatibility');
              void saveSettings({ appearance: { terminalRenderer: 'compatibility' } });
            }}
          >
            {terminalRenderer === 'compatibility' && <Check size={12} />}
            <span>{t('settings.terminal_compatibility')}</span>
          </button>
        </div>
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title">{t('settings.language.title')}</h3>
        <p className="settings-group-desc">{t('settings.language.hint')}</p>

        <div className="settings-pills">
          <button
            className={`settings-pill ${locale === 'zh' ? 'settings-pill-active' : ''}`}
            onClick={() => {
              setLocale('zh');
              void saveSettings({ appearance: { locale: 'zh' } });
            }}
          >
            {locale === 'zh' && <Check size={12} />}
            <span>{t('settings.language.zh')}</span>
          </button>
          <button
            className={`settings-pill ${locale === 'en' ? 'settings-pill-active' : ''}`}
            onClick={() => {
              setLocale('en');
              void saveSettings({ appearance: { locale: 'en' } });
            }}
          >
            {locale === 'en' && <Check size={12} />}
            <span>{t('settings.language.en')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

interface ProviderSettingsProps {
  providers: ProviderInfo[];
  setProviders: React.Dispatch<React.SetStateAction<ProviderInfo[]>>;
  additionalArgsById: Record<string, string>;
  setAdditionalArgsById: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  commandPreview: string;
  setCommandPreview: (value: string) => void;
}

function ProviderSettings({
  providers,
  setProviders,
  additionalArgsById,
  setAdditionalArgsById,
  commandPreview,
  setCommandPreview,
}: ProviderSettingsProps) {
  const t = useTranslation();
  const [selectedProvider, setSelectedProvider] = useState(providers[0]?.id);
  const dispatch = useAtomValue(dispatchCommandAtom);

  const provider = providers.find((p) => p.id === selectedProvider);
  const additionalArgsText = provider ? additionalArgsById[provider.id] ?? '' : '';
  const additionalArgs = parseProviderAdditionalArgs(additionalArgsText);

  const handleInjectHooks = async () => {
    if (!provider) return;

    const result = await dispatch('settings.injectHooks', { providerId: provider.id });

    if (result.ok) {
      setProviders((prev) => prev.map((item) => item.id === provider.id ? { ...item, hooksRegistered: true } : item));
    } else if (result.error) {
    }
  };

  useEffect(() => {
    const loadPreview = async () => {
      if (!provider) {
        setCommandPreview('');
        return;
      }

      const config = { additionalArgs };

      const result = await dispatch<{ preview: string }>('settings.previewCommand', {
        providerId: provider.id,
        config,
      });

      if (result.ok && result.data) {
        setCommandPreview(result.data.preview);
      } else if (result.error?.code === 'no_client' || result.error?.code === 'command_error') {
        // WebSocket not connected, retry after a short delay
        setTimeout(() => void loadPreview(), 500);
      } else {
        setCommandPreview('Error loading preview');
      }
    };

    void loadPreview();
  }, [additionalArgsText, dispatch, provider, setCommandPreview]);

  const saveSettings = async (settings: Record<string, unknown>) => {
    await dispatch('settings.update', { settings });
  };

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">{t('settings.providers')}</h2>

      <div className="settings-provider-tabs">
        {providers.map((p) => (
          <button
            key={p.id}
            className={`settings-provider-tab ${selectedProvider === p.id ? 'settings-provider-tab-active' : ''}`}
            onClick={() => setSelectedProvider(p.id)}
          >
            {p.displayName}
          </button>
        ))}
      </div>

      {provider && (
        <div className="settings-provider-content">
          <div className="settings-provider-card">
            <div className="settings-provider-header">
              <span className="settings-provider-badge">{provider.displayName}</span>
              <span className={`settings-provider-capability settings-capability-${provider.capability}`}>
                {t(`settings.provider.capability_${provider.capability}`)}
              </span>
            </div>

            <div className="settings-provider-meta">
              <div className="settings-provider-meta-item">
                <span className="settings-provider-meta-label">{t('settings.provider.status')}</span>
                <span className={`settings-provider-status ${provider.hooksRegistered ? 'status-registered' : 'status-unregistered'}`}>
                  {provider.hooksRegistered ? t('settings.provider.hooks_registered') : t('settings.provider.hooks_unregistered')}
                </span>
              </div>
            </div>
          </div>

          <div className="settings-group">
            <h3 className="settings-group-title">{t('settings.provider.hooks')}</h3>
            <p className="settings-group-desc">{t('settings.provider.hooks_hint')}</p>

            <button
              className="btn btn-primary"
              onClick={handleInjectHooks}
              disabled={provider.hooksRegistered}
            >
              {provider.hooksRegistered ? t('settings.provider.hooks_registered') : t('settings.provider.hooks_inject')}
            </button>
          </div>

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
                onChange={(e) => {
                  const nextValue = e.target.value;
                  if (!provider) {
                    return;
                  }

                  setAdditionalArgsById((prev) => ({
                    ...prev,
                    [provider.id]: nextValue,
                  }));
                  void saveSettings({
                    providers: {
                      [provider.id]: {
                        additionalArgs: parseProviderAdditionalArgs(nextValue),
                      },
                    },
                  });
                }}
              />
            </div>
          </div>

          <div className="settings-group">
            <h3 className="settings-group-title">Command Preview</h3>
            <p className="settings-group-desc">Preview of the effective provider command</p>
            <div className="settings-config-field">
              <code className="settings-command-preview">{commandPreview}</code>
            </div>
          </div>

          {/* Config File Editor */}
          <div className="settings-group">
            <h3 className="settings-group-title">{t('settings.config_files.title')}</h3>
            <p className="settings-group-desc">
              {selectedProvider === 'codex'
                ? t('settings.config_files.codex_config')
                : t('settings.config_files.claude_config')}
            </p>
            <ConfigEditor configType={selectedProvider as 'codex' | 'claude'} />
          </div>
        </div>
      )}
    </div>
  );
}

export default SettingsPage;
