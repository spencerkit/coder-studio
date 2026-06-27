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

interface WslDistrosResult {
  distros: string[];
}

interface OpenWorkspaceOptions {
  targetRuntime?: Workspace["targetRuntime"];
  wslDistro?: string;
}

type TabType = "status" | "diff" | "tree";

function isBrowseResult(value: unknown): value is BrowseResult {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<BrowseResult>;
  return (
    typeof candidate.currentPath === "string" &&
    (typeof candidate.parentPath === "string" || candidate.parentPath === null) &&
    Array.isArray(candidate.directories)
  );
}

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
  const [targetRuntime, setTargetRuntime] = useState<Workspace["targetRuntime"]>("native");
  const [wslDistro, setWslDistro] = useState("");
  const [wslPath, setWslPath] = useState("");
  const [wslDistros, setWslDistros] = useState<string[]>([]);
  const [wslDistrosLoading, setWslDistrosLoading] = useState(false);
  const [wslDistrosError, setWslDistrosError] = useState<string | null>(null);
  const createRequestIdRef = useRef(0);
  const isWindowsPlatform =
    typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("win");

  const launchTitle = t("workspace.launch.title");
  const launchHint =
    isWindowsPlatform && targetRuntime === "wsl"
      ? t("workspace.launch.hint_wsl")
      : t("workspace.launch.hint");

  const applyBrowseResult = useCallback((result: BrowseResult) => {
    setCurrentPath(result.currentPath);
    setDirectories(result.directories);
    setParentPath(result.parentPath);
    const nextRootPaths = result.rootPaths?.filter(Boolean) ?? ["/"];
    setRootPaths(nextRootPaths);
    const detectedHomePath = nextRootPaths.find((candidate) => candidate !== "/") ?? null;
    setHomePath(detectedHomePath);
  }, []);

  const loadDirectory = useCallback(
    async (path?: string) => {
      setBrowsing(true);
      setError(null);

      try {
        const isWslLaunch = isWindowsPlatform && targetRuntime === "wsl";
        const trimmedWslPath = (wslPath ?? "").trim();
        const result = isWslLaunch
          ? await dispatch<BrowseResult>("workspace.wsl.browse", {
              distro: wslDistro,
              path: path ?? (trimmedWslPath || undefined),
            })
          : await dispatch<BrowseResult>("workspace.browse", { path });

        if (!result.ok || !isBrowseResult(result.data)) {
          setError(result.error?.message || t("workspace.launch.browse_failed"));
          return;
        }

        applyBrowseResult(result.data);
        if (isWslLaunch) {
          setWslPath(result.data.currentPath);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBrowsing(false);
      }
    },
    [applyBrowseResult, dispatch, isWindowsPlatform, t, targetRuntime, wslDistro, wslPath]
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

  useEffect(() => {
    if (!isWindowsPlatform) {
      return;
    }

    let cancelled = false;

    const loadWslDistros = async () => {
      setWslDistrosLoading(true);
      setWslDistrosError(null);

      try {
        const result = await dispatch<WslDistrosResult>("workspace.wsl.listDistros", {});
        if (cancelled) {
          return;
        }

        if (!result.ok || !result.data) {
          setWslDistros([]);
          setWslDistrosError(result.error?.message || t("workspace.launch.wsl_distro_load_failed"));
          return;
        }

        const nextDistros = Array.isArray(result.data.distros) ? result.data.distros : [];
        setWslDistros(nextDistros);
        setWslDistro((prev) =>
          prev && nextDistros.includes(prev) ? prev : (nextDistros[0] ?? "")
        );
      } catch (error) {
        if (cancelled) {
          return;
        }

        setWslDistros([]);
        setWslDistrosError(
          error instanceof Error ? error.message : t("workspace.launch.wsl_distro_load_failed")
        );
      } finally {
        if (!cancelled) {
          setWslDistrosLoading(false);
        }
      }
    };

    void loadWslDistros();

    return () => {
      cancelled = true;
    };
  }, [dispatch, isWindowsPlatform, t]);

  useEffect(() => {
    if (!isWindowsPlatform || targetRuntime !== "wsl" || !wslDistro) {
      return;
    }

    void loadDirectory();
  }, [isWindowsPlatform, loadDirectory, targetRuntime, wslDistro]);

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
      const createPath = joinChildPath(currentPath, trimmedName);
      const isWslLaunch = isWindowsPlatform && targetRuntime === "wsl";
      const createResult = isWslLaunch
        ? await dispatch<CreateDirectoryResult>("workspace.wsl.mkdir", {
            distro: wslDistro,
            path: createPath,
          })
        : await dispatch<CreateDirectoryResult>("workspace.mkdir", {
            path: createPath,
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

      const browseResult = isWslLaunch
        ? await dispatch<BrowseResult>("workspace.wsl.browse", {
            distro: wslDistro,
            path: currentPath,
          })
        : await dispatch<BrowseResult>("workspace.browse", { path: currentPath });

      if (createRequestIdRef.current !== requestId) {
        return;
      }

      if (!browseResult.ok || !isBrowseResult(browseResult.data)) {
        setCreateFolderError(
          browseResult.error?.message || t("workspace.launch.create_folder_failed")
        );
        return;
      }

      applyBrowseResult(browseResult.data);
      if (isWslLaunch) {
        setWslPath(browseResult.data.currentPath);
      }
      setSelectedPath(joinChildPath(browseResult.data.currentPath, trimmedName));
      setIsCreatingFolder(false);
      setNewFolderName("");
      setCreateFolderError(null);
    } catch (err) {
      if (createRequestIdRef.current !== requestId) {
        return;
      }
      setCreateFolderError(err instanceof Error ? err.message : String(err));
    } finally {
      if (createRequestIdRef.current === requestId) {
        setCreatingFolder(false);
      }
    }
  }, [
    applyBrowseResult,
    currentPath,
    dispatch,
    isWindowsPlatform,
    newFolderName,
    t,
    targetRuntime,
    wslDistro,
  ]);

  const openWorkspaceByPath = useCallback(
    async (path: string, options: OpenWorkspaceOptions = {}) => {
      if (!path) {
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const openArgs =
          options.targetRuntime === "wsl"
            ? {
                path,
                targetRuntime: "wsl" as const,
                wslDistro: options.wslDistro,
              }
            : { path };
        const diagnosticsIntent =
          options.targetRuntime === "wsl"
            ? {
                context: "workspace_open" as const,
                workspacePath: path,
                targetRuntime: "wsl" as const,
                wslDistro: options.wslDistro,
              }
            : {
                context: "workspace_open" as const,
                workspacePath: path,
              };

        const result = await dispatch<Workspace>("workspace.open", openArgs);

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

        navigate(buildDiagnosticsPath(diagnosticsIntent));
      } catch (_err) {
        navigate(buildDiagnosticsPath(diagnosticsIntent));
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
    if (targetRuntime === "wsl") {
      if (!wslDistro) {
        setError(t("workspace.launch.wsl_distro_required"));
        return;
      }

      const trimmedWslPath = (wslPath ?? "").trim();
      if (!trimmedWslPath) {
        setError(t("workspace.launch.wsl_path_required"));
        return;
      }

      await openWorkspaceByPath(trimmedWslPath, {
        targetRuntime: "wsl",
        wslDistro,
      });
      return;
    }

    if (!selectedPath) {
      setError(t("workspace.launch.select_required"));
      return;
    }

    await openWorkspaceByPath(selectedPath);
  }, [openWorkspaceByPath, selectedPath, t, targetRuntime, wslDistro, wslPath]);

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
    canOpen:
      targetRuntime === "wsl"
        ? Boolean(wslDistro && (wslPath ?? "").trim().length > 0)
        : Boolean(selectedPath),
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
    isWindowsPlatform,
    setTargetRuntime,
    setWslDistro,
    setWslPath,
    targetRuntime,
    updateNewFolderName,
    wslDistro,
    wslDistros,
    wslDistrosError,
    wslDistrosLoading,
    wslPath,
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
