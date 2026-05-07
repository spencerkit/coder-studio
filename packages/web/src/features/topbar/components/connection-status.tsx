/**
 * Connection Status Component
 *
 * Shows WebSocket connection status in the topbar.
 */

import { useAtomValue } from "jotai";
import type { FC } from "react";
import { connectionStatusAtom } from "../../../atoms/connection";
import { StatusDot } from "../../../components/ui";
import { useTranslation } from "../../../lib/i18n";

/**
 * Connection Status Indicator
 *
 * PRD §5.1.4: Shows connection state in topbar
 * States: connecting | connected | disconnected | reconnecting
 */
export const ConnectionStatus: FC = () => {
  const t = useTranslation();
  const status = useAtomValue(connectionStatusAtom);

  if (status === "connected") {
    return null;
  }

  const statusClass = `connection-status-${status}`;
  const dotClass = `connection-status-dot connection-status-dot-${status}`;

  return (
    <div
      className={`connection-status ${statusClass}`}
      title={t(`status.${status}`)}
      aria-label={t(`status.${status}`)}
    >
      <StatusDot
        tone={getConnectionStatusTone(status)}
        size="sm"
        pulse={shouldPulseConnectionStatus(status)}
        className={dotClass}
      />
      <span className="connection-status-text">{t(`status.${status}`)}</span>
    </div>
  );
};

export default ConnectionStatus;

function getConnectionStatusTone(
  status: "connected" | "connecting" | "disconnected" | "reconnecting"
): "success" | "warning" | "error" {
  switch (status) {
    case "connected":
      return "success";
    case "disconnected":
      return "error";
    default:
      return "warning";
  }
}

function shouldPulseConnectionStatus(
  status: "connected" | "connecting" | "disconnected" | "reconnecting"
) {
  switch (status) {
    case "connecting":
    case "reconnecting":
      return true;
    default:
      return false;
  }
}
