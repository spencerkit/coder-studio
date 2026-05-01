import { useEffect, useRef } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useLocation, useNavigate } from 'react-router-dom';
import { authEnabledAtom, connectionStatusAtom, dispatchCommandAtom } from '../../atoms';
import { authenticatedAtom } from '../../atoms/ui';
import {
  orderedWorkspacesAtom,
  workspaceOrderAtom,
  workspacesAtom,
  workspacesLoadErrorAtom,
  workspacesLoadStateAtom,
} from '../../atoms/workspaces';
import type { Workspace } from '@coder-studio/core';

export function useWorkspaceBootstrap() {
  const bootstrapRequestIdRef = useRef(0);
  const navigate = useNavigate();
  const location = useLocation();
  const connectionStatus = useAtomValue(connectionStatusAtom);
  const dispatch = useAtomValue(dispatchCommandAtom);
  const workspaces = useAtomValue(orderedWorkspacesAtom);
  const authenticated = useAtomValue(authenticatedAtom);
  const authEnabled = useAtomValue(authEnabledAtom);
  const workspacesLoadState = useAtomValue(workspacesLoadStateAtom);
  const setWorkspaces = useSetAtom(workspacesAtom);
  const setWorkspaceOrder = useSetAtom(workspaceOrderAtom);
  const setWorkspacesLoadState = useSetAtom(workspacesLoadStateAtom);
  const setWorkspacesLoadError = useSetAtom(workspacesLoadErrorAtom);

  useEffect(() => {
    if (authEnabled === null) {
      return;
    }

    const authRequired = authEnabled === true;
    if (authRequired && !authenticated) {
      if (location.pathname !== '/auth') {
        navigate('/auth', { replace: true });
      }
      return;
    }

    if (location.pathname === '/auth') {
      navigate('/', { replace: true });
      return;
    }

    if (location.pathname !== '/' && location.pathname !== '/workspace') {
      return;
    }

    if (workspacesLoadState === 'idle') {
      if (connectionStatus !== 'connected') {
        return;
      }

      const requestId = bootstrapRequestIdRef.current + 1;
      bootstrapRequestIdRef.current = requestId;

      setWorkspacesLoadState('loading');
      setWorkspacesLoadError(null);

      dispatch<Workspace[]>('workspace.list', {})
        .then((result) => {
          if (bootstrapRequestIdRef.current !== requestId) {
            return;
          }

          if (!result.ok) {
            setWorkspacesLoadState('error');
            setWorkspacesLoadError(result.error?.message ?? 'Failed to fetch workspace list');
            return;
          }

          const nextWorkspaces = Array.isArray(result.data) ? result.data : [];
          const wsMap: Record<string, Workspace> = {};
          for (const workspace of nextWorkspaces) {
            wsMap[workspace.id] = workspace;
          }

          setWorkspaces(wsMap);
          setWorkspaceOrder(nextWorkspaces.map((workspace) => workspace.id));
          setWorkspacesLoadState('ready');
          setWorkspacesLoadError(null);
        })
        .catch((error) => {
          if (bootstrapRequestIdRef.current !== requestId) {
            return;
          }
          setWorkspacesLoadState('error');
          setWorkspacesLoadError(error instanceof Error ? error.message : 'Failed to fetch workspace list');
        });
      return;
    }

    if (workspacesLoadState !== 'ready') {
      return;
    }

    if (location.pathname === '/' && workspaces.length > 0) {
      navigate('/workspace', { replace: true });
      return;
    }

    if (location.pathname === '/workspace' && workspaces.length === 0) {
      navigate('/', { replace: true });
    }
  }, [
    authEnabled,
    authenticated,
    connectionStatus,
    dispatch,
    location.pathname,
    navigate,
    setWorkspaceOrder,
    setWorkspaces,
    setWorkspacesLoadError,
    setWorkspacesLoadState,
    workspaces.length,
    workspacesLoadState,
  ]);
}
