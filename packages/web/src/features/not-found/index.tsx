import { useLocation, useNavigate } from "react-router-dom";
import { EmptyState } from "../../components/ui";
import { useViewport } from "../../hooks/use-viewport";
import { useTranslation } from "../../lib/i18n";

const notFoundEmptyStateStyle = {
  minHeight: "auto",
  padding: 0,
  gap: "var(--sp-5)",
};

export function NotFoundPage() {
  const t = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useViewport() === "mobile";

  return (
    <div className={`welcome-container ${isMobile ? "welcome-container--mobile" : ""}`}>
      <div className={`welcome-card ${isMobile ? "welcome-card--mobile" : ""}`}>
        <EmptyState
          style={notFoundEmptyStateStyle}
          title={
            <div>
              <div className="welcome-kicker">{t("not_found.kicker")}</div>
              <h1 className="welcome-title">{t("not_found.title")}</h1>
            </div>
          }
          description={
            <div className="welcome-content">
              <p className="welcome-body">{t("not_found.description")}</p>
            </div>
          }
          action={
            <button className="welcome-btn" onClick={() => navigate("/")}>
              <span>{t("not_found.go_home")}</span>
            </button>
          }
        />
        <div className="auth-status-panel">
          <div className="auth-status-eyebrow">{t("not_found.path_label")}</div>
          <p className="auth-status-detail">{location.pathname}</p>
        </div>
      </div>
    </div>
  );
}

export default NotFoundPage;
