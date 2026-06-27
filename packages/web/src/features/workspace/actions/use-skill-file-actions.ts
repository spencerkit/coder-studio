import type { FileNode } from "@coder-studio/core";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useRef, useState } from "react";
import { dispatchCommandAtom } from "../../../atoms/connection";
import { useTranslation } from "../../../lib/i18n";
import { useOpenLocation } from "../../code-editor/actions/use-open-location";
import { toSkillEditorPath } from "../../code-editor/skill-editor-path";
import {
  activeFilePathAtomFamily,
  type OpenFile,
  openEditorPathsAtomFamily,
  openFilesAtomFamily,
} from "../atoms";
import {
  customSkillCreateDialogAtomFamily,
  customSkillExpandedDirsAtomFamily,
  customSkillFileTreeAtomFamily,
  customSkillLoadedDirsAtomFamily,
  customSkillPendingDeleteAtomFamily,
  customSkillRenameDialogAtomFamily,
} from "../atoms/skills";
import {
  applyDirectoryRefresh,
  applyRootTreeRefresh,
  collectRefreshTargets,
} from "./file-tree-refresh";
import {
  appendOpenEditorPath,
  normalizeOpenEditorPaths,
  rewriteDescendantEditorPath,
  rewriteOpenEditorPaths,
} from "./open-editor-state";
import type { CreateDialogState, PendingDeleteState, RenameDialogState } from "./use-file-actions";
import { useWorkspaceUiStatePersistence } from "./use-workspace-ui-state-persistence";

interface ReadTreeResult {
  path: string;
  children: FileNode[];
}

interface UseSkillFileActionsArgs {
  workspaceId: string;
  skillSlug: string;
}

const FILE_DELETE_TIMEOUT_MS = 180_000;

function isReadTreeResult(value: unknown): value is ReadTreeResult {
  if (!value || typeof value !== "object") {
    return false;
  }

  return Array.isArray((value as ReadTreeResult).children);
}

function toSkillFilePath(skillSlug: string, relativePath: string): string {
  return toSkillEditorPath(skillSlug, relativePath);
}

function rewriteDescendantPath(path: string, fromPath: string, toPath: string): string {
  return rewriteDescendantEditorPath(path, fromPath, toPath);
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

export function useSkillFileActions({ workspaceId, skillSlug }: UseSkillFileActionsArgs) {
  const t = useTranslation();
  const dispatch = useAtomValue(dispatchCommandAtom);
  const fileTree = useAtomValue(customSkillFileTreeAtomFamily(workspaceId)(skillSlug));
  const loadedDirs = useAtomValue(customSkillLoadedDirsAtomFamily(workspaceId)(skillSlug));
  const expandedDirs = useAtomValue(customSkillExpandedDirsAtomFamily(workspaceId)(skillSlug));
  const createDialog = useAtomValue(customSkillCreateDialogAtomFamily(workspaceId)(skillSlug));
  const renameDialog = useAtomValue(customSkillRenameDialogAtomFamily(workspaceId)(skillSlug));
  const pendingDelete = useAtomValue(customSkillPendingDeleteAtomFamily(workspaceId)(skillSlug));
  const activeFilePath = useAtomValue(activeFilePathAtomFamily(workspaceId));
  const openEditorPaths = useAtomValue(openEditorPathsAtomFamily(workspaceId));
  const openFiles = useAtomValue(openFilesAtomFamily(workspaceId));
  const setFileTree = useSetAtom(customSkillFileTreeAtomFamily(workspaceId)(skillSlug));
  const setLoadedDirs = useSetAtom(customSkillLoadedDirsAtomFamily(workspaceId)(skillSlug));
  const setExpandedDirs = useSetAtom(customSkillExpandedDirsAtomFamily(workspaceId)(skillSlug));
  const setCreateDialog = useSetAtom(customSkillCreateDialogAtomFamily(workspaceId)(skillSlug));
  const setRenameDialog = useSetAtom(customSkillRenameDialogAtomFamily(workspaceId)(skillSlug));
  const setPendingDelete = useSetAtom(customSkillPendingDeleteAtomFamily(workspaceId)(skillSlug));
  const setActiveFilePath = useSetAtom(activeFilePathAtomFamily(workspaceId));
  const setOpenEditorPaths = useSetAtom(openEditorPathsAtomFamily(workspaceId));
  const setOpenFiles = useSetAtom(openFilesAtomFamily(workspaceId));
  const { openLocation } = useOpenLocation(workspaceId);
  const { persistUiState } = useWorkspaceUiStatePersistence(workspaceId);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingDir, setIsLoadingDir] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const deleteInFlightRef = useRef(false);

  const loadFileTree = useCallback(async () => {
    if (!workspaceId || !skillSlug || isLoading) {
      return false;
    }

    setIsLoading(true);
    try {
      const result = await dispatch<ReadTreeResult>("skills.files.readTree", {
        workspaceId,
        skillSlug,
      });

      if (!result.ok || !isReadTreeResult(result.data)) {
        return false;
      }

      const reconciled = applyRootTreeRefresh({
        previousTree: fileTree,
        previousLoadedDirs: loadedDirs,
        previousExpandedDirs: expandedDirs,
        rootChildren: result.data.children,
      });

      let currentTree = reconciled.tree;
      let currentLoadedDirs = reconciled.loadedDirs;

      setFileTree(currentTree);
      setLoadedDirs(currentLoadedDirs);
      setExpandedDirs(reconciled.prunedExpandedDirs);

      for (const dirPath of collectRefreshTargets(reconciled.prunedExpandedDirs)) {
        const childResult = await dispatch<ReadTreeResult>("skills.files.readTree", {
          workspaceId,
          skillSlug,
          path: dirPath,
        });

        if (!childResult.ok || !isReadTreeResult(childResult.data)) {
          continue;
        }

        const refreshed = applyDirectoryRefresh({
          previousTree: currentTree,
          previousLoadedDirs: currentLoadedDirs,
          previousExpandedDirs: reconciled.prunedExpandedDirs,
          dirPath,
          children: childResult.data.children,
        });

        currentTree = refreshed.tree;
        currentLoadedDirs = new Set(refreshed.loadedDirs).add(dirPath);
        setFileTree(currentTree);
        setLoadedDirs(currentLoadedDirs);
      }

      return true;
    } finally {
      setIsLoading(false);
    }
  }, [
    dispatch,
    expandedDirs,
    fileTree,
    isLoading,
    loadedDirs,
    setExpandedDirs,
    setFileTree,
    setLoadedDirs,
    skillSlug,
    workspaceId,
  ]);

  const loadChildren = useCallback(
    async (dirPath: string) => {
      if (!workspaceId || !skillSlug || isLoadingDir === dirPath) {
        return false;
      }

      if (expandedDirs.has(dirPath)) {
        setExpandedDirs((current) => {
          const next = new Set(current);
          next.delete(dirPath);
          return next;
        });
        return true;
      }

      setIsLoadingDir(dirPath);
      try {
        const result = await dispatch<ReadTreeResult>("skills.files.readTree", {
          workspaceId,
          skillSlug,
          path: dirPath,
        });

        if (!result.ok || !isReadTreeResult(result.data)) {
          return false;
        }

        const refreshed = applyDirectoryRefresh({
          previousTree: fileTree,
          previousLoadedDirs: loadedDirs,
          previousExpandedDirs: expandedDirs,
          dirPath,
          children: result.data.children,
        });

        setFileTree(refreshed.tree);
        setLoadedDirs(new Set(refreshed.loadedDirs).add(dirPath));
        setExpandedDirs((current) => new Set(current).add(dirPath));
        return true;
      } finally {
        setIsLoadingDir(null);
      }
    },
    [
      dispatch,
      expandedDirs,
      fileTree,
      isLoadingDir,
      loadedDirs,
      setExpandedDirs,
      setFileTree,
      setLoadedDirs,
      skillSlug,
      workspaceId,
    ]
  );

  const openSkillFile = useCallback(
    async (relativePath: string, source: "manual" | "file-tree" = "manual") => {
      const path = toSkillFilePath(skillSlug, relativePath);
      await openLocation({
        workspaceId,
        path,
        source,
      });
      const nextOpenEditorPaths = appendOpenEditorPath(openEditorPaths, path);
      setOpenEditorPaths(nextOpenEditorPaths);
      void persistUiState({
        openEditorPaths: nextOpenEditorPaths,
        activeEditorPath: path,
      });
    },
    [openEditorPaths, openLocation, persistUiState, setOpenEditorPaths, skillSlug, workspaceId]
  );

  const openCreateDialog = useCallback(
    (mode: "file" | "folder", baseDir: string | null) => {
      const normalizedBaseDir = baseDir ? `${baseDir.replace(/\/+$/, "")}/` : "";
      setCreateDialog({
        mode,
        draftPath: normalizedBaseDir,
        error: null,
      });
    },
    [setCreateDialog]
  );

  const closeCreateDialog = useCallback(() => {
    setCreateDialog(null);
  }, [setCreateDialog]);

  const updateDraftPath = useCallback(
    (draftPath: string) => {
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
    },
    [setCreateDialog]
  );

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
    [setRenameDialog]
  );

  const closeRenameDialog = useCallback(() => {
    setRenameDialog(null);
  }, [setRenameDialog]);

  const updateRenameDraft = useCallback(
    (nextName: string) => {
      setRenameDialog((current) =>
        current
          ? {
              ...current,
              nextName,
              error: null,
            }
          : current
      );
    },
    [setRenameDialog]
  );

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

    const op = createDialog.mode === "file" ? "skills.files.create" : "skills.files.mkdir";
    const result = await dispatch(op, {
      workspaceId,
      skillSlug,
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
      await openSkillFile(path);
    }
  }, [
    closeCreateDialog,
    createDialog,
    dispatch,
    loadFileTree,
    openSkillFile,
    setCreateDialog,
    skillSlug,
    t,
  ]);

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

    const result = await dispatch("skills.files.rename", {
      workspaceId,
      skillSlug,
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

    const fromEditorPath = toSkillFilePath(skillSlug, renameDialog.fromPath);
    const toEditorPath = toSkillFilePath(skillSlug, toPath);

    const nextActiveFilePath = activeFilePath
      ? rewriteDescendantPath(activeFilePath, fromEditorPath, toEditorPath)
      : activeFilePath;
    const nextOpenEditorPaths = rewriteOpenEditorPaths(
      openEditorPaths,
      fromEditorPath,
      toEditorPath
    );

    setActiveFilePath(nextActiveFilePath);
    setOpenEditorPaths(nextOpenEditorPaths);
    setOpenFiles((current) => rewriteOpenFiles(current, fromEditorPath, toEditorPath));
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
    persistUiState,
    renameDialog,
    setActiveFilePath,
    setOpenEditorPaths,
    setOpenFiles,
    setRenameDialog,
    skillSlug,
    t,
  ]);

  const cancelDelete = useCallback(() => {
    if (deleteInFlightRef.current) {
      return;
    }

    setPendingDelete(null);
  }, [setPendingDelete]);

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete || deleteInFlightRef.current) {
      return;
    }

    deleteInFlightRef.current = true;
    setIsDeleting(true);
    try {
      const result = await dispatch(
        "skills.files.delete",
        {
          workspaceId,
          skillSlug,
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

      const targetEditorPath = toSkillFilePath(skillSlug, pendingDelete.path);
      const nextActiveFilePath =
        activeFilePath && isSameOrDescendantPath(activeFilePath, targetEditorPath)
          ? null
          : activeFilePath;
      const nextOpenEditorPaths = removeDeletedEditorPaths(openEditorPaths, targetEditorPath);
      const nextOpenFiles = removeDeletedOpenFiles(openFiles, targetEditorPath);
      const nextTree = removeDeletedTreeEntries(fileTree, pendingDelete.path);
      const nextLoadedDirs = removeDeletedDirPaths(loadedDirs, pendingDelete.path);
      const nextExpandedDirs = removeDeletedDirPaths(expandedDirs, pendingDelete.path);

      if (activeFilePath !== nextActiveFilePath) {
        setActiveFilePath(nextActiveFilePath);
      }

      setOpenEditorPaths(nextOpenEditorPaths);
      setOpenFiles(nextOpenFiles);
      setFileTree(nextTree);
      setLoadedDirs(nextLoadedDirs);
      setExpandedDirs(nextExpandedDirs);
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
    activeFilePath,
    dispatch,
    expandedDirs,
    fileTree,
    loadFileTree,
    loadedDirs,
    openEditorPaths,
    openFiles,
    pendingDelete,
    persistUiState,
    setActiveFilePath,
    setExpandedDirs,
    setFileTree,
    setLoadedDirs,
    setOpenEditorPaths,
    setOpenFiles,
    setPendingDelete,
    skillSlug,
    t,
  ]);

  return {
    activeFilePath,
    createDialog,
    expandedDirs,
    fileTree,
    isDeleting,
    isLoading,
    isLoadingDir,
    pendingDelete,
    renameDialog,
    cancelDelete,
    closeCreateDialog,
    closeRenameDialog,
    confirmDelete,
    loadChildren,
    loadFileTree,
    openCreateDialog,
    openRenameDialog,
    openSkillFile,
    requestDelete: setPendingDelete,
    submitCreateDialog,
    submitRenameDialog,
    updateDraftPath,
    updateRenameDraft,
  };
}
