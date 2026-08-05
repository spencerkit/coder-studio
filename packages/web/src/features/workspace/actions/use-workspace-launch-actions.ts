import type {
  FileNode,
  GitStatus,
  Workspace,
  WorkspaceHistoryEntry,
  WorktreeInfo,
} from "@coder-studio/core";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { dispatchCommandAtom, wsClientAtom } from "../../../atoms/connection";
import {
  activeWorkspaceIdAtom,
  workspaceOrderAtom,
  workspacesAtom,
  workspacesLoadErrorAtom,
  workspacesLoadStateAtom,
} from "../../../atoms/workspaces";
import { useTranslation } from "../../../lib/i18n";
import { buildDiagnosticsPath } from "../../diagnostics";
import { hydrateWorkspaceEditorState } from "./open-editor-state";
import { usePersistWorkspaceLastViewedTarget } from "./use-persist-workspace-last-viewed-target";

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

interface CreateDirectoryResult {
  ok: true;
}

type TabType = "status" | "diff" | "tree";

function joinChildPath(parentPath: string, childName: string): string {
  return parentPath === "/" ? `/${childName}` : `${parentPath}/${childName}`;
}

export function useWorkspaceLaunchActions(onClose: () => void) {
  const t = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useAtomValue(dispatchCommandAtom);
  const store = useStore();
  const setActiveWorkspaceId = useSetAtom(activeWorkspaceIdAtom);
  const setWorkspaces = useSetAtom(workspacesAtom);
  const setWorkspaceOrder = useSetAtom(workspaceOrderAtom);
  const setWorkspacesLoadState = useSetAtom(workspacesLoadStateAtom);
  const setWorkspacesLoadError = useSetAtom(workspacesLoadErrorAtom);
  const persistLastViewedTarget = usePersistWorkspaceLastViewedTarget();

  const [currentPath, setCurrentPath] = useState("");
  const [directories, setDirectories] = useState<DirectoryInfo[]>([]);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [browsing, setBrowsing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rootPaths, setRootPaths] = useState<string[]>(["/"]);
  const [homePath, setHomePath] = useState<string | null>(null);
  const [recentWorkspaces, setRecentWorkspaces] = useState<WorkspaceHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [createFolderError, setCreateFolderError] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const createRequestIdRef = useRef(0);

  const launchTitle = t("workspace.launch.title");
  const launchHint = t("workspace.launch.hint");

  const loadDirectory = useCallback(
    async (path?: string) => {
      setBrowsing(true);
      setError(null);

      try {
        const result = await dispatch<BrowseResult>("workspace.browse", { path });

        if (!result.ok || !result.data) {
          setError(result.error?.message || t("workspace.launch.browse_failed"));
          return;
        }

        setCurrentPath(result.data.currentPath);
        setDirectories(result.data.directories);
        setParentPath(result.data.parentPath);
        const nextRootPaths = result.data.rootPaths?.filter(Boolean) ?? ["/"];
        setRootPaths(nextRootPaths);
        const detectedHomePath = nextRootPaths.find((candidate) => candidate !== "/") ?? null;
        setHomePath(detectedHomePath);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBrowsing(false);
      }
    },
    [dispatch, t]
  );

  const loadWorkspaceHistory = useCallback(async () => {
    setHistoryLoading(true);

    try {
      const result = await dispatch<WorkspaceHistoryEntry[]>("workspace.history.list", {});
      setRecentWorkspaces(result.ok && Array.isArray(result.data) ? result.data : []);
    } catch {
      setRecentWorkspaces([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [dispatch]);

  const removeRecentWorkspace = useCallback(
    async (path: string) => {
      if (!path) {
        return false;
      }

      try {
        const result = await dispatch<WorkspaceHistoryEntry[]>("workspace.history.remove", {
          path,
        });

        if (!result.ok) {
          setError(result.error?.message || t("workspace.launch.open_failed"));
          return false;
        }

        setRecentWorkspaces(Array.isArray(result.data) ? result.data : []);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [dispatch, t]
  );

  const clearRecentWorkspaces = useCallback(async () => {
    try {
      const result = await dispatch<WorkspaceHistoryEntry[]>("workspace.history.clear", {});

      if (!result.ok) {
        setError(result.error?.message || t("workspace.launch.open_failed"));
        return false;
      }

      setRecentWorkspaces(Array.isArray(result.data) ? result.data : []);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }, [dispatch, t]);

  useEffect(() => {
    void loadDirectory();
    void loadWorkspaceHistory();
  }, [loadDirectory, loadWorkspaceHistory]);

  const handleNavigate = useCallback(
    (path: string) => {
      createRequestIdRef.current += 1;
      setSelectedPath(null);
      setIsCreatingFolder(false);
      setNewFolderName("");
      setCreateFolderError(null);
      setCreatingFolder(false);
      void loadDirectory(path);
    },
    [loadDirectory]
  );

  const handleSelect = useCallback((path: string) => {
    setSelectedPath(path);
  }, []);

  const openCreateFolder = useCallback(() => {
    setIsCreatingFolder(true);
    setCreateFolderError(null);
  }, []);

  const closeCreateFolder = useCallback(() => {
    createRequestIdRef.current += 1;
    setIsCreatingFolder(false);
    setNewFolderName("");
    setCreateFolderError(null);
    setCreatingFolder(false);
  }, []);

  const updateNewFolderName = useCallback((value: string) => {
    setNewFolderName(value);
    setCreateFolderError(null);
  }, []);

  const submitCreateFolder = useCallback(async () => {
    const trimmedName = newFolderName.trim();

    if (!trimmedName) {
      setCreateFolderError(t("workspace.launch.folder_name_required"));
      return;
    }

    if (trimmedName.includes("/") || trimmedName.includes("\\")) {
      setCreateFolderError(t("workspace.launch.folder_name_invalid"));
      return;
    }

    if (!currentPath) {
      setCreateFolderError(t("workspace.launch.create_folder_failed"));
      return;
    }

    setCreatingFolder(true);
    setCreateFolderError(null);
    const requestId = createRequestIdRef.current + 1;
    createRequestIdRef.current = requestId;

    try {
      const createResult = await dispatch<CreateDirectoryResult>("workspace.mkdir", {
        path: joinChildPath(currentPath, trimmedName),
      });

      if (createRequestIdRef.current !== requestId) {
        return;
      }

      if (!createResult.ok) {
        setCreateFolderError(
          createResult.error?.message || t("workspace.launch.create_folder_failed")
        );
        return;
      }

      const browseResult = await dispatch<BrowseResult>("workspace.browse", { path: currentPath });

      if (createRequestIdRef.current !== requestId) {
        return;
      }

      if (!browseResult.ok || !browseResult.data) {
        setCreateFolderError(
          browseResult.error?.message || t("workspace.launch.create_folder_failed")
        );
        return;
      }

      setCurrentPath(browseResult.data.currentPath);
      setDirectories(browseResult.data.directories);
      setParentPath(browseResult.data.parentPath);
      const nextRootPaths = browseResult.data.rootPaths?.filter(Boolean) ?? ["/"];
      setRootPaths(nextRootPaths);
      const detectedHomePath = nextRootPaths.find((candidate) => candidate !== "/") ?? null;
      setHomePath(detectedHomePath);
      setSelectedPath(joinChildPath(browseResult.data.currentPath, trimmedName));
      setIsCreatingFolder(false);
      setNewFolderName("");
      setCreateFolderError(null);
    } catch (_err) {
      if (createRequestIdRef.current !== requestId) {
        return;
      }
      setCreateFolderError(err instanceof Error ? err.message : String(err));
    } finally {
      if (createRequestIdRef.current === requestId) {
        setCreatingFolder(false);
      }
    }
  }, [currentPath, dispatch, newFolderName, t]);

  const openWorkspaceByPath = useCallback(
    async (path: string) => {
      if (!path) {
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const result = await dispatch<Workspace>("workspace.open", { path });

        if (result.ok && result.data?.id) {
          void persistLastViewedTarget({ workspaceId: result.data.id });
          setActiveWorkspaceId(result.data.id);
          setWorkspaces((prev) => ({
            ...prev,
            [result.data.id]: result.data,
          }));
          hydrateWorkspaceEditorState(store, result.data.id, result.data.uiState);
          setWorkspaceOrder((prev) => {
            if (prev.includes(result.data.id)) {
              return prev;
            }
            return [result.data.id, ...prev];
          });
          setWorkspacesLoadState("ready");
          setWorkspacesLoadError(null);

          if (location.pathname !== "/workspace") {
            navigate("/workspace");
          }

          onClose();
          return;
        }

        navigate(
          buildDiagnosticsPath({
            context: "workspace_open",
            workspacePath: path,
          })
        );
      } catch (_err) {
        navigate(
          buildDiagnosticsPath({
            context: "workspace_open",
            workspacePath: path,
          })
        );
      } finally {
        setLoading(false);
      }
    },
    [
      dispatch,
      location.pathname,
      navigate,
      onClose,
      persistLastViewedTarget,
      setActiveWorkspaceId,
      setWorkspaceOrder,
      setWorkspaces,
      setWorkspacesLoadError,
      setWorkspacesLoadState,
      store,
    ]
  );

  const handleOpen = useCallback(async () => {
    if (!selectedPath) {
      setError(t("workspace.launch.select_required"));
      return;
    }

    await openWorkspaceByPath(selectedPath);
  }, [openWorkspaceByPath, selectedPath, t]);

  const canUseNativeDirectoryPicker = Boolean(window.coderStudioDesktop);
  const chooseWorkspaceDirectory = useCallback(async () => {
    const desktopApi = window.coderStudioDesktop;
    if (!desktopApi) return;

    try {
      const path = await desktopApi.selectWorkspaceDirectory();
      if (path) await openWorkspaceByPath(path);
    } catch (chooseError) {
      setError(chooseError instanceof Error ? chooseError.message : String(chooseError));
    }
  }, [openWorkspaceByPath]);

  const getShortPath = useCallback(
    (path: string) => {
      if (path === "/") return "/";
      if (homePath && path === homePath) {
        return "~";
      }
      if (homePath && path.startsWith(`${homePath}/`)) {
        return `~${path.slice(homePath.length)}`;
      }
      return path;
    },
    [homePath]
  );

  return {
    browsing,
    canUseNativeDirectoryPicker,
    chooseWorkspaceDirectory,
    currentPath,
    directories,
    error,
    createFolderError,
    creatingFolder,
    getShortPath,
    handleNavigate,
    handleOpen,
    handleSelect,
    historyLoading,
    isCreatingFolder,
    launchHint,
    launchTitle,
    loading,
    newFolderName,
    openCreateFolder,
    openWorkspaceByPath,
    parentPath,
    recentWorkspaces,
    rootPaths,
    closeCreateFolder,
    clearRecentWorkspaces,
    selectedPath,
    removeRecentWorkspace,
    submitCreateFolder,
    updateNewFolderName,
  };
}

export function useWorktreeActions(workspaceId: string, worktree: WorktreeInfo | null) {
  const t = useTranslation();
  const wsClient = useAtomValue(wsClientAtom);
  const [activeTab, setActiveTab] = useState<TabType>("status");
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [diff, setDiff] = useState("");
  const [tree, setTree] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!worktree || !wsClient || !workspaceId) {
      setStatus(null);
      setDiff("");
      setTree([]);
      return;
    }

    setLoading(true);
    setError(null);

    const fetchData = async () => {
      try {
        if (activeTab === "status") {
          const result = await wsClient.sendCommand<{ status: GitStatus }>("worktree.status", {
            workspaceId,
            worktreePath: worktree.path,
          });
          setStatus(result.status);
        } else if (activeTab === "diff") {
          const result = await wsClient.sendCommand<{ diff: string }>("worktree.diff", {
            workspaceId,
            worktreePath: worktree.path,
          });
          setDiff(result.diff);
        } else if (activeTab === "tree") {
          const result = await wsClient.sendCommand<{ tree: FileNode[] }>("worktree.tree", {
            workspaceId,
            worktreePath: worktree.path,
          });
          setTree(result.tree);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : t("worktree.detail_load_failed");
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    void fetchData();
  }, [activeTab, t, workspaceId, worktree, wsClient]);

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
