/**
 * Settings Page Component
 *
 * Configuration page for provider, appearance, and notifications.
 */

import { useState, useEffect } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { useNavigate } from 'react-router-dom';
import { Settings, Palette, Globe, Check, ChevronRight, ArrowLeft, Keyboard, Server } from 'lucide-react';
import { localeAtom, themeAtom, activeWorkspaceIdAtom } from '../../../atoms/ui';
import { useTranslation } from '../../../lib/i18n';
import { dispatchCommandAtom } from '../../../atoms/connection';
import { ShortcutsSettings } from './shortcuts-settings';
import { McpSettings } from './mcp-settings';

type SettingsSection = 'general' | 'appearance' | 'providers' | 'shortcuts' | 'mcp';

interface ProviderInfo {
  id: string;
  displayName: string;
  capability: 'full' | 'limited' | 'unsupported';
  hooksRegistered: boolean;
}

/**
 * Settings Page
 *
 * PRD §13:
 *   - Two-column layout: sidebar (200px) + content area
 *   - Navigation sections: General, Provider (per provider), Appearance
 *   - General: default provider, notifications
 *   - Provider: config fields, hooks injection, command preview
 *   - Appearance: theme, terminal renderer, language
 */
export function SettingsPage() {
  const t = useTranslation();
  const navigate = useNavigate();
  const dispatch = useAtomValue(dispatchCommandAtom);
  const activeWorkspaceId = useAtomValue(activeWorkspaceIdAtom);
  const [activeSection, setActiveSection] = useState<SettingsSection>('general');

  // Provider settings state (would come from server in real implementation)
  const [providers, setProviders] = useState<ProviderInfo[]>([
    { id: 'claude', displayName: 'Claude', capability: 'full', hooksRegistered: false },
    { id: 'codex', displayName: 'Codex', capability: 'limited', hooksRegistered: false },
  ]);
  const [defaultProvider, setDefaultProvider] = useState('claude');
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [notifyOnlyBackground, setNotifyOnlyBackground] = useState(true);
  const [terminalRenderer, setTerminalRenderer] = useState<'standard' | 'compatibility'>('standard');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('claude-3-sonnet');
  const [providerCwd, setProviderCwd] = useState('');
  const [commandPreview, setCommandPreview] = useState('');
  const [locale, setLocale] = useAtom(localeAtom);
  const [theme, setTheme] = useAtom(themeAtom);

  useEffect(() => {
    const loadSettings = async () => {
      const result = await dispatch<Record<string, unknown>>('settings.get', {});
      if (!result.ok || !result.data) {
        return;
      }

      const settings = result.data;
      if (typeof settings.defaultProviderId === 'string') {
        setDefaultProvider(settings.defaultProviderId);
      }
      if (typeof settings['notifications.enabled'] === 'boolean') {
        setNotificationsEnabled(settings['notifications.enabled']);
      }
      if (typeof settings['notifications.onlyWhenBackgrounded'] === 'boolean') {
        setNotifyOnlyBackground(settings['notifications.onlyWhenBackgrounded']);
      }
      if (settings['appearance.terminalRenderer'] === 'standard' || settings['appearance.terminalRenderer'] === 'compatibility') {
        setTerminalRenderer(settings['appearance.terminalRenderer']);
      }
      if (settings['appearance.locale'] === 'zh' || settings['appearance.locale'] === 'en') {
        setLocale(settings['appearance.locale']);
      }
      if (typeof settings['providers.apiKey'] === 'string') {
        setApiKey(settings['providers.apiKey']);
      }
      if (typeof settings['providers.model'] === 'string') {
        setModel(settings['providers.model']);
      }
      if (typeof settings['providers.cwd'] === 'string') {
        setProviderCwd(settings['providers.cwd']);
      }
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
  }, [dispatch, setLocale]);

  const handleBack = () => {
    if (activeWorkspaceId) {
      navigate(`/workspace/${activeWorkspaceId}`);
    } else {
      navigate('/');
    }
  };

  // Render content based on active section
  const renderContent = () => {
    switch (activeSection) {
      case 'general':
        return (
          <GeneralSettings
            defaultProvider={defaultProvider}
            setDefaultProvider={setDefaultProvider}
            providers={providers}
            notificationsEnabled={notificationsEnabled}
            setNotificationsEnabled={setNotificationsEnabled}
            notifyOnlyBackground={notifyOnlyBackground}
            setNotifyOnlyBackground={setNotifyOnlyBackground}
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
            key={`${apiKey}:${model}:${providerCwd}`}
            providers={providers}
            setProviders={setProviders}
            apiKey={apiKey}
            setApiKey={setApiKey}
            model={model}
            setModel={setModel}
            providerCwd={providerCwd}
            setProviderCwd={setProviderCwd}
            commandPreview={commandPreview}
            setCommandPreview={setCommandPreview}
          />
        );
      case 'shortcuts':
        return <ShortcutsSettings />;
      case 'mcp':
        return <McpSettings />;
      default:
        return null;
    }
  };

  return (
    <div className="settings-page">
      <header className="settings-header">
        <button className="settings-back-btn" onClick={handleBack}>
          <ArrowLeft size={16} />
          <span>{t('action.back')}</span>
        </button>
      </header>

      <div className="settings-body">
        <aside className="settings-sidebar">
          <nav className="settings-nav">
            <SettingsNavItem
              icon={<Settings size={16} />}
              label={t('settings.general')}
              active={activeSection === 'general'}
              onClick={() => setActiveSection('general')}
            />
            <SettingsNavItem
              icon={<Globe size={16} />}
              label={t('settings.providers')}
              active={activeSection === 'providers'}
              onClick={() => setActiveSection('providers')}
            />
            <SettingsNavItem
              icon={<Palette size={16} />}
              label={t('settings.appearance')}
              active={activeSection === 'appearance'}
              onClick={() => setActiveSection('appearance')}
            />
            <SettingsNavItem
              icon={<Keyboard size={16} />}
              label={t('settings.shortcuts.title')}
              active={activeSection === 'shortcuts'}
              onClick={() => setActiveSection('shortcuts')}
            />
            <SettingsNavItem
              icon={<Server size={16} />}
              label={t('settings.mcp.title')}
              active={activeSection === 'mcp'}
              onClick={() => setActiveSection('mcp')}
            />
          </nav>
        </aside>

        <main className="settings-content">
          {renderContent()}
        </main>
      </div>

      <footer className="settings-footer">
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
  defaultProvider: string;
  setDefaultProvider: (id: string) => void;
  providers: ProviderInfo[];
  notificationsEnabled: boolean;
  setNotificationsEnabled: (value: boolean) => void;
  notifyOnlyBackground: boolean;
  setNotifyOnlyBackground: (value: boolean) => void;
}

function GeneralSettings({
  defaultProvider,
  setDefaultProvider,
  providers,
  notificationsEnabled,
  setNotificationsEnabled,
  notifyOnlyBackground,
  setNotifyOnlyBackground,
}: GeneralSettingsProps) {
  const t = useTranslation();
  const dispatch = useAtomValue(dispatchCommandAtom);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default');

  const saveSettings = async (settings: Record<string, unknown>) => {
    await dispatch('settings.update', { settings });
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
        <h3 className="settings-group-title">{t('settings.provider.title')}</h3>
        <p className="settings-group-desc">{t('settings.provider.select_hint')}</p>

        <div className="settings-provider-pills">
          {providers.map((provider) => (
            <button
              key={provider.id}
              className={`settings-pill ${defaultProvider === provider.id ? 'settings-pill-active' : ''}`}
              onClick={() => {
                setDefaultProvider(provider.id);
                void saveSettings({ defaultProviderId: provider.id });
              }}
            >
              {defaultProvider === provider.id && <Check size={12} />}
              <span>{provider.displayName}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title">{t('settings.notifications')}</h3>

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
                setNotificationsEnabled(e.target.checked);
                void saveSettings({ notifications: { enabled: e.target.checked } });
              }}
            />
            <span className="settings-toggle-slider" />
          </label>
        </div>

        <div className="settings-toggle-row">
          <div className="settings-toggle-info">
            <span className="settings-toggle-label">{t('settings.notify_background')}</span>
            <span className="settings-toggle-desc">{t('settings.notify_background_hint')}</span>
          </div>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={notifyOnlyBackground}
              onChange={(e) => {
                setNotifyOnlyBackground(e.target.checked);
                void saveSettings({ notifications: { onlyWhenBackgrounded: e.target.checked } });
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
            {notificationPermission === 'denied' && t('settings.permission_denied')}
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
        <p className="settings-group-desc">{t('settings.theme_hint')}</p>

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
        <p className="settings-group-desc">{t('settings.language_hint')}</p>

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
  apiKey: string;
  setApiKey: (value: string) => void;
  model: string;
  setModel: (value: string) => void;
  providerCwd: string;
  setProviderCwd: (value: string) => void;
  commandPreview: string;
  setCommandPreview: (value: string) => void;
}

function ProviderSettings({
  providers,
  setProviders,
  apiKey,
  setApiKey,
  model,
  setModel,
  providerCwd,
  setProviderCwd,
  commandPreview,
  setCommandPreview,
}: ProviderSettingsProps) {
  const t = useTranslation();
  const [selectedProvider, setSelectedProvider] = useState(providers[0]?.id);
  const dispatch = useAtomValue(dispatchCommandAtom);

  const provider = providers.find((p) => p.id === selectedProvider);

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

      const config = provider.id === 'claude'
        ? { model, additionalArgs: [], envVars: {} }
        : { cwd: providerCwd || undefined, additionalArgs: [], envVars: {} };

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
  }, [dispatch, provider, model, providerCwd, setCommandPreview]);

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

            <div className="settings-config-field">
              <label className="settings-config-label">{t('settings.provider.api_key')}</label>
              <input
                type="password"
                className="input"
                placeholder={t('settings.provider.api_key_placeholder')}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  void saveSettings({ providers: { apiKey: e.target.value } });
                }}
              />
            </div>

            {provider.id === 'claude' ? (
              <div className="settings-config-field">
                <label className="settings-config-label">{t('settings.provider.model')}</label>
                <select className="input" value={model} onChange={(e) => {
                  setModel(e.target.value);
                  void saveSettings({ providers: { model: e.target.value } });
                }}>
                  <option value="claude-3-opus">Claude 3 Opus</option>
                  <option value="claude-3-sonnet">Claude 3 Sonnet</option>
                  <option value="claude-3-haiku">Claude 3 Haiku</option>
                </select>
              </div>
            ) : (
              <div className="settings-config-field">
                <label className="settings-config-label">Working Directory Override</label>
                <input
                  type="text"
                  className="input"
                  placeholder="/path/to/project"
                  value={providerCwd}
                  onChange={(e) => {
                    setProviderCwd(e.target.value);
                    void saveSettings({ providers: { cwd: e.target.value } });
                  }}
                />
              </div>
            )}
          </div>

          <div className="settings-group">
            <h3 className="settings-group-title">Command Preview</h3>
            <p className="settings-group-desc">Preview of the effective provider command</p>
            <div className="settings-config-field">
              <code className="settings-command-preview">{commandPreview}</code>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SettingsPage;
