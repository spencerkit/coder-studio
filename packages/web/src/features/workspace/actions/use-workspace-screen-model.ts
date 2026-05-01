import { useCallback, useEffect, useState } from 'react';
import { useAtomValue, useSetAtom, useStore } from 'jotai';
import type { GitStatus } from '@coder-studio/core';
import { dispatchCommandAtom } from '../../../atoms/connection';
import { sessionsByWorkspaceAtomFamily } from '../../../atoms/sessions';
import { activeWorkspaceAtom } from '../../../atoms/workspaces';
import { paneLayoutAtomFamily } from '../../agent-panes/atoms/pane-layout';
import { activeFilePathAtomFamily } from '../atoms/files';
import { branchQuickPickAtom, gitDiffPreviewAtomFamily, gitStateAtomFamily } from '../atoms/git';
import {
  focusModeAtom,
  sidebarCollapsedAtom,
  terminalPanelVisibleAtom,
} from '../atoms/layout';
import { useWorkspaceLayoutActions } from './use-workspace-layout-actions';

export type WorkspaceSidebarTab = 'files' | 'git';
export type WorkspaceMainAreaMode = 'agent' | 'editor' | 'diff';

export interface WorkspaceCreateRequest {
  id: number;
  mode: 'file' | 'folder';
  baseDir: string | null;
}

export function useWorkspaceScreenModel() {
  const workspace = useAtomValue(activeWorkspaceAtom);
  const workspaceId = workspace?.id ?? '__workspace_placeholder__';
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

  const mainAreaMode: WorkspaceMainAreaMode =
    sidebarTab === 'git' && diffPreview ? 'diff' : activeFilePath ? 'editor' : 'agent';

  return {
    activeFilePath,
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
    paneLayout,
    panelRefreshToken,
    sessions,
    setSidebarTab,
    sidebarCollapsed,
    sidebarTab,
    terminalPanelVisible,
    workspace,
    workspaceId,
    ...layout,
  };
}
