import { useLocation, useNavigate } from 'react-router-dom';
import { useViewport } from '../../hooks/use-viewport';
import { useTranslation } from '../../lib/i18n';

export function NotFoundPage() {
  const t = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useViewport() === 'mobile';

  return (
    <div className={`welcome-container ${isMobile ? 'welcome-container--mobile' : ''}`}>
      <div className={`welcome-card ${isMobile ? 'welcome-card--mobile' : ''}`}>
        <div className="welcome-kicker">{t('not_found.kicker')}</div>
        <h1 className="welcome-title">{t('not_found.title')}</h1>
        <p className="welcome-body">{t('not_found.description')}</p>
        <div className="auth-status-panel">
          <div className="auth-status-eyebrow">{t('not_found.path_label')}</div>
          <p className="auth-status-detail">{location.pathname}</p>
        </div>
        <button className="welcome-btn" onClick={() => navigate('/')}>
          <span>{t('not_found.go_home')}</span>
        </button>
      </div>
    </div>
  );
}

export default NotFoundPage;
