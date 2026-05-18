import { Button } from "../../components/ui";
import { useViewport } from "../../hooks/use-viewport";
import { useTranslation } from "../../lib/i18n";

export function SessionGatePage() {
  const t = useTranslation();
  const isMobile = useViewport() === "mobile";

  return (
    <div
      className={[
        "welcome-container",
        "auth-screen",
        isMobile ? "welcome-container--mobile auth-screen--mobile" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div
        className={[
          "welcome-card",
          "auth-card-shell",
          isMobile ? "welcome-card--mobile auth-card-shell--mobile" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div className="auth-card-shell__content">
          <section className="auth-hero">
            <div className="welcome-kicker page-kicker">{t("auth.session_gate_title")}</div>
            <h1 className="welcome-title page-title">{t("app.name")}</h1>
            <p className="welcome-body auth-card-desc meta-text">
              {t("auth.session_gate_description")}
            </p>
          </section>
          <section className="auth-status-panel auth-status-panel-error">
            <div className="auth-status-eyebrow">{t("auth.status_title")}</div>
            <p className="auth-status-detail">{t("auth.session_gate_detail")}</p>
          </section>
          <div className="auth-actions">
            <Button
              className="auth-submit"
              variant="primary"
              size="lg"
              type="button"
              onClick={() => window.location.replace("/")}
            >
              {t("auth.session_gate_reenter")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
