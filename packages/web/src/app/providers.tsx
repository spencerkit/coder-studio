/**
 * Application Providers
 *
 * Initializes WebSocket connection and sets up event routing.
 * Manages connection lifecycle and maps WS events to Jotai atoms.
 */

import { useEffect, useRef } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import { useStore } from 'jotai';
import {
  wsClientAtom,
  connectionStatusAtom,
  connectionErrorAtom,
  serverInfoAtom,
  authEnabledAtom,
  reconnectAttemptCountAtom,
  lastReconnectAttemptAtom,
  isWriterAtom,
  workspacesAtom,
  sessionsAtom,
} from '../atoms';
import { authenticatedAtom } from '../atoms/ui';
import { gitStateAtomFamily } from '../atoms/git';
import { fileTreeStaleAtomFamily } from '../atoms/fs';
import { terminalMetaAtomFamily } from '../atoms/terminals';
import { WsClient, resolveWsUrl } from '../ws';
import type { EventListener } from '../ws';
import type { Workspace, Session, GitStatus } from '@coder-studio/core';

interface AppProvidersProps {
  children: React.ReactNode;
}

export function AppProviders({ children }: AppProvidersProps) {
  const [, setWsClient] = useAtom(wsClientAtom);
  const setConnectionStatus = useSetAtom(connectionStatusAtom);
  const setConnectionError = useSetAtom(connectionErrorAtom);
  const setServerInfo = useSetAtom(serverInfoAtom);
  const setAuthEnabled = useSetAtom(authEnabledAtom);
  const setReconnectCount = useSetAtom(reconnectAttemptCountAtom);
  const setLastReconnect = useSetAtom(lastReconnectAttemptAtom);
  const setIsWriter = useSetAtom(isWriterAtom);

  // Server state atoms
  const setWorkspaces = useSetAtom(workspacesAtom);
  const setSessions = useSetAtom(sessionsAtom);

  // Get Jotai store for writing to atomFamily atoms
  const store = useStore();

  // Use refs to avoid stale closures in event handlers
  const wsClientRef = useRef<WsClient | null>(null);

  useEffect(() => {
    const loadAuthStatus = async () => {
      try {
        const response = await fetch('/auth/status');
        const data = await response.json();
        setAuthEnabled(Boolean(data.authEnabled));
        if (data.authEnabled === false) {
          store.set(authenticatedAtom, true);
        }
      } catch {
        setAuthEnabled(false);
      }
    };

    void loadAuthStatus();

    // Create WebSocket client singleton
    const client = new WsClient(resolveWsUrl());
    wsClientRef.current = client;
    setWsClient(client);

    // Subscribe to connection status changes
    const unsubscribeStatus = client.onStatus((status) => {
      setConnectionStatus(status);

      // Track reconnect attempts
      if (status === 'reconnecting') {
        setReconnectCount((count) => count + 1);
        setLastReconnect(Date.now());
      }

      // Reset writer status on disconnect
      if (status === 'disconnected' || status === 'rejected') {
        setIsWriter(false);
      }
    });

    // Event handler: route WS events to atoms
    const handleEvent: EventListener = (topic: string, payload: unknown, _seq: number) => {
      try {
        routeEventToAtom(topic, payload, store);
      } catch (err) {
        console.error(`Error handling event for topic ${topic}:`, err);
      }
    };

    // Subscribe to all topics we care about
    const topics = [
      'connection.*',          // Connection-level events
      'workspace.*',           // All workspace events (glob pattern)
    ];

    const unsubscribeEvents = client.subscribe(topics, handleEvent);

    // Connect to server
    client.connect().catch((err) => {
      console.error('Failed to connect WebSocket:', err);
      setConnectionError(err.message || 'Connection failed');
    });

    // Cleanup on unmount
    return () => {
      unsubscribeStatus();
      unsubscribeEvents();
      client.disconnect('app_unmount');
      wsClientRef.current = null;
    };
  }, [
    setWsClient,
    setConnectionStatus,
    setConnectionError,
    setServerInfo,
    setAuthEnabled,
    setReconnectCount,
    setLastReconnect,
    setIsWriter,
    setWorkspaces,
    setSessions,
    store,
  ]);

  return <>{children}</>;
}

/**
 * Route incoming WebSocket events to appropriate Jotai atoms
 */
function routeEventToAtom(
  topic: string,
  payload: unknown,
  store: ReturnType<typeof useStore>
): void {
  // Parse topic to determine event type
  // Topic format: workspace.{id}.session.{sessionId}.state
  // or: connection.ready

  if (topic === 'connection.ready') {
    // Server metadata on connect
    const data = payload as { version: string; serverInstanceId: string; isWriter: boolean };
    store.set(serverInfoAtom, {
      version: data.version,
      serverInstanceId: data.serverInstanceId,
    });
    store.set(isWriterAtom, data.isWriter);
    store.set(connectionErrorAtom, null);
    return;
  }

  if (topic === 'connection.status') {
    // Connection-level status event
    const data = payload as { status: string; message?: string; authEnabled?: boolean };
    if (data.status === 'connected' && data.authEnabled === false) {
      store.set(authenticatedAtom, true);
    }
    if (data.status === 'error' && data.message) {
      store.set(connectionErrorAtom, data.message);
    }
    return;
  }

  // Workspace-level events: workspace.{id}.{subtopic}
  const workspaceMatch = topic.match(/^workspace\.([^.]+)\.(.+)$/);
  if (workspaceMatch) {
    const workspaceId = workspaceMatch[1]!;
    const subtopic = workspaceMatch[2]!;

    // workspace.{id}.meta - workspace metadata update
    if (subtopic === 'meta') {
      const workspace = payload as Workspace;
      store.set(workspacesAtom, (prev: Record<string, Workspace>) => ({
        ...prev,
        [workspace.id]: workspace,
      }));
      return;
    }

    // workspace.{id}.fs.dirty - filesystem dirty state
    if (subtopic === 'fs.dirty') {
      const data = payload as { dirty: boolean };
      const atom = fileTreeStaleAtomFamily(workspaceId);
      store.set(atom, data.dirty);
      return;
    }

    // workspace.{id}.git.state - git state update
    if (subtopic === 'git.state') {
      const gitState = payload as GitStatus;
      const atom = gitStateAtomFamily(workspaceId);
      store.set(atom, gitState);
      return;
    }

    // workspace.{id}.session.{sessionId}.{type}
    const sessionMatch = subtopic.match(/^session\.([^.]+)\.(.+)$/);
    if (sessionMatch) {
      const sessionId = sessionMatch[1]!;
      const sessionSubtopic = sessionMatch[2]!;

      // workspace.{id}.session.{sessionId}.state
      if (sessionSubtopic === 'state') {
        const session = payload as Session;
        store.set(sessionsAtom, (prev: Record<string, Session>) => ({
          ...prev,
          [session.id]: session,
        }));
        return;
      }

      // workspace.{id}.session.{sessionId}.progress
      if (sessionSubtopic === 'progress') {
        // Progress updates can be handled separately if needed
        // For now, we'll just log them
        console.log(`Session ${sessionId} progress:`, payload);
        return;
      }
    }

    // workspace.{id}.terminal.{terminalId}.{type}
    const terminalMatch = subtopic.match(/^terminal\.([^.]+)\.(.+)$/);
    if (terminalMatch) {
      const terminalId = terminalMatch[1]!;
      const terminalSubtopic = terminalMatch[2]!;

      // workspace.{id}.terminal.{terminalId}.output
      if (terminalSubtopic === 'output') {
        // Terminal output is typically handled by the terminal component itself
        // We'll skip storing it in global state for now
        return;
      }

      // workspace.{id}.terminal.{terminalId}.exit
      if (terminalSubtopic === 'exit') {
        const data = payload as { exitCode: number };
        const atom = terminalMetaAtomFamily(terminalId);
        const current = store.get(atom);
        if (current) {
          store.set(atom, {
            ...current,
            exitCode: data.exitCode,
            alive: false,
          });
        }
        return;
      }
    }
  }

  // Unknown topic - log for debugging
  console.log(`Unhandled event topic: ${topic}`, payload);
}
