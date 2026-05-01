import { useEffect, useState } from 'react';
import { useAtom } from 'jotai';
import { authenticatedAtom } from '../../atoms/ui';
import { authEnabledAtom } from '../../atoms/connection';
import { useTranslation } from '../../lib/i18n';
import { useAtomValue } from 'jotai';
import { useViewport } from '../../hooks/use-viewport';

export function LoginPage() {
  const t = useTranslation();
  const [, setAuthenticated] = useAtom(authenticatedAtom);
  const authEnabled = useAtomValue(authEnabledAtom);
  const isMobile = useViewport() === 'mobile';
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(authEnabled === null);
  const [statusUnavailable, setStatusUnavailable] = useState(false);
  const [statusNotConfigured, setStatusNotConfigured] = useState(false);

  useEffect(() => {
    if (authEnabled !== null) {
      setCheckingStatus(false);
      setStatusUnavailable(false);
      setStatusNotConfigured(authEnabled === false);
      if (authEnabled === false) {
        setAuthenticated(true);
      }
      return;
    }

    const checkStatus = async () => {
      try {
        const response = await fetch('/auth/status');
        const data = await response.json();
        setStatusUnavailable(false);
        setStatusNotConfigured(data.authEnabled === false);
        if (data.authEnabled === false) {
          setAuthenticated(true);
        }
      } catch {
        setStatusUnavailable(true);
        setStatusNotConfigured(false);
      } finally {
        setCheckingStatus(false);
      }
    };

    void checkStatus();
  }, [authEnabled, setAuthenticated]);

  const description = checkingStatus
    ? t('status.connecting')
    : statusUnavailable
      ? t('status.unavailable')
      : statusNotConfigured
        ? t('auth.status_not_configured')
        : t('auth.description');

  const statusDetail = checkingStatus
    ? t('auth.status_loading')
    : statusUnavailable
      ? t('auth.status_unavailable')
      : statusNotConfigured
        ? t('auth.status_not_configured')
        : t('auth.hint');

  const statusPanelClassName = `auth-status-panel${statusUnavailable || error ? ' auth-status-panel-error' : ''}`;
  const submitLabel = checkingStatus || submitting ? t('status.connecting') : t('action.confirm');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: 'Login failed' }));
        setError(data.error || 'Login failed');
        return;
      }

      const data = await response.json();
      if (data.authEnabled === false || data.ok) {
        setAuthenticated(true);
      }
    } catch {
      setError(t('error.network'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className={[
        'welcome-container',
        'auth-screen',
        isMobile ? 'welcome-container--mobile auth-screen--mobile' : '',
      ].filter(Boolean).join(' ')}
    >
      <div
        className={[
          'welcome-card',
          'auth-card-shell',
          isMobile ? 'welcome-card--mobile auth-card-shell--mobile' : '',
        ].filter(Boolean).join(' ')}
      >
        <div className="welcome-kicker">CODER STUDIO</div>
        <h1 className="welcome-title">{t('app.name')}</h1>
        <p className="welcome-body auth-card-desc">{description}</p>
        <div className={statusPanelClassName}>
          <div className="auth-status-eyebrow">{t('auth.status_title')}</div>
          <p className="auth-status-detail">{error ?? statusDetail}</p>
        </div>
        <form className="auth-form" onSubmit={handleSubmit}>
          <input
            className="input auth-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('settings.auth.password')}
          />
          <button className="btn btn-primary btn-lg auth-submit" type="submit" disabled={checkingStatus || submitting || !password.trim()}>
            {submitLabel}
          </button>
        </form>
      </div>
    </div>
  );
}

export default LoginPage;
