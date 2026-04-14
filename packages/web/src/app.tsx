/**
 * Application Shell
 *
 * Root component that sets up:
 * - WebSocket connection
 * - Router
 * - Global providers
 */

import { useEffect } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
  wsClientAtom,
  connectionStatusAtom,
  ConnectionStatus,
} from './atoms';
import { WsClient, resolveWsUrl } from './ws/client';

function App() {
  const [wsClient, setWsClient] = useAtom(wsClientAtom);
  const setConnectionStatus = useSetAtom(connectionStatusAtom);

  useEffect(() => {
    // Create WebSocket client singleton
    const client = new WsClient(resolveWsUrl());
    setWsClient(client);

    // Subscribe to connection status
    const unsubscribe = client.onStatus((status: ConnectionStatus) => {
      setConnectionStatus(status);
    });

    // Connect
    client.connect().catch((err) => {
      console.error('Failed to connect WebSocket:', err);
    });

    return () => {
      unsubscribe();
      client.disconnect('app_unmount');
    };
  }, [setWsClient, setConnectionStatus]);

  const connectionStatus = useAtomValue(connectionStatusAtom);

  return (
    <div className="app">
      {/* Connection status indicator */}
      {connectionStatus === 'reconnecting' && (
        <div className="connection-banner">
          <span>正在重新连接...</span>
        </div>
      )}
      {connectionStatus === 'rejected' && (
        <div className="connection-banner connection-banner--error">
          <span>另一个标签页已激活</span>
        </div>
      )}

      {/* Main content - placeholder until router is implemented */}
      <main className="main-content">
        <div className="welcome-container">
          <h1>Coder Studio</h1>
          <p>Agent-First Development Environment</p>
          <p className="text-secondary">Phase 1 - Web Core Layer</p>
          <p className="text-tertiary">
            Connection Status: {connectionStatus}
          </p>
        </div>
      </main>
    </div>
  );
}

export default App;