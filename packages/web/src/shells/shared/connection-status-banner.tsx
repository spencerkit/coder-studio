import { useAtomValue } from "jotai";
import { connectionStatusAtom } from "../../atoms/connection";

export function ConnectionStatusBanner() {
  const connectionStatus = useAtomValue(connectionStatusAtom);

  if (connectionStatus === "connected" || connectionStatus === "connecting") {
    return null;
  }

  if (connectionStatus === "reconnecting") {
    return (
      <div className="connection-banner" role="status" aria-live="polite">
        <span>正在重新连接...</span>
      </div>
    );
  }

  return (
    <div className="connection-banner connection-banner--error" role="status" aria-live="polite">
      <span>{connectionStatus === "rejected" ? "另一个标签页已激活" : "连接已断开"}</span>
    </div>
  );
}
