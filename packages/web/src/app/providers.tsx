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
import type { EventListener, ConnectionStatus } from '../ws';
import { useSessionNotifications } from '../features/notifications';
import { supervisorsAtom, supervisorCyclesAtom } from '../features/supervisor/atoms';
import type { Supervisor, SupervisorCycle } from '@coder-studio/core';
import type { Workspace, Session, GitStatus } from '@coder-studio/core';

/**
 * Module-level WebSocket client singleton.
 * Prevents duplicate connections in React StrictMode.
 */
let globalWsClient: WsClient | null = null;
let pendingDisconnectTimer: NodeJS.Timeout | null = null;

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
  // Supervisor state atoms
  const setSupervisors = useSetAtom(supervisorsAtom);
  const setSupervisorCycles = useSetAtom(supervisorCyclesAtom);

  // Get Jotai store for writing to atomFamily atoms
  const store = useStore();

  useSessionNotifications();

  // Use refs to avoid stale closures in event handlers
  const wsClientRef = useRef<WsClient | null>(null);

  // Initialize theme from localStorage
  useEffect(() => {
    const savedTheme = localStorage.getItem('ui.theme');
    if (savedTheme) {
      try {
        const theme = JSON.parse(savedTheme);
        if (theme === 'light' || theme === 'dark') {
          document.documentElement.setAttribute('data-theme', theme);
        }
      } catch {
        // Ignore parse errors
      }
    }
  }, []);

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

    // Subscribe to connection status changes
    const handleStatusChange = (status: ConnectionStatus) => {
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
    };

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

    // Reuse existing WebSocket client if available (StrictMode safety)
    // Cancel any pending disconnect from StrictMode cleanup
    if (pendingDisconnectTimer) {
      clearTimeout(pendingDisconnectTimer);
      pendingDisconnectTimer = null;
    }

    if (globalWsClient) {
      wsClientRef.current = globalWsClient;
      setWsClient(globalWsClient);

      // Re-establish subscriptions for this mount
      const unsubscribeStatus = globalWsClient.onStatus(handleStatusChange);
      const unsubscribeEvents = globalWsClient.subscribe(topics, handleEvent);

      return () => {
        unsubscribeStatus();
        unsubscribeEvents();
        wsClientRef.current = null;
        // Deferred disconnect: wait 50ms to see if StrictMode remounts
        if (globalWsClient) {
          pendingDisconnectTimer = setTimeout(() => {
            if (globalWsClient) {
              globalWsClient.disconnect('app_unmount');
              globalWsClient = null;
            }
            pendingDisconnectTimer = null;
          }, 50);
        }
      };
    }

    // Create new WebSocket client singleton
    const client = new WsClient(resolveWsUrl());
    globalWsClient = client;
    wsClientRef.current = client;
    setWsClient(client);

    // Subscribe to connection status changes
    const unsubscribeStatus = client.onStatus(handleStatusChange);

    // Subscribe to events
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
      wsClientRef.current = null;
      // Deferred disconnect: wait 50ms to see if StrictMode remounts
      pendingDisconnectTimer = setTimeout(() => {
        if (globalWsClient) {
          globalWsClient.disconnect('app_unmount');
          globalWsClient = null;
        }
        pendingDisconnectTimer = null;
      }, 50);
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
    setSupervisors,
    setSupervisorCycles,
    store,
  ]);

  return <>{children}</>;
}

/**
 * Route incoming WebSocket events to appropriate Jotai atoms
 */
export function routeEventToAtom(
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
      const patch = payload as Partial<Workspace>;
      store.set(workspacesAtom, (prev: Record<string, Workspace>) => {
        const existing = prev[workspaceId];

        if (!existing && !patch.path) {
          return prev;
        }

        return {
          ...prev,
          [workspaceId]: {
            ...existing,
            ...patch,
            id: workspaceId,
          } as Workspace,
        };
      });
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

      // workspace.{id}.session.{sessionId}.supervisor.state
      if (sessionSubtopic === 'supervisor.state') {
        const data = payload as { supervisor?: Supervisor; supervisorId?: string; event: string };
        if (data.event === 'deleted' && data.supervisorId) {
          store.set(supervisorsAtom, (prev: Map<string, Supervisor>) => {
            const next = new Map(prev);
            // Find and remove by supervisor ID
            for (const [sessId, sup] of next.entries()) {
              if (sup.id === data.supervisorId) {
                next.delete(sessId);
                break;
              }
            }
            return next;
          });
          store.set(supervisorCyclesAtom, (prev: Map<string, SupervisorCycle[]>) => {
            const next = new Map(prev);
            next.delete(data.supervisorId!);
            return next;
          });
        } else if (data.supervisor) {
          store.set(supervisorsAtom, (prev: Map<string, Supervisor>) => {
            const next = new Map(prev);
            next.set(data.supervisor.sessionId, data.supervisor);
            return next;
          });
          if (Array.isArray(data.supervisor.cycles)) {
            store.set(supervisorCyclesAtom, (prev: Map<string, SupervisorCycle[]>) => {
              const next = new Map(prev);
              next.set(data.supervisor!.id, data.supervisor!.cycles);
              return next;
            });
          }
        }
        return;
      }

      // workspace.{id}.session.{sessionId}.supervisor.cycle
      if (sessionSubtopic === 'supervisor.cycle') {
        const data = payload as { cycle: SupervisorCycle; event: string };
        const supervisorId = data.cycle.supervisorId;
        store.set(supervisorCyclesAtom, (prev: Map<string, SupervisorCycle[]>) => {
          const next = new Map(prev);
          const cycles = next.get(supervisorId) ?? [];
          const deduped = cycles.filter((cycle) => cycle.id !== data.cycle.id);
          next.set(supervisorId, [data.cycle, ...deduped].slice(0, 20));
          return next;
        });
        return;
      }
    }

    // workspace.{id}.terminal.{terminalId}.{type}
    const terminalMatch = subtopic.match(/^terminal\.([^.]+)\.(.+)$/);
    if (terminalMatch) {
      const terminalId = terminalMatch[1]!;
      const terminalSubtopic = terminalMatch[2]!;

      // workspace.{id}.terminal.{terminalId}.created
      if (terminalSubtopic === 'created') {
        const data = payload as { id: string; kind: string; title?: string; cwd?: string };
        const atom = terminalMetaAtomFamily(terminalId);
        store.set(atom, {
          id: data.id,
          workspaceId,
          kind: data.kind as 'agent' | 'shell',
          alive: true,
          title: data.title,
        });
        return;
      }

      // workspace.{id}.terminal.{terminalId}.output
      if (terminalSubtopic === 'output') {
        // Terminal output is typically handled by the terminal component itself
        // We'll skip storing it in global state for now
        return;
      }

     // workspace.{id}.terminal.{terminalId}.exit
     if (terminalSubtopic === 'exit') {
        const data = payload as { code: number };
        const atom = terminalMetaAtomFamily(terminalId);
        const current = store.get(atom);
        if (current) {
          store.set(atom, {
            ...current,
            exitCode: data.code,
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
