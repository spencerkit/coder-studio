/**
 * Connection Status Component
 *
 * Shows WebSocket connection status in the topbar.
 */

import type { FC } from 'react';
import { useAtomValue } from 'jotai';
import { connectionStatusAtom } from '../../../atoms/connection';
import { useTranslation } from '../../../lib/i18n';

/**
 * Connection Status Indicator
 *
 * PRD §5.1.4: Shows connection state in topbar
 * States: connecting | connected | disconnected | reconnecting
 */
export const ConnectionStatus: FC = () => {
  const t = useTranslation();
  const status = useAtomValue(connectionStatusAtom);

  if (status === 'connected') {
    return null;
  }

  const statusClass = `connection-status-${status}`;

  return (
    <div
      className={`connection-status ${statusClass}`}
      title={t(`status.${status}`)}
      aria-label={t(`status.${status}`)}
    >
      <span className={`connection-status-dot connection-status-dot-${status}`} />
      <span className="connection-status-text">{t(`status.${status}`)}</span>
    </div>
  );
};

export default ConnectionStatus;
