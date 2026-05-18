import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";
import { activationReasonAtom, activationStatusAtom } from "../../atoms/activation";
import { connectionStatusAtom, lastReconnectAttemptAtom } from "../../atoms/connection";
import { useViewport } from "../../components/ui/_internal/use-viewport";

const SLOW_RECOVERY_HINT_MS = 25_000;
const SLOW_RECOVERY_HINT_TEXT = "连接恢复较慢，可能是网络问题。如果长时间没有恢复，可以刷新页面。";
const SLOW_RECOVERY_HINT_TEXT_MOBILE = "连接恢复较慢，长时间未恢复可刷新页面。";

export function ConnectionStatusBanner() {
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
        <span>另一个标签页已激活</span>
      </div>
    );
  }

  const showSlowRecoveryHint =
    lastReconnectAttempt !== null &&
    now - lastReconnectAttempt >= SLOW_RECOVERY_HINT_MS &&
    (connectionStatus === "reconnecting" || connectionStatus === "disconnected");
  const stacked = showSlowRecoveryHint && isMobile;
  const slowRecoveryHintText = isMobile ? SLOW_RECOVERY_HINT_TEXT_MOBILE : SLOW_RECOVERY_HINT_TEXT;
  const className = [
    "connection-banner",
    isMobile ? "connection-banner--mobile" : null,
    stacked ? "connection-banner--stacked" : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className} role="status" aria-live="polite">
      <span className="connection-banner__primary">连接已断开，正在重新连接...</span>
      {showSlowRecoveryHint ? (
        <span className="connection-banner__hint">{slowRecoveryHintText}</span>
      ) : null}
    </div>
  );
}
