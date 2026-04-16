import { useEffect, useCallback } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { wsClientAtom } from '../atoms/connection';
import { tabIdAtom, fencingStateAtom, type FencingState } from '../atoms/fencing';

const VISIBLE_HEARTBEAT_MS = 10000;
const HIDDEN_HEARTBEAT_MS = 20000;

export function useFencing(workspaceId: string | null) {
  const wsClient = useAtomValue(wsClientAtom);
  const tabId = useAtomValue(tabIdAtom);
  const setFencingState = useSetAtom(fencingStateAtom);

  const requestControl = useCallback(async () => {
    if (!wsClient || !workspaceId) return;

    try {
      const result = await wsClient.sendCommand<{
        isController: boolean;
        reason?: string;
      }>('fencing.request', { workspaceId, tabId });

      setFencingState((prev) => {
        const next = new Map(prev);
        next.set(workspaceId, {
          isController: result.isController,
          reason: result.reason as FencingState['reason'],
          tabId,
          lastHeartbeat: Date.now(),
        });
        return next;
      });
    } catch (error) {
      console.error('Failed to request fencing control:', error);
    }
  }, [wsClient, workspaceId, tabId, setFencingState]);

  const sendHeartbeat = useCallback(async () => {
    if (!wsClient || !workspaceId) return;

    try {
      await wsClient.sendCommand('fencing.heartbeat', { workspaceId });
      setFencingState((prev) => {
        const next = new Map(prev);
        const existing = next.get(workspaceId);
        if (existing) {
          next.set(workspaceId, { ...existing, lastHeartbeat: Date.now() });
        }
        return next;
      });
    } catch (error) {
      console.error('Failed to send heartbeat:', error);
    }
  }, [wsClient, workspaceId, setFencingState]);

  const requestTakeover = useCallback(async () => {
    if (!wsClient || !workspaceId) return false;

    try {
      const result = await wsClient.sendCommand<{ success: boolean }>(
        'fencing.takeover',
        { workspaceId, tabId }
      );
      if (result.success) {
        setFencingState((prev) => {
          const next = new Map(prev);
          next.set(workspaceId, {
            isController: true,
            tabId,
            lastHeartbeat: Date.now(),
          });
          return next;
        });
      }
      return result.success;
    } catch (error) {
      console.error('Failed to takeover:', error);
      return false;
    }
  }, [wsClient, workspaceId, tabId, setFencingState]);

  // Request control on mount
  useEffect(() => {
    requestControl();
  }, [requestControl]);

  // Heartbeat timer
  useEffect(() => {
    if (!workspaceId) return;

    const getInterval = () =>
      document.hidden ? HIDDEN_HEARTBEAT_MS : VISIBLE_HEARTBEAT_MS;

    let timer = setInterval(sendHeartbeat, getInterval());

    const handleVisibilityChange = () => {
      clearInterval(timer);
      timer = setInterval(sendHeartbeat, getInterval());
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [workspaceId, sendHeartbeat]);

  // Release on unmount
  useEffect(() => {
    return () => {
      if (wsClient && workspaceId) {
        wsClient.sendCommand('fencing.release', { workspaceId }).catch(() => {});
      }
    };
  }, [wsClient, workspaceId]);

  return { requestControl, sendHeartbeat, requestTakeover };
}
