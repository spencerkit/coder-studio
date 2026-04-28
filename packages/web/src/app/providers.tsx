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
  workspaceOrderAtom,
  workspacesLoadErrorAtom,
  workspacesLoadStateAtom,
  sessionsAtom,
  dispatchCommandAtom,
} from '../atoms';
import type { DispatchCommand } from '../atoms/connection';
import { authenticatedAtom } from '../atoms/ui';
import { gitStateAtomFamily } from '../atoms/git';
import { fileTreeStaleAtomFamily } from '../atoms/fs';
import { terminalMetaAtomFamily } from '../atoms/terminals';
import { WsClient, resolveWsUrl } from '../ws';
import type { EventListener, ConnectionStatus, TerminalBinaryPayload } from '../ws';
import {
  useSessionNotifications,
  appendSessionOutputAtom,
  clearSessionOutputAtom,
} from '../features/notifications';
import { stripAnsi } from '../features/notifications/format';
import { supervisorsAtom, supervisorCyclesAtom } from '../features/supervisor/atoms';
import type { Supervisor, SupervisorCycle } from '@coder-studio/core';
import type { Workspace, Session, GitStatus } from '@coder-studio/core';

/**
 * Module-level WebSocket client singleton.
 * Prevents duplicate connections in React StrictMode.
 */
let globalWsClient: WsClient | null = null;
let pendingDisconnectTimer: NodeJS.Timeout | null = null;

/**
 * Shared decoder for terminal output chunks. PTY data is a UTF-8 byte stream.
 * Decoding once-per-event is cheap, but keeping the TextDecoder around saves
 * allocations at high stream rates.
 */
const sessionOutputDecoder = new TextDecoder('utf-8', { fatal: false });
function decodeTerminalOutputBytes(chunk: Uint8Array): string {
  return sessionOutputDecoder.decode(chunk);
}

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
  const dispatch = useAtomValue(dispatchCommandAtom);

  useSessionNotifications();

  // Use refs to avoid stale closures in event handlers
  const wsClientRef = useRef<WsClient | null>(null);
  const dispatchRef = useRef<DispatchCommand>(dispatch);

  // Keep dispatchRef in sync
  useEffect(() => {
    dispatchRef.current = dispatch;
  }, [dispatch]);

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
      // Intercept fs.dirty to trigger git status refresh (debounced server-side)
      const fsMatch = topic.match(/^workspace\.([^.]+)\.fs\.dirty$/);
      if (fsMatch) {
        const wid = fsMatch[1]!;
        dispatchRef.current<GitStatus>('git.status', { workspaceId: wid }).then((result) => {
          if (result.ok && result.data) {
            store.set(gitStateAtomFamily(wid), result.data);
          }
        }).catch(() => {
          // Silently ignore - WS may be disconnected, next fs.dirty will retry
        });
      }
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
      const existing = store.get(workspacesAtom)[workspaceId];
      const shouldAcceptWorkspace = Boolean(existing || patch.path);

      if (!shouldAcceptWorkspace) {
        return;
      }

      store.set(workspacesAtom, (prev: Record<string, Workspace>) => ({
        ...prev,
        [workspaceId]: {
          ...prev[workspaceId],
          ...patch,
          id: workspaceId,
        } as Workspace,
      }));
      store.set(workspaceOrderAtom, (prev: string[]) => {
        if (prev.includes(workspaceId)) {
          return prev;
        }
        return [...prev, workspaceId];
      });
      store.set(workspacesLoadStateAtom, 'ready');
      store.set(workspacesLoadErrorAtom, null);
      return;
    }

    // workspace.{id}.fs.dirty - filesystem dirty state
    if (subtopic === 'fs.dirty') {
      // Server sends { reason: 'fs_change' } - any payload means dirty
      const atom = fileTreeStaleAtomFamily(workspaceId);
      store.set(atom, true);
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
        // Terminal panels render output directly into xterm.js. We skim a
        // copy here only when the terminal is bound to a known *agent* session,
        // so the notification engine can include a tail summary in its body.
        // Shell terminals (no session) are ignored to keep the buffer small.
        const data = payload as TerminalBinaryPayload;
        const bytes = data?.bytes;
        if (!bytes || !ArrayBuffer.isView(bytes) || bytes.byteLength === 0) return;
        const sessions = store.get(sessionsAtom);
        const session = Object.values(sessions).find((s) => s.terminalId === terminalId);
        if (!session) return;

        const decoded = decodeTerminalOutputBytes(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
        const cleaned = stripAnsi(decoded);
        if (cleaned) {
          store.set(appendSessionOutputAtom, {
            sessionId: session.id,
            text: cleaned,
          });
        }
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
        // Clean up the output tail buffer for the session this terminal belonged
        // to (if any). Avoids unbounded growth across long-lived browser tabs.
        const sessions = store.get(sessionsAtom);
        const session = Object.values(sessions).find((s) => s.terminalId === terminalId);
        if (session) {
          store.set(clearSessionOutputAtom, session.id);
        }
        return;
      }
    }
  }

  // Unknown topic - log for debugging
  console.log(`Unhandled event topic: ${topic}`, payload);
}
