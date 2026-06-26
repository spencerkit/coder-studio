import type { FileNode } from "@coder-studio/core";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";
import { dispatchCommandAtom } from "../../../atoms/connection";
import { useTranslation } from "../../../lib/i18n";
import {
  activeFilePathAtomFamily,
  expandedDirsAtomFamily,
  fileTreeAtomFamily,
  fileTreeStaleAtomFamily,
  loadedDirsAtomFamily,
  type OpenFile,
  openEditorPathsAtomFamily,
  openFilesAtomFamily,
} from "../atoms";
import {
  applyDirectoryRefresh,
  applyRootTreeRefresh,
  collectRefreshTargets,
} from "./file-tree-refresh";
import { normalizeOpenEditorPaths, rewriteOpenEditorPaths } from "./open-editor-state";
import { useOpenWorkspaceFile } from "./use-open-workspace-file";
import { useWorkspaceUiStatePersistence } from "./use-workspace-ui-state-persistence";

export interface CreateRequest {
  id: number;
  mode: "file" | "folder";
  baseDir: string | null;
}

interface ReadTreeResult {
  path: string;
  children: FileNode[];
}

interface SearchFilesResult {
  files: FileNode[];
}

export interface CreateDialogState {
  mode: "file" | "folder";
  draftPath: string;
  error: string | null;
}

export interface PendingDeleteState {
  path: string;
  name: string;
  error: string | null;
}

export interface RenameDialogState {
  fromPath: string;
  currentName: string;
  nextName: string;
  kind: "file" | "dir";
  error: string | null;
}

interface UseFileActionsArgs {
  workspaceId: string;
  refreshToken?: number;
  createRequest?: CreateRequest | null;
  onCreateRequestConsumed?: () => void;
  onSelectFile?: (path: string) => void;
}

const FILE_DELETE_TIMEOUT_MS = 180_000;

function isReadTreeResult(value: unknown): value is ReadTreeResult {
  if (!value || typeof value !== "object") {
    return false;
  }

  return Array.isArray((value as ReadTreeResult).children);
}

function rewriteDescendantPath(path: string, fromPath: string, toPath: string): string {
  if (path === fromPath) {
    return toPath;
  }

  if (path.startsWith(`${fromPath}/`)) {
    return `${toPath}${path.slice(fromPath.length)}`;
  }

  return path;
}

function isSameOrDescendantPath(path: string, targetPath: string): boolean {
  return path === targetPath || path.startsWith(`${targetPath}/`);
}

function removeDeletedEditorPaths(paths: Iterable<string>, deletedPath: string): string[] {
  return normalizeOpenEditorPaths(Array.from(paths)).filter(
    (path) => !isSameOrDescendantPath(path, deletedPath)
  );
}

function removeDeletedOpenFiles(
  openFiles: Record<string, OpenFile>,
  deletedPath: string
): Record<string, OpenFile> {
  let changed = false;
  const nextEntries = Object.entries(openFiles).filter(([path]) => {
    const shouldKeep = !isSameOrDescendantPath(path, deletedPath);
    changed = changed || !shouldKeep;
    return shouldKeep;
  });

  return changed ? Object.fromEntries(nextEntries) : openFiles;
}

function removeDeletedTreeEntries(
  previousTree: Map<string, FileNode[]> | null,
  deletedPath: string
): Map<string, FileNode[]> | null {
  if (!previousTree) {
    return previousTree;
  }

  const lastSlashIndex = deletedPath.lastIndexOf("/");
  const parentPath = lastSlashIndex === -1 ? "." : deletedPath.slice(0, lastSlashIndex);
  const nextTree = new Map<string, FileNode[]>();

  for (const [path, nodes] of previousTree) {
    if (isSameOrDescendantPath(path, deletedPath)) {
      continue;
    }

    if (path === parentPath) {
      nextTree.set(
        path,
        nodes.filter((node) => node.path !== deletedPath)
      );
      continue;
    }

    nextTree.set(path, nodes);
  }

  return nextTree;
}

function removeDeletedDirPaths(paths: Set<string>, deletedPath: string): Set<string> {
  return new Set([...paths].filter((path) => !isSameOrDescendantPath(path, deletedPath)));
}

function rewriteOpenFiles(
  openFiles: Record<string, OpenFile>,
  fromPath: string,
  toPath: string
): Record<string, OpenFile> {
  const nextEntries = Object.entries(openFiles).map(([path, file]) => {
    const rewrittenPath = rewriteDescendantPath(path, fromPath, toPath);

    if (rewrittenPath === path) {
      return [path, file] as const;
    }

    return [
      rewrittenPath,
      {
        ...file,
        path: rewrittenPath,
      },
    ] as const;
  });

  return Object.fromEntries(nextEntries);
}

function setsEqual<T>(left: Set<T> | null, right: Set<T>): boolean {
  if (!left) {
    return right.size === 0;
  }

  if (left.size !== right.size) {
    return false;
  }

  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }

  return true;
}

export function useFileActions({
  workspaceId,
  refreshToken = 0,
  createRequest = null,
  onCreateRequestConsumed,
  onSelectFile,
}: UseFileActionsArgs) {
  const t = useTranslation();
  const fileTree = useAtomValue(fileTreeAtomFamily(workspaceId));
  const fileTreeStale = useAtomValue(fileTreeStaleAtomFamily(workspaceId));
  const activeFilePath = useAtomValue(activeFilePathAtomFamily(workspaceId));
  const openEditorPaths = useAtomValue(openEditorPathsAtomFamily(workspaceId));
  const openFiles = useAtomValue(openFilesAtomFamily(workspaceId));
  const expandedDirs = useAtomValue(expandedDirsAtomFamily(workspaceId));
  const dispatch = useAtomValue(dispatchCommandAtom);
  const setFileTree = useSetAtom(fileTreeAtomFamily(workspaceId));
  const setFileTreeStale = useSetAtom(fileTreeStaleAtomFamily(workspaceId));
  const setActiveFilePath = useSetAtom(activeFilePathAtomFamily(workspaceId));
  const setOpenEditorPaths = useSetAtom(openEditorPathsAtomFamily(workspaceId));
  const setOpenFiles = useSetAtom(openFilesAtomFamily(workspaceId));
  const setExpandedDirs = useSetAtom(expandedDirsAtomFamily(workspaceId));
  const { openWorkspaceFile } = useOpenWorkspaceFile(workspaceId);
  const { persistUiState } = useWorkspaceUiStatePersistence(workspaceId);
  const loadedDirs = useAtomValue(loadedDirsAtomFamily(workspaceId));
  const setLoadedDirs = useSetAtom(loadedDirsAtomFamily(workspaceId));

  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingDir, setIsLoadingDir] = useState<string | null>(null);
  const [createDialog, setCreateDialog] = useState<CreateDialogState | null>(null);
  const [renameDialog, setRenameDialog] = useState<RenameDialogState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDeleteState | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const deleteInFlightRef = useRef(false);
  const lastRefreshTokenRef = useRef(refreshToken);
  const lastCreateRequestRef = useRef(0);

  const loadFileTree = useCallback(async () => {
    if (!workspaceId || isLoading) return false;

    setIsLoading(true);
    const result = await dispatch<ReadTreeResult>("file.readTree", {
      workspaceId,
    });

    if (result.ok && isReadTreeResult(result.data)) {
      const reconciled = applyRootTreeRefresh({
        previousTree: fileTree,
        previousLoadedDirs: loadedDirs,
        previousExpandedDirs: expandedDirs,
        rootChildren: result.data.children,
      });

      let currentTree = reconciled.tree;
      let currentLoadedDirs = reconciled.loadedDirs;
      let currentExpandedDirs: Set<string> | null = expandedDirs;

      setFileTree(currentTree);
      setLoadedDirs(currentLoadedDirs);

      if (expandedDirs) {
        if (!setsEqual(expandedDirs, reconciled.prunedExpandedDirs)) {
          const normalizedExpandedDirs = collectRefreshTargets(reconciled.prunedExpandedDirs);
          currentExpandedDirs = new Set(normalizedExpandedDirs);
          setExpandedDirs(currentExpandedDirs);
          void persistUiState({ fileTreeExpandedDirs: normalizedExpandedDirs });
        } else {
          currentExpandedDirs = reconciled.prunedExpandedDirs;
        }
      }

      const refreshTargets = collectRefreshTargets(currentExpandedDirs ?? currentLoadedDirs);

      for (const dirPath of refreshTargets) {
        const childResult = await dispatch<ReadTreeResult>("file.readTree", {
          workspaceId,
          subPath: dirPath,
        });

        if (!childResult.ok || !isReadTreeResult(childResult.data)) {
          continue;
        }

        const refreshed = applyDirectoryRefresh({
          previousTree: currentTree,
          previousLoadedDirs: currentLoadedDirs,
          previousExpandedDirs: currentExpandedDirs,
          dirPath,
          children: childResult.data.children,
        });

        currentTree = refreshed.tree;
        currentLoadedDirs = new Set(refreshed.loadedDirs).add(dirPath);
        setFileTree(currentTree);
        setLoadedDirs(currentLoadedDirs);

        if (currentExpandedDirs) {
          if (!setsEqual(currentExpandedDirs, refreshed.prunedExpandedDirs)) {
            const normalizedExpandedDirs = collectRefreshTargets(refreshed.prunedExpandedDirs);
            currentExpandedDirs = new Set(normalizedExpandedDirs);
            setExpandedDirs(currentExpandedDirs);
            void persistUiState({ fileTreeExpandedDirs: normalizedExpandedDirs });
          } else {
            currentExpandedDirs = refreshed.prunedExpandedDirs;
          }
        }
      }

      setIsLoading(false);
      return true;
    }

    if (!result.ok) {
      console.error("Failed to load file tree:", result.error?.message);
    }

    setIsLoading(false);
    return false;
  }, [
    workspaceId,
    isLoading,
    dispatch,
    expandedDirs,
    fileTree,
    loadedDirs,
    persistUiState,
    setExpandedDirs,
    setFileTree,
    setLoadedDirs,
  ]);

  const loadChildren = useCallback(
    async (dirPath: string) => {
      const alreadyLoaded = loadedDirs.has(dirPath) && fileTree?.has(dirPath);
      if (!workspaceId || isLoadingDir === dirPath || alreadyLoaded) return;

      setIsLoadingDir(dirPath);
      const result = await dispatch<ReadTreeResult>("file.readTree", {
        workspaceId,
        subPath: dirPath,
      });

      if (result.ok && isReadTreeResult(result.data)) {
        const refreshed = applyDirectoryRefresh({
          previousTree: fileTree,
          previousLoadedDirs: loadedDirs,
          previousExpandedDirs: expandedDirs,
          dirPath,
          children: result.data.children,
        });

        setFileTree(refreshed.tree);
        setLoadedDirs(new Set(refreshed.loadedDirs).add(dirPath));
      }

      setIsLoadingDir(null);
    },
    [
      workspaceId,
      isLoadingDir,
      loadedDirs,
      fileTree,
      expandedDirs,
      dispatch,
      setFileTree,
      setLoadedDirs,
    ]
  );

  const loadSearchResults = useCallback(
    async (query: string) => {
      if (!workspaceId) {
        return [];
      }

      const result = await dispatch<SearchFilesResult>("file.search", {
        workspaceId,
        query,
        limit: 10,
      });

      if (!result.ok || !result.data) {
        return [];
      }

      return result.data.files;
    },
    [dispatch, workspaceId]
  );

  const openCreateDialog = useCallback((mode: "file" | "folder", baseDir: string | null) => {
    const normalizedBaseDir = baseDir ? `${baseDir.replace(/\/+$/, "")}/` : "";
    setCreateDialog({
      mode,
      draftPath: normalizedBaseDir,
      error: null,
    });
  }, []);

  const closeCreateDialog = useCallback(() => {
    setCreateDialog(null);
  }, []);

  const openRenameDialog = useCallback(
    ({ path, name, kind }: { path: string; name: string; kind: "file" | "dir" }) => {
      setRenameDialog({
        fromPath: path,
        currentName: name,
        nextName: name,
        kind,
        error: null,
      });
    },
    []
  );

  const closeRenameDialog = useCallback(() => {
    setRenameDialog(null);
  }, []);

  const updateRenameDraft = useCallback((nextName: string) => {
    setRenameDialog((current) =>
      current
        ? {
            ...current,
            nextName,
            error: null,
          }
        : current
    );
  }, []);

  const updateDraftPath = useCallback((draftPath: string) => {
    setCreateDialog((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        draftPath,
        error: null,
      };
    });
  }, []);

  const submitCreateDialog = useCallback(async () => {
    if (!createDialog) {
      return;
    }

    const path = createDialog.draftPath.trim();
    if (!path) {
      setCreateDialog((current) =>
        current
          ? {
              ...current,
              error: t("file.path_required"),
            }
          : current
      );
      return;
    }

    if (createDialog.mode === "file" && path.endsWith("/")) {
      setCreateDialog((current) =>
        current
          ? {
              ...current,
              error: t("file.invalid_file_path"),
            }
          : current
      );
      return;
    }

    const op = createDialog.mode === "file" ? "file.create" : "file.mkdir";
    const result = await dispatch(op, {
      workspaceId,
      path,
    });

    if (!result.ok) {
      setCreateDialog((current) =>
        current
          ? {
              ...current,
              error: result.error?.message ?? t("file.create_failed"),
            }
          : current
      );
      return;
    }

    await loadFileTree();
    closeCreateDialog();

    if (createDialog.mode === "file") {
      void openWorkspaceFile({
        workspaceId,
        path,
        source: "manual",
      });
    }
  }, [createDialog, dispatch, workspaceId, loadFileTree, closeCreateDialog, openWorkspaceFile, t]);

  const submitRenameDialog = useCallback(async () => {
    if (!renameDialog) {
      return;
    }

    const nextName = renameDialog.nextName.trim();
    if (!nextName) {
      setRenameDialog((current) =>
        current
          ? {
              ...current,
              error: t("file.rename_required"),
            }
          : current
      );
      return;
    }

    if (nextName.includes("/") || nextName.includes("\\")) {
      setRenameDialog((current) =>
        current
          ? {
              ...current,
              error: t("file.rename_invalid_name"),
            }
          : current
      );
      return;
    }

    if (nextName === renameDialog.currentName) {
      setRenameDialog(null);
      return;
    }

    const lastSlashIndex = renameDialog.fromPath.lastIndexOf("/");
    const parentDir = lastSlashIndex === -1 ? "" : renameDialog.fromPath.slice(0, lastSlashIndex);
    const toPath = parentDir ? `${parentDir}/${nextName}` : nextName;

    const result = await dispatch("file.rename", {
      workspaceId,
      fromPath: renameDialog.fromPath,
      toPath,
    });

    if (!result.ok) {
      setRenameDialog((current) =>
        current
          ? {
              ...current,
              error: result.error?.message ?? t("file.rename_failed"),
            }
          : current
      );
      return;
    }

    const nextActiveFilePath = activeFilePath
      ? rewriteDescendantPath(activeFilePath, renameDialog.fromPath, toPath)
      : activeFilePath;
    const nextOpenEditorPaths = rewriteOpenEditorPaths(
      openEditorPaths,
      renameDialog.fromPath,
      toPath
    );

    setActiveFilePath(nextActiveFilePath);
    setOpenEditorPaths(nextOpenEditorPaths);
    setOpenFiles((current) => rewriteOpenFiles(current, renameDialog.fromPath, toPath));
    void persistUiState({
      openEditorPaths: nextOpenEditorPaths,
      activeEditorPath: nextActiveFilePath,
    });
    await loadFileTree();
    setRenameDialog(null);
  }, [
    activeFilePath,
    dispatch,
    loadFileTree,
    openEditorPaths,
    openFiles,
    persistUiState,
    renameDialog,
    setActiveFilePath,
    setOpenEditorPaths,
    setOpenFiles,
    t,
    workspaceId,
  ]);

  const cancelDelete = useCallback(() => {
    if (deleteInFlightRef.current) {
      return;
    }

    setPendingDelete(null);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete || deleteInFlightRef.current) {
      return;
    }

    deleteInFlightRef.current = true;
    setIsDeleting(true);
    try {
      const result = await dispatch(
        "file.delete",
        {
          workspaceId,
          path: pendingDelete.path,
        },
        {
          timeoutMs: FILE_DELETE_TIMEOUT_MS,
        }
      );

      if (!result.ok) {
        setPendingDelete((current) =>
          current
            ? {
                ...current,
                error: result.error?.message ?? t("file.delete_failed"),
              }
            : current
        );
        return;
      }

      const nextActiveFilePath =
        activeFilePath && isSameOrDescendantPath(activeFilePath, pendingDelete.path)
          ? null
          : activeFilePath;
      const nextOpenEditorPaths = removeDeletedEditorPaths(openEditorPaths, pendingDelete.path);
      const nextOpenFiles = removeDeletedOpenFiles(openFiles, pendingDelete.path);
      const nextTree = removeDeletedTreeEntries(fileTree, pendingDelete.path);
      const nextLoadedDirs = removeDeletedDirPaths(loadedDirs, pendingDelete.path);
      const nextExpandedDirs = expandedDirs
        ? removeDeletedDirPaths(expandedDirs, pendingDelete.path)
        : null;

      if (activeFilePath !== nextActiveFilePath) {
        setActiveFilePath(nextActiveFilePath);
      }

      setOpenEditorPaths(nextOpenEditorPaths);
      setOpenFiles(nextOpenFiles);
      setFileTree(nextTree);
      setLoadedDirs(nextLoadedDirs);
      if (expandedDirs && nextExpandedDirs && !setsEqual(expandedDirs, nextExpandedDirs)) {
        setExpandedDirs(nextExpandedDirs);
        void persistUiState({ fileTreeExpandedDirs: collectRefreshTargets(nextExpandedDirs) });
      }
      void persistUiState({
        openEditorPaths: nextOpenEditorPaths,
        activeEditorPath: nextActiveFilePath,
      });
      setPendingDelete(null);
      void loadFileTree();
    } finally {
      deleteInFlightRef.current = false;
      setIsDeleting(false);
    }
  }, [
    pendingDelete,
    dispatch,
    workspaceId,
    activeFilePath,
    openEditorPaths,
    openFiles,
    fileTree,
    loadedDirs,
    expandedDirs,
    persistUiState,
    setActiveFilePath,
    setFileTree,
    setLoadedDirs,
    setExpandedDirs,
    setOpenEditorPaths,
    setOpenFiles,
    loadFileTree,
    t,
  ]);

  useEffect(() => {
    if (!fileTree && !isLoading) {
      void loadFileTree();
    }
  }, [fileTree, isLoading, loadFileTree]);

  useEffect(() => {
    if (fileTreeStale && !isLoading) {
      setFileTreeStale(false);
      void loadFileTree();
    }
  }, [fileTreeStale, isLoading, loadFileTree, setFileTreeStale]);

  useEffect(() => {
    if (refreshToken <= lastRefreshTokenRef.current || isLoading) {
      return;
    }

    lastRefreshTokenRef.current = refreshToken;
    void loadFileTree();
  }, [refreshToken, isLoading, loadFileTree]);

  useEffect(() => {
    if (!createRequest || createRequest.id <= lastCreateRequestRef.current) {
      return;
    }

    lastCreateRequestRef.current = createRequest.id;
    openCreateDialog(createRequest.mode, createRequest.baseDir);
    onCreateRequestConsumed?.();
  }, [createRequest, openCreateDialog, onCreateRequestConsumed]);

  const handleSelectFile = useCallback(
    (path: string) => {
      void openWorkspaceFile(
        {
          workspaceId,
          path,
          source: "file-tree",
        },
        { openTarget: "navigate", openDisposition: "preview" }
      );
      onSelectFile?.(path);
    },
    [onSelectFile, openWorkspaceFile, workspaceId]
  );

  const handlePinFile = useCallback(
    (path: string) => {
      void openWorkspaceFile(
        {
          workspaceId,
          path,
          source: "file-tree",
        },
        { openTarget: "navigate", openDisposition: "pinned" }
      );
      onSelectFile?.(path);
    },
    [onSelectFile, openWorkspaceFile, workspaceId]
  );

  return {
    activeFilePath,
    createDialog,
    fileTree,
    isLoading,
    isLoadingDir,
    isDeleting,
    renameDialog,
    pendingDelete,
    cancelDelete,
    confirmDelete,
    handleSelectFile,
    handlePinFile,
    loadFileTree,
    loadChildren,
    loadSearchResults,
    openCreateDialog,
    openRenameDialog,
    requestDelete: setPendingDelete,
    updateRenameDraft,
    submitRenameDialog,
    closeRenameDialog,
    submitCreateDialog,
    updateDraftPath,
    closeCreateDialog,
  };
}
