/**
 * Settings Page Component
 *
 * Configuration page for provider, appearance, and notifications.
 */

import { useState, useEffect } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { Settings, Palette, Globe, Check, ChevronRight } from 'lucide-react';
import { localeAtom, themeAtom } from '../../../atoms/ui';
import { useTranslation } from '../../../lib/i18n';
import { dispatchCommandAtom } from '../../../atoms/connection';

type SettingsSection = 'general' | 'appearance' | 'providers';

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
  const [activeSection, setActiveSection] = useState<SettingsSection>('general');

  // Provider settings state (would come from server in real implementation)
  const [providers] = useState<ProviderInfo[]>([
    { id: 'claude', displayName: 'Claude', capability: 'full', hooksRegistered: false },
    { id: 'codex', displayName: 'Codex', capability: 'limited', hooksRegistered: false },
  ]);
  const [defaultProvider, setDefaultProvider] = useState('claude');

  // Render content based on active section
  const renderContent = () => {
    switch (activeSection) {
      case 'general':
        return (
          <GeneralSettings
            defaultProvider={defaultProvider}
            setDefaultProvider={setDefaultProvider}
            providers={providers}
          />
        );
      case 'appearance':
        return <AppearanceSettings />;
      case 'providers':
        return <ProviderSettings providers={providers} />;
      default:
        return null;
    }
  };

  return (
    <div className="settings-page">
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
        </nav>
      </aside>

      <main className="settings-content">
        {renderContent()}
      </main>

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
}

function GeneralSettings({ defaultProvider, setDefaultProvider, providers }: GeneralSettingsProps) {
  const t = useTranslation();
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [notifyOnlyBackground, setNotifyOnlyBackground] = useState(true);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default');

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
              onClick={() => setDefaultProvider(provider.id)}
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
              onChange={(e) => setNotificationsEnabled(e.target.checked)}
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
              onChange={(e) => setNotifyOnlyBackground(e.target.checked)}
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

function AppearanceSettings() {
  const t = useTranslation();
  const [theme] = useAtom(themeAtom);
  const [locale, setLocale] = useAtom(localeAtom);
  const [terminalRenderer, setTerminalRenderer] = useState<'standard' | 'compatibility'>('standard');

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">{t('settings.appearance')}</h2>

      <div className="settings-group">
        <h3 className="settings-group-title">{t('settings.theme.title')}</h3>
        <p className="settings-group-desc">{t('settings.theme_hint')}</p>

        <div className="settings-pills">
          <button
            className={`settings-pill ${theme === 'dark' ? 'settings-pill-active' : ''}`}
            disabled
          >
            <Check size={12} />
            <span>{t('settings.theme.dark')}</span>
          </button>
          <button className="settings-pill settings-pill-disabled" disabled>
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
            onClick={() => setTerminalRenderer('standard')}
          >
            {terminalRenderer === 'standard' && <Check size={12} />}
            <span>{t('settings.terminal_standard')}</span>
          </button>
          <button
            className={`settings-pill ${terminalRenderer === 'compatibility' ? 'settings-pill-active' : ''}`}
            onClick={() => setTerminalRenderer('compatibility')}
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
            onClick={() => setLocale('zh')}
          >
            {locale === 'zh' && <Check size={12} />}
            <span>{t('settings.language.zh')}</span>
          </button>
          <button
            className={`settings-pill ${locale === 'en' ? 'settings-pill-active' : ''}`}
            onClick={() => setLocale('en')}
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
}

function ProviderSettings({ providers }: ProviderSettingsProps) {
  const t = useTranslation();
  const [selectedProvider, setSelectedProvider] = useState(providers[0]?.id);
  const dispatch = useAtomValue(dispatchCommandAtom);

  const provider = providers.find((p) => p.id === selectedProvider);

  const handleInjectHooks = async () => {
    if (!provider) return;

    const result = await dispatch('settings.injectHooks', { providerId: provider.id });

    if (result.ok) {
      console.log('Hooks injected successfully');
    } else if (result.error) {
      console.error('Failed to inject hooks:', result.error);
    }
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
              />
            </div>

            <div className="settings-config-field">
              <label className="settings-config-label">{t('settings.provider.model')}</label>
              <select className="input">
                <option value="claude-3-opus">Claude 3 Opus</option>
                <option value="claude-3-sonnet">Claude 3 Sonnet</option>
                <option value="claude-3-haiku">Claude 3 Haiku</option>
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SettingsPage;
