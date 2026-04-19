import { useEffect, useState } from 'react';
import { useAtom } from 'jotai';
import { authenticatedAtom } from '../../atoms/ui';
import { useTranslation } from '../../lib/i18n';

export function LoginPage() {
  const t = useTranslation();
  const [, setAuthenticated] = useAtom(authenticatedAtom);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(true);
  const [statusUnavailable, setStatusUnavailable] = useState(false);
  const [statusNotConfigured, setStatusNotConfigured] = useState(false);

  useEffect(() => {
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
  }, [setAuthenticated]);

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
    <div className="auth-layout">
      <div className="auth-card">
        <h1 className="auth-card-title">{t('app.name')}</h1>
        <p className="auth-card-desc">
          {checkingStatus
            ? t('status.connecting')
            : statusUnavailable
              ? t('status.unavailable')
              : statusNotConfigured
                ? 'Authentication is not configured on this deployment.'
                : t('settings.auth.title')}
        </p>
        <form onSubmit={handleSubmit}>
          <input
            className="auth-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('settings.auth.password')}
          />
          {statusUnavailable ? <p className="auth-error">{t('status.unavailable')}</p> : null}
          {error ? <p className="auth-error">{error}</p> : null}
          <button className="welcome-btn" type="submit" disabled={checkingStatus || submitting || !password.trim()}>
            {checkingStatus ? t('status.connecting') : submitting ? t('status.connecting') : t('action.confirm')}
          </button>
        </form>
      </div>
    </div>
  );
}

export default LoginPage;
