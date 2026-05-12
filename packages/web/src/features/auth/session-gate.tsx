import { useAtomValue } from "jotai";
import { useState } from "react";
import { authEnabledAtom } from "../../atoms/connection";
import { Button, EmptyState } from "../../components/ui";
import { useActivation } from "../../hooks/use-activation";
import { useViewport } from "../../hooks/use-viewport";
import { useTranslation } from "../../lib/i18n";
import { LoginPage } from "./index";

const gateEmptyStateStyle = {
  minHeight: "auto",
  padding: 0,
  gap: "var(--sp-5)",
  alignItems: "stretch",
  textAlign: "left" as const,
};

export function SessionGatePage({ requestReentry }: { requestReentry?: () => Promise<boolean> }) {
  const t = useTranslation();
  const authEnabled = useAtomValue(authEnabledAtom);
  const { claim } = useActivation();
  const isMobile = useViewport() === "mobile";
  const [submitting, setSubmitting] = useState(false);

  const handleReentry = async () => {
    setSubmitting(true);
    try {
      const ok = requestReentry ? await requestReentry() : await claim();
      if (ok) {
        window.location.replace("/");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (authEnabled === true) {
    return <LoginPage onAuthenticated={handleReentry} />;
  }

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
          disabled={submitting}
          onClick={() => void handleReentry()}
        >
          {submitting ? t("auth.session_gate_reentering") : t("auth.session_gate_reenter")}
        </Button>
      </div>
    </div>
  );
}
