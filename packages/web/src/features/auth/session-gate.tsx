import { Button, EmptyState } from "../../components/ui";
import { useViewport } from "../../hooks/use-viewport";
import { useTranslation } from "../../lib/i18n";

const gateEmptyStateStyle = {
  minHeight: "auto",
  padding: 0,
  gap: "var(--sp-5)",
  alignItems: "stretch",
  textAlign: "left" as const,
};

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
        <EmptyState
          style={gateEmptyStateStyle}
          title={
            <div>
              <div className="welcome-kicker">{t("auth.session_gate_title")}</div>
              <h1 className="welcome-title">{t("app.name")}</h1>
            </div>
          }
          description={
            <p className="welcome-body auth-card-desc">{t("auth.session_gate_description")}</p>
          }
        />
        <div className="auth-status-panel auth-status-panel-error">
          <div className="auth-status-eyebrow">{t("auth.status_title")}</div>
          <p className="auth-status-detail">{t("auth.session_gate_detail")}</p>
        </div>
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
  );
}
