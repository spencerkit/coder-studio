import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";
import { activationReasonAtom, activationStatusAtom } from "../../atoms/activation";
import { connectionStatusAtom, lastReconnectAttemptAtom } from "../../atoms/connection";
import { useViewport } from "../../components/ui/_internal/use-viewport";
import { useTranslation } from "../../lib/i18n";

const SLOW_RECOVERY_HINT_MS = 25_000;

export function ConnectionStatusBanner() {
  const t = useTranslation();
  const activationStatus = useAtomValue(activationStatusAtom);
  const activationReason = useAtomValue(activationReasonAtom);
  const connectionStatus = useAtomValue(connectionStatusAtom);
  const lastReconnectAttempt = useAtomValue(lastReconnectAttemptAtom);
  const viewport = useViewport();
  const isMobile = viewport === "mobile";
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (
      lastReconnectAttempt === null ||
      (connectionStatus !== "reconnecting" && connectionStatus !== "disconnected")
    ) {
      return;
    }

    const remainingMs = lastReconnectAttempt + SLOW_RECOVERY_HINT_MS - Date.now();
    if (remainingMs <= 0) {
      setNow(Date.now());
      return;
    }

    const timer = setTimeout(() => {
      setNow(Date.now());
    }, remainingMs);

    return () => {
      clearTimeout(timer);
    };
  }, [connectionStatus, lastReconnectAttempt]);

  if (connectionStatus === "connected" || connectionStatus === "connecting") {
    return null;
  }

  if (
    connectionStatus === "rejected" ||
    (activationStatus === "gated" && activationReason === "displaced")
  ) {
    return (
      <div
        className={`connection-banner${isMobile ? " connection-banner--mobile" : ""} connection-banner--error`}
        role="status"
        aria-live="polite"
      >
        <span>{t("connection.another_tab_activated")}</span>
      </div>
    );
  }

  const showSlowRecoveryHint =
    lastReconnectAttempt !== null &&
    now - lastReconnectAttempt >= SLOW_RECOVERY_HINT_MS &&
    (connectionStatus === "reconnecting" || connectionStatus === "disconnected");
  const stacked = showSlowRecoveryHint && isMobile;
  const slowRecoveryHintText = isMobile
    ? t("connection.slow_recovery_hint_mobile")
    : t("connection.slow_recovery_hint");
  const className = [
    "connection-banner",
    isMobile ? "connection-banner--mobile" : null,
    stacked ? "connection-banner--stacked" : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className} role="status" aria-live="polite">
      <span className="connection-banner__primary">{t("connection.reconnecting_banner")}</span>
      {showSlowRecoveryHint ? (
        <span className="connection-banner__hint">{slowRecoveryHintText}</span>
      ) : null}
    </div>
  );
}
