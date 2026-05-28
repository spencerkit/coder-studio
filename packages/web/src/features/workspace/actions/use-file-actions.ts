import type { FileNode } from "@coder-studio/core";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";
import { dispatchCommandAtom } from "../../../atoms/connection";
import { useTranslation } from "../../../lib/i18n";
import {
  activeFilePathAtomFamily,
  fileTreeAtomFamily,
  fileTreeStaleAtomFamily,
  loadedDirsAtomFamily,
  type OpenFile,
  openFilesAtomFamily,
} from "../atoms";
import { useOpenWorkspaceFile } from "./use-open-workspace-file";

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

function rewriteDescendantPath(path: string, fromPath: string, toPath: string): string {
  if (path === fromPath) {
    return toPath;
  }

  if (path.startsWith(`${fromPath}/`)) {
    return `${toPath}${path.slice(fromPath.length)}`;
  }

  return path;
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
  const dispatch = useAtomValue(dispatchCommandAtom);
  const setFileTree = useSetAtom(fileTreeAtomFamily(workspaceId));
  const setFileTreeStale = useSetAtom(fileTreeStaleAtomFamily(workspaceId));
  const setActiveFilePath = useSetAtom(activeFilePathAtomFamily(workspaceId));
  const setOpenFiles = useSetAtom(openFilesAtomFamily(workspaceId));
  const { openWorkspaceFile } = useOpenWorkspaceFile(workspaceId);
  const loadedDirs = useAtomValue(loadedDirsAtomFamily(workspaceId));
  const setLoadedDirs = useSetAtom(loadedDirsAtomFamily(workspaceId));

  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingDir, setIsLoadingDir] = useState<string | null>(null);
  const [createDialog, setCreateDialog] = useState<CreateDialogState | null>(null);
  const [renameDialog, setRenameDialog] = useState<RenameDialogState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDeleteState | null>(null);
  const lastRefreshTokenRef = useRef(refreshToken);
  const lastCreateRequestRef = useRef(0);

  const loadFileTree = useCallback(async () => {
    if (!workspaceId || isLoading) return false;

    setIsLoading(true);
    const result = await dispatch<ReadTreeResult>("file.readTree", {
      workspaceId,
    });

    if (result.ok && result.data) {
      const treeMap = new Map<string, FileNode[]>();
      treeMap.set(".", result.data.children);
      setFileTree(treeMap);
      setLoadedDirs(new Set());
      setIsLoading(false);
      return true;
    }

    if (!result.ok) {
      console.error("Failed to load file tree:", result.error?.message);
    }

    setIsLoading(false);
    return false;
  }, [workspaceId, isLoading, dispatch, setFileTree, setLoadedDirs]);

  const loadChildren = useCallback(
    async (dirPath: string) => {
      const alreadyLoaded = loadedDirs.has(dirPath) && fileTree?.has(dirPath);
      if (!workspaceId || isLoadingDir === dirPath || alreadyLoaded) return;

      setIsLoadingDir(dirPath);
      const result = await dispatch<ReadTreeResult>("file.readTree", {
        workspaceId,
        subPath: dirPath,
      });

      if (result.ok && result.data) {
        setFileTree((prev) => {
          if (!prev) return prev;
          const next = new Map(prev);
          next.set(dirPath, result.data!.children);
          return next;
        });
        setLoadedDirs((prev) => new Set(prev).add(dirPath));
      }

      setIsLoadingDir(null);
    },
    [workspaceId, isLoadingDir, loadedDirs, fileTree, dispatch, setFileTree, setLoadedDirs]
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

    setActiveFilePath((current) =>
      current ? rewriteDescendantPath(current, renameDialog.fromPath, toPath) : current
    );
    setOpenFiles((current) => rewriteOpenFiles(current, renameDialog.fromPath, toPath));
    await loadFileTree();
    setRenameDialog(null);
  }, [dispatch, loadFileTree, renameDialog, setActiveFilePath, setOpenFiles, t, workspaceId]);

  const cancelDelete = useCallback(() => {
    setPendingDelete(null);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) {
      return;
    }

    const result = await dispatch("file.delete", {
      workspaceId,
      path: pendingDelete.path,
    });

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

    if (activeFilePath === pendingDelete.path) {
      setActiveFilePath(null);
    }

    setOpenFiles((prev) => {
      if (!(pendingDelete.path in prev)) {
        return prev;
      }

      const next = { ...prev };
      delete next[pendingDelete.path];
      return next;
    });
    await loadFileTree();
    setPendingDelete(null);
  }, [
    pendingDelete,
    dispatch,
    workspaceId,
    activeFilePath,
    setActiveFilePath,
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
      void openWorkspaceFile({
        workspaceId,
        path,
        source: "file-tree",
      });
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
    renameDialog,
    pendingDelete,
    cancelDelete,
    confirmDelete,
    handleSelectFile,
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
