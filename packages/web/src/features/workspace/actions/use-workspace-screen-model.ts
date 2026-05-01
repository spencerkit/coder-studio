import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAtomValue, useSetAtom, useStore } from 'jotai';
import type { GitStatus } from '@coder-studio/core';
import { orderedWorkspacesAtom, resolvedActiveWorkspaceIdAtom } from '../../../atoms/workspaces';
import { dispatchCommandAtom } from '../../../atoms/connection';
import { sessionsByWorkspaceAtomFamily } from '../../../atoms/sessions';
import { activeWorkspaceAtom } from '../../../atoms/workspaces';
import { paneLayoutAtomFamily } from '../../agent-panes/atoms/pane-layout';
import { collectSessionIds } from '../../agent-panes/pane-layout-tree';
import {
  activeFilePathAtomFamily,
  branchQuickPickAtom,
  focusModeAtom,
  gitDiffPreviewAtomFamily,
  gitStateAtomFamily,
  sidebarCollapsedAtom,
  terminalPanelVisibleAtom,
} from '../atoms';
import { useWorkspaceLayoutActions } from './use-workspace-layout-actions';

export type WorkspaceSidebarTab = 'files' | 'git';
export type WorkspaceMainAreaMode = 'agent' | 'editor' | 'diff';
export type MobileWorkspaceSheetKind = 'files' | 'terminal' | 'supervisor' | null;
export type MobileFilesRoute =
  | { kind: 'root' }
  | { kind: 'editor'; path: string }
  | { kind: 'diff'; path: string };

export interface WorkspaceCreateRequest {
  id: number;
  mode: 'file' | 'folder';
  baseDir: string | null;
}

export function useWorkspaceScreenModel() {
  const workspace = useAtomValue(activeWorkspaceAtom);
  const workspaceId = workspace?.id ?? '__workspace_placeholder__';
  const activeWorkspaceId = useAtomValue(resolvedActiveWorkspaceIdAtom);
  const workspaces = useAtomValue(orderedWorkspacesAtom);
  const gitState = useAtomValue(gitStateAtomFamily(workspaceId));
  const activeFilePath = useAtomValue(activeFilePathAtomFamily(workspaceId));
  const diffPreview = useAtomValue(gitDiffPreviewAtomFamily(workspaceId));
  const focusMode = useAtomValue(focusModeAtom);
  const terminalPanelVisible = useAtomValue(terminalPanelVisibleAtom);
  const sidebarCollapsed = useAtomValue(sidebarCollapsedAtom);
  const sessions = useAtomValue(sessionsByWorkspaceAtomFamily(workspaceId));
  const paneLayout = useAtomValue(paneLayoutAtomFamily(workspaceId));
  const dispatch = useAtomValue(dispatchCommandAtom);
  const setBranchQuickPick = useSetAtom(branchQuickPickAtom);
  const store = useStore();
  const layout = useWorkspaceLayoutActions();

  const [sidebarTab, setSidebarTab] = useState<WorkspaceSidebarTab>('files');
  const [createRequest, setCreateRequest] = useState<WorkspaceCreateRequest | null>(null);
  const [panelRefreshToken, setPanelRefreshToken] = useState(0);
  const [mobileSheet, setMobileSheet] = useState<MobileWorkspaceSheetKind>(null);
  const [mobileFilesRoute, setMobileFilesRoute] = useState<MobileFilesRoute>({ kind: 'root' });
  const [mobileActiveSessionId, setMobileActiveSessionId] = useState<string | null>(null);

  useEffect(() => {
    if (!workspace || gitState) {
      return;
    }

    let cancelled = false;

    dispatch<GitStatus>('git.status', { workspaceId: workspace.id })
      .then((result) => {
        if (cancelled || !result.ok || !result.data) {
          return;
        }

        store.set(gitStateAtomFamily(workspace.id), result.data);
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('Failed to load git status:', error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [dispatch, gitState, store, workspace]);

  const handleOpenBranchSwitcher = useCallback(() => {
    if (!workspace) {
      return;
    }

    setSidebarTab('git');
    setBranchQuickPick({
      visible: true,
      workspaceId: workspace.id,
      inputValue: '',
    });
  }, [setBranchQuickPick, workspace]);

  const handleOpenFileCreate = useCallback(() => {
    setCreateRequest((previous) => ({
      id: (previous?.id ?? 0) + 1,
      mode: 'file',
      baseDir: null,
    }));
  }, []);

  const handleOpenFolderCreate = useCallback(() => {
    setCreateRequest((previous) => ({
      id: (previous?.id ?? 0) + 1,
      mode: 'folder',
      baseDir: null,
    }));
  }, []);

  const handleConsumeCreateRequest = useCallback(() => {
    setCreateRequest(null);
  }, []);

  const handleRefreshSidebarPanel = useCallback(() => {
    setPanelRefreshToken((previous) => previous + 1);
  }, []);

  const orderedSessions = useMemo(() => {
    const sessionMap = new Map(sessions.map((session) => [session.id, session]));
    return Array.from(new Set(collectSessionIds(paneLayout)))
      .map((sessionId) => sessionMap.get(sessionId))
      .filter((session): session is NonNullable<typeof session> => Boolean(session));
  }, [paneLayout, sessions]);

  const preferredSessionId = workspace?.uiState?.activeSessionId ?? null;

  useEffect(() => {
    if (orderedSessions.some((session) => session.id === mobileActiveSessionId)) {
      return;
    }

    if (preferredSessionId && orderedSessions.some((session) => session.id === preferredSessionId)) {
      setMobileActiveSessionId(preferredSessionId);
      return;
    }

    const mostRecentSession = [...orderedSessions].sort(
      (left, right) => right.lastActiveAt - left.lastActiveAt
    )[0];
    setMobileActiveSessionId(mostRecentSession?.id ?? orderedSessions[0]?.id ?? null);
  }, [mobileActiveSessionId, orderedSessions, preferredSessionId]);

  const activeSession =
    orderedSessions.find((session) => session.id === mobileActiveSessionId) ?? null;

  const selectMobileSession = useCallback((sessionId: string | null) => {
    setMobileActiveSessionId(sessionId);
  }, []);

  const openMobileSheet = useCallback((sheet: Exclude<MobileWorkspaceSheetKind, null>) => {
    setMobileSheet(sheet);
    if (sheet !== 'files') {
      setMobileFilesRoute({ kind: 'root' });
    }
  }, []);

  const closeMobileSheet = useCallback(() => {
    setMobileSheet(null);
    setMobileFilesRoute({ kind: 'root' });
  }, []);

  const updateMobileFilesRoute = useCallback((route: MobileFilesRoute) => {
    setMobileFilesRoute(route);
  }, []);

  const mainAreaMode: WorkspaceMainAreaMode =
    sidebarTab === 'git' && diffPreview ? 'diff' : activeFilePath ? 'editor' : 'agent';

  return {
    activeSession,
    activeFilePath,
    activeWorkspaceId,
    createRequest,
    diffPreview,
    focusMode,
    gitState,
    handleConsumeCreateRequest,
    handleOpenBranchSwitcher,
    handleOpenFileCreate,
    handleOpenFolderCreate,
    handleRefreshSidebarPanel,
    mainAreaMode,
    mobileActiveSessionId,
    mobileFilesRoute,
    mobileSheet,
    openMobileSheet,
    orderedSessions,
    paneLayout,
    panelRefreshToken,
    selectMobileSession,
    sessions,
    setSidebarTab,
    sidebarCollapsed,
    sidebarTab,
    closeMobileSheet,
    terminalPanelVisible,
    updateMobileFilesRoute,
    workspace,
    workspaces,
    workspaceId,
    ...layout,
  };
}
