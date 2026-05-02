import { useCallback, useEffect, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useLocation, useNavigate } from 'react-router-dom';
import type { FileNode, GitStatus, Workspace, WorktreeInfo } from '@coder-studio/core';
import { dispatchCommandAtom, wsClientAtom } from '../../../atoms/connection';
import {
  activeWorkspaceIdAtom,
  workspaceOrderAtom,
  workspacesAtom,
  workspacesLoadErrorAtom,
  workspacesLoadStateAtom,
} from '../../../atoms/workspaces';
import { useTranslation } from '../../../lib/i18n';

export interface DirectoryInfo {
  name: string;
  path: string;
  itemCount?: number;
}

interface BrowseResult {
  currentPath: string;
  parentPath: string | null;
  directories: DirectoryInfo[];
  rootPaths?: string[];
}

type LaunchChoice = 'local' | 'remote';
type TabType = 'status' | 'diff' | 'tree';

export function useWorkspaceLaunchActions(onClose: () => void) {
  const t = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useAtomValue(dispatchCommandAtom);
  const setActiveWorkspaceId = useSetAtom(activeWorkspaceIdAtom);
  const setWorkspaces = useSetAtom(workspacesAtom);
  const setWorkspaceOrder = useSetAtom(workspaceOrderAtom);
  const setWorkspacesLoadState = useSetAtom(workspacesLoadStateAtom);
  const setWorkspacesLoadError = useSetAtom(workspacesLoadErrorAtom);

  const [currentPath, setCurrentPath] = useState('');
  const [directories, setDirectories] = useState<DirectoryInfo[]>([]);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [browsing, setBrowsing] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const launchChoice: LaunchChoice = 'local';
  const launchTitle =
    launchChoice === 'local'
      ? t('workspace.launch.local_title')
      : t('workspace.launch.remote_title');
  const rootPaths = ['/', '~', '/home/spencer'];

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const loadDirectory = useCallback(
    async (path?: string) => {
      setBrowsing(true);
      setError(null);

      try {
        const result = await dispatch<BrowseResult>('workspace.browse', { path });

        if (!result.ok || !result.data) {
          setError(result.error?.message || t('workspace.launch.browse_failed'));
          return;
        }

        setCurrentPath(result.data.currentPath);
        setDirectories(result.data.directories);
        setParentPath(result.data.parentPath);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBrowsing(false);
      }
    },
    [dispatch]
  );

  useEffect(() => {
    void loadDirectory();
  }, [loadDirectory]);

  const handleNavigate = useCallback(
    (path: string) => {
      setSelectedPath(null);
      void loadDirectory(path);
    },
    [loadDirectory]
  );

  const handleSelect = useCallback((path: string) => {
    setSelectedPath(path);
  }, []);

  const handleOpen = useCallback(async () => {
    if (!selectedPath) {
      setError(t('workspace.launch.select_required'));
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await dispatch<Workspace>('workspace.open', {
        path: selectedPath,
      });

      if (result.ok && result.data?.id) {
        setActiveWorkspaceId(result.data.id);
        setWorkspaces((prev) => ({
          ...prev,
          [result.data!.id]: result.data!,
        }));
        setWorkspaceOrder((prev) => {
          if (prev.includes(result.data!.id)) {
            return prev;
          }
          return [result.data!.id, ...prev];
        });
        setWorkspacesLoadState('ready');
        setWorkspacesLoadError(null);

        if (location.pathname !== '/workspace') {
          navigate('/workspace');
        }

        onClose();
      } else {
        setError(result.error?.message || t('workspace.launch.open_failed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [
    dispatch,
    location.pathname,
    navigate,
    onClose,
    selectedPath,
    setActiveWorkspaceId,
    setWorkspaceOrder,
    setWorkspaces,
    setWorkspacesLoadError,
    setWorkspacesLoadState,
    t,
  ]);

  const getShortPath = useCallback((path: string) => {
    if (path === '~') return '~';
    if (path === '/') return '/';
    const homeMatch = path.match(/^\/home\/[^/]+/);
    if (homeMatch) {
      return path.replace(homeMatch[0], '~');
    }
    return path;
  }, []);

  return {
    browsing,
    currentPath,
    directories,
    error,
    getShortPath,
    handleNavigate,
    handleOpen,
    handleSelect,
    launchChoice,
    launchTitle,
    loading,
    parentPath,
    rootPaths,
    selectedPath,
  };
}

export function useWorktreeActions(worktree: WorktreeInfo | null) {
  const wsClient = useAtomValue(wsClientAtom);
  const [activeTab, setActiveTab] = useState<TabType>('status');
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [diff, setDiff] = useState('');
  const [tree, setTree] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!worktree || !wsClient) {
      setStatus(null);
      setDiff('');
      setTree([]);
      return;
    }

    setLoading(true);
    setError(null);

    const fetchData = async () => {
      try {
        if (activeTab === 'status') {
          const result = await wsClient.sendCommand<{ status: GitStatus }>('worktree.status', {
            worktreePath: worktree.path,
          });
          setStatus(result.status);
        } else if (activeTab === 'diff') {
          const result = await wsClient.sendCommand<{ diff: string }>('worktree.diff', {
            worktreePath: worktree.path,
          });
          setDiff(result.diff);
        } else if (activeTab === 'tree') {
          const result = await wsClient.sendCommand<{ tree: FileNode[] }>('worktree.tree', {
            worktreePath: worktree.path,
          });
          setTree(result.tree);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load data';
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    void fetchData();
  }, [activeTab, worktree, wsClient]);

  const handleTabChange = useCallback((tab: TabType) => {
    setActiveTab(tab);
  }, []);

  return {
    activeTab,
    diff,
    error,
    handleTabChange,
    loading,
    status,
    tree,
  };
}
