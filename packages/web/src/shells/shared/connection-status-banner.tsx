import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";
import { activationReasonAtom, activationStatusAtom } from "../../atoms/activation";
import { connectionStatusAtom, lastReconnectAttemptAtom } from "../../atoms/connection";

const SLOW_RECOVERY_HINT_MS = 25_000;

export function ConnectionStatusBanner() {
  const activationStatus = useAtomValue(activationStatusAtom);
  const activationReason = useAtomValue(activationReasonAtom);
  const connectionStatus = useAtomValue(connectionStatusAtom);
  const lastReconnectAttempt = useAtomValue(lastReconnectAttemptAtom);
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
      <div className="connection-banner connection-banner--error" role="status" aria-live="polite">
        <span>另一个标签页已激活</span>
      </div>
    );
  }

  const showSlowRecoveryHint =
    lastReconnectAttempt !== null &&
    now - lastReconnectAttempt >= SLOW_RECOVERY_HINT_MS &&
    (connectionStatus === "reconnecting" || connectionStatus === "disconnected");

  return (
    <div className="connection-banner" role="status" aria-live="polite">
      <span>连接已断开，正在重新连接...</span>
      {showSlowRecoveryHint ? (
        <span>连接恢复较慢，可能是网络问题。如果长时间没有恢复，可以刷新页面。</span>
      ) : null}
    </div>
  );
}
