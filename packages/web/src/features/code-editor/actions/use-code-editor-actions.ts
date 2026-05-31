import type { GitCommitFileEntry, GitFileDiffPayload } from "@coder-studio/core";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";
import { dispatchCommandAtom } from "../../../atoms/connection";
import { activeWorkspaceAtom } from "../../../atoms/workspaces";
import { useTranslation } from "../../../lib/i18n";
import { useOpenEditorsActions } from "../../workspace/actions/use-open-editors-actions";
import {
  activeFilePathAtomFamily,
  deriveDocumentPreviewKind,
  deriveEditorModeForOpenFile,
  editorModeAtomFamily,
  editorRefreshTokenAtomFamily,
  type GitDiffPreview,
  gitDiffPreviewAtomFamily,
  gitDiffPreviewDismissedAtomFamily,
  gitStateAtomFamily,
  type OpenFile,
  openFilesAtomFamily,
  type WorkspaceEditorMode,
} from "../../workspace/atoms";
import { monacoModelRegistry } from "../monaco/model-registry";
import {
  beginPendingEditorLoad,
  cancelPendingEditorLoad,
  finishPendingEditorLoad,
  hasPendingEditorLoad,
  shouldIgnorePendingEditorLoadResult,
} from "./pending-editor-loads";
import { usePreviewSession } from "./use-preview-session";

type FileReadTextPayload = {
  kind: "text";
  content: string;
  baseHash: string;
  encoding: "utf-8";
};

type FileReadImagePayload = {
  kind: "image";
  mime: string;
  url: string;
  size: number;
  version: string;
  isTextBacked: boolean;
};

type FileReadPayload = FileReadTextPayload | FileReadImagePayload;

export function useCodeEditorActions() {
  const t = useTranslation();
  const workspace = useAtomValue(activeWorkspaceAtom);
  const workspaceRootPath = workspace?.path;
  const dispatch = useAtomValue(dispatchCommandAtom);
  const setDiffPreview = useSetAtom(gitDiffPreviewAtomFamily(workspace?.id ?? ""));
  const setDiffPreviewDismissed = useSetAtom(
    gitDiffPreviewDismissedAtomFamily(workspace?.id ?? "")
  );

  const [savingPaths, setSavingPaths] = useState<Set<string>>(() => new Set());
  const savingPathsRef = useRef<Set<string>>(new Set());
  const [saveError, setSaveError] = useState<{ path: string; message: string } | null>(null);
  const [fileLoadError, setFileLoadError] = useState<{ path: string; message: string } | null>(
    null
  );
  const [externalStatus, setExternalStatus] = useState<{
    path: string;
    status: "modified" | "deleted";
  } | null>(null);

  const workspaceId = workspace?.id;
  const [activeFilePath] = useAtom(activeFilePathAtomFamily(workspaceId ?? ""));
  const [openFiles, setOpenFiles] = useAtom(openFilesAtomFamily(workspaceId ?? ""));
  const [mode, setMode] = useAtom(editorModeAtomFamily(workspaceId ?? ""));
  const editorRefreshToken = useAtomValue(editorRefreshTokenAtomFamily(workspaceId ?? ""));
  const diffPreview = useAtomValue(gitDiffPreviewAtomFamily(workspaceId ?? ""));
  const gitState = useAtomValue(gitStateAtomFamily(workspaceId ?? ""));
  const lastSeededModePathRef = useRef<string | null>(null);
  const pendingActivePathRef = useRef<string | null>(null);
  const nextSaveRequestIdRef = useRef(0);
  const activeSaveRequestIdByPathRef = useRef<Map<string, number>>(new Map());
  const nextCommitDiffRequestIdRef = useRef(0);
  const previousOpenFilePathsRef = useRef<string[] | null>(null);
  const { closePath } = useOpenEditorsActions(workspaceId ?? "", {
    workspaceRootPath,
  });

  const currentFile: OpenFile | undefined = workspaceId
    ? openFiles[activeFilePath ?? ""]
    : undefined;

  useEffect(() => {
    if (!activeFilePath) {
      lastSeededModePathRef.current = null;
      return;
    }

    if (!workspaceId || !currentFile || lastSeededModePathRef.current === activeFilePath) {
      return;
    }

    lastSeededModePathRef.current = activeFilePath;
    const shouldPreserveDiffMode =
      mode === "diff" &&
      (diffPreview?.kind === "worktree-file-diff" ||
        diffPreview?.kind === "search-replace-file-diff") &&
      diffPreview.path === activeFilePath;
    const nextMode = shouldPreserveDiffMode ? "diff" : deriveEditorModeForOpenFile(currentFile);
    if (nextMode !== mode) {
      setMode(nextMode);
    }
  }, [activeFilePath, currentFile, diffPreview, mode, setMode, workspaceId]);

  useEffect(() => {
    setSaveError((current) => (current?.path === activeFilePath ? current : null));
    setFileLoadError((current) => (current?.path === activeFilePath ? current : null));
    setExternalStatus((current) => (current?.path === activeFilePath ? current : null));
  }, [activeFilePath]);

  const invalidateSaveStateForPaths = useCallback((paths: string[]) => {
    if (paths.length === 0) {
      return;
    }

    const removedPaths = new Set(paths);
    for (const path of removedPaths) {
      activeSaveRequestIdByPathRef.current.delete(path);
    }

    setSavingPaths((current) => {
      let changed = false;
      const next = new Set(current);
      for (const path of removedPaths) {
        if (next.delete(path)) {
          changed = true;
        }
      }

      savingPathsRef.current = changed ? next : current;
      return changed ? next : current;
    });
    setSaveError((current) => (current && removedPaths.has(current.path) ? null : current));
  }, []);

  useEffect(() => {
    const currentOpenFilePaths = Object.keys(openFiles);
    if (previousOpenFilePathsRef.current === null) {
      previousOpenFilePathsRef.current = currentOpenFilePaths;
      return;
    }

    const removedPaths = previousOpenFilePathsRef.current.filter((path) => !(path in openFiles));
    previousOpenFilePathsRef.current = currentOpenFilePaths;
    invalidateSaveStateForPaths(removedPaths);
  }, [invalidateSaveStateForPaths, openFiles]);

  useEffect(() => {
    if (!workspaceId) {
      pendingActivePathRef.current = null;
      return;
    }

    const nextPendingActivePath =
      activeFilePath && !openFiles[activeFilePath] ? activeFilePath : null;
    const previousPendingActivePath = pendingActivePathRef.current;

    if (previousPendingActivePath && previousPendingActivePath !== nextPendingActivePath) {
      cancelPendingEditorLoad(workspaceId, previousPendingActivePath);
    }

    pendingActivePathRef.current = nextPendingActivePath;
  }, [activeFilePath, openFiles, workspaceId]);

  const loadFile = useCallback(
    async (path: string, options?: { forceText?: boolean }) => {
      if (!workspaceId) {
        return;
      }

      const requestId = beginPendingEditorLoad(workspaceId, path);
      setFileLoadError((current) => (current?.path === path ? null : current));
      const result = await dispatch<FileReadPayload>("file.read", {
        workspaceId,
        path,
      });

      if (shouldIgnorePendingEditorLoadResult(workspaceId, path, requestId)) {
        return;
      }

      if (!result.ok || !result.data) {
        finishPendingEditorLoad(workspaceId, path, requestId);
        const message = result.error?.message ?? t("code_editor.open_failed_title");
        console.error("Failed to open file:", message);
        setFileLoadError({ path, message });
        return;
      }

      const data = result.data;

      if (options?.forceText && data.kind === "image" && data.isTextBacked) {
        try {
          const response = await fetch(data.url, { credentials: "include" });
          if (shouldIgnorePendingEditorLoadResult(workspaceId, path, requestId)) {
            return;
          }

          if (!response.ok) {
            finishPendingEditorLoad(workspaceId, path, requestId);
            const message = `${t("code_editor.text_backed_image_load_failed")}: ${response.status}`;
            console.error(message);
            setFileLoadError({ path, message });
            return;
          }

          const content = await response.text();
          if (shouldIgnorePendingEditorLoadResult(workspaceId, path, requestId)) {
            return;
          }

          const newFile: OpenFile = {
            kind: "text",
            path,
            content,
            savedContent: content,
            baseHash: "",
            isDirty: false,
            viewingTextBackedImageAsText: true,
          };

          finishPendingEditorLoad(workspaceId, path, requestId);
          setOpenFiles((prev) => ({ ...prev, [path]: newFile }));
          if (workspaceRootPath) {
            monacoModelRegistry.updateFromDisk({
              workspaceRootPath,
              path,
              content,
            });
          }
          setFileLoadError((current) => (current?.path === path ? null : current));
        } catch (error) {
          finishPendingEditorLoad(workspaceId, path, requestId);
          const message =
            error instanceof Error ? error.message : t("code_editor.text_backed_image_load_failed");
          console.error("Failed to fetch text-backed image bytes:", error);
          setFileLoadError({ path, message });
        }

        return;
      }

      const newFile: OpenFile =
        data.kind === "text"
          ? {
              kind: "text",
              path,
              content: data.content,
              savedContent: data.content,
              baseHash: data.baseHash,
              isDirty: false,
              externalState: undefined,
            }
          : {
              kind: "image",
              path,
              mime: data.mime,
              url: data.url,
              size: data.size,
              version: data.version,
              isTextBacked: data.isTextBacked,
              externalState: undefined,
            };

      finishPendingEditorLoad(workspaceId, path, requestId);
      setOpenFiles((prev) => ({ ...prev, [path]: newFile }));
      if (workspaceRootPath && data.kind === "text") {
        monacoModelRegistry.updateFromDisk({
          workspaceRootPath,
          path,
          content: data.content,
        });
      }
      setExternalStatus((current) => (current?.path === path ? null : current));
      setFileLoadError((current) => (current?.path === path ? null : current));
    },
    [dispatch, setOpenFiles, t, workspaceId, workspaceRootPath]
  );

  const loadTextBackedImageContent = useCallback(
    async (url: string) => {
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) {
        throw new Error(`${t("code_editor.text_backed_image_load_failed")}: ${response.status}`);
      }

      return response.text();
    },
    [t]
  );

  const handleSave = useCallback(async () => {
    if (!workspaceId || !currentFile || currentFile.kind !== "text") {
      return;
    }

    const { path, content, baseHash } = currentFile;
    if (savingPathsRef.current.has(path)) {
      return;
    }

    const requestId = ++nextSaveRequestIdRef.current;
    activeSaveRequestIdByPathRef.current.set(path, requestId);
    const nextSavingPaths = new Set(savingPathsRef.current);
    nextSavingPaths.add(path);
    savingPathsRef.current = nextSavingPaths;
    setSavingPaths(nextSavingPaths);
    setSaveError((current) => (current?.path === path ? null : current));

    const result = await dispatch<{ newHash: string }>("file.write", {
      workspaceId,
      path,
      content,
      baseHash: baseHash || undefined,
    });

    if (activeSaveRequestIdByPathRef.current.get(path) !== requestId) {
      return;
    }

    if (result.ok && result.data) {
      setOpenFiles((prev) => {
        const prevFile = prev[path];
        if (!prevFile || prevFile.kind !== "text") {
          return prev;
        }

        return {
          ...prev,
          [path]: {
            ...prevFile,
            savedContent: content,
            baseHash: result.data!.newHash,
            isDirty: false,
            externalState: undefined,
          },
        };
      });
      setExternalStatus((current) => (current?.path === path ? null : current));
    } else {
      setSaveError({ path, message: result.error?.message ?? t("code_editor.save_failed_title") });
    }

    activeSaveRequestIdByPathRef.current.delete(path);
    const nextSavingPathsAfterSave = new Set(savingPathsRef.current);
    nextSavingPathsAfterSave.delete(path);
    savingPathsRef.current = nextSavingPathsAfterSave;
    setSavingPaths(nextSavingPathsAfterSave);
  }, [currentFile, dispatch, setOpenFiles, t, workspaceId]);

  const handleContentChange = useCallback(
    (newContent: string) => {
      if (!workspaceId || !currentFile || currentFile.kind !== "text") {
        return;
      }

      setOpenFiles((prev) => {
        const prevFile = prev[currentFile.path];
        if (!prevFile || prevFile.kind !== "text") {
          return prev;
        }

        return {
          ...prev,
          [currentFile.path]: {
            ...prevFile,
            content: newContent,
            isDirty: newContent !== prevFile.savedContent,
          },
        };
      });
    },
    [currentFile, setOpenFiles, workspaceId]
  );

  useEffect(() => {
    if (!workspaceId || !activeFilePath) {
      return;
    }

    if (openFiles[activeFilePath]) {
      return;
    }

    if (hasPendingEditorLoad(workspaceId, activeFilePath)) {
      return;
    }

    void loadFile(activeFilePath);
  }, [activeFilePath, loadFile, openFiles, workspaceId]);

  useEffect(() => {
    if (!workspaceId || editorRefreshToken <= 0) {
      return;
    }

    const entries = Object.entries(openFiles);
    if (entries.length === 0) {
      return;
    }

    let cancelled = false;

    const reconcileOpenFiles = async () => {
      for (const [path, file] of entries) {
        const result = await dispatch<FileReadPayload>("file.read", {
          workspaceId,
          path,
        });

        if (cancelled) {
          return;
        }

        if (!result.ok || !result.data) {
          const isMissing = result.error?.code === "not_found";
          setOpenFiles((prev) => {
            const existing = prev[path];
            if (!existing) {
              return prev;
            }
            return {
              ...prev,
              [path]: {
                ...existing,
                externalState: isMissing ? "deleted" : existing.externalState,
              },
            };
          });
          if (isMissing && activeFilePath === path) {
            setExternalStatus({ path, status: "deleted" });
          }
          continue;
        }

        const nextData = result.data;

        if (file.kind === "text" && nextData.kind === "text") {
          const hasChangedOnDisk = nextData.baseHash !== file.baseHash;
          if (!hasChangedOnDisk) {
            continue;
          }

          if (file.isDirty) {
            setOpenFiles((prev) => {
              const existing = prev[path];
              if (!existing || existing.kind !== "text") {
                return prev;
              }
              return {
                ...prev,
                [path]: {
                  ...existing,
                  externalState: "modified",
                },
              };
            });
            if (activeFilePath === path) {
              setExternalStatus({ path, status: "modified" });
            }
            continue;
          }

          setOpenFiles((prev) => ({
            ...prev,
            [path]: {
              kind: "text",
              path,
              content: nextData.content,
              savedContent: nextData.content,
              baseHash: nextData.baseHash,
              isDirty: false,
              externalState: undefined,
              viewingTextBackedImageAsText: file.viewingTextBackedImageAsText,
            },
          }));
          if (workspaceRootPath) {
            monacoModelRegistry.updateFromDisk({
              workspaceRootPath,
              path,
              content: nextData.content,
            });
          }
          if (activeFilePath === path) {
            setExternalStatus((current) => (current?.path === path ? null : current));
          }
          continue;
        }

        if (
          file.kind === "text" &&
          file.viewingTextBackedImageAsText === true &&
          nextData.kind === "image" &&
          nextData.isTextBacked
        ) {
          if (file.isDirty) {
            setOpenFiles((prev) => {
              const existing = prev[path];
              if (!existing || existing.kind !== "text") {
                return prev;
              }

              return {
                ...prev,
                [path]: {
                  ...existing,
                  externalState: "modified",
                },
              };
            });

            if (activeFilePath === path) {
              setExternalStatus({
                path,
                status: "modified",
              });
            }
            continue;
          }

          try {
            const content = await loadTextBackedImageContent(nextData.url);
            if (cancelled) {
              return;
            }

            setOpenFiles((prev) => {
              const existing = prev[path];
              if (!existing || existing.kind !== "text") {
                return prev;
              }

              return {
                ...prev,
                [path]: {
                  ...existing,
                  content,
                  savedContent: content,
                  baseHash: nextData.version,
                  isDirty: false,
                  externalState: undefined,
                  viewingTextBackedImageAsText: true,
                },
              };
            });

            if (activeFilePath === path) {
              setExternalStatus((current) => (current?.path === path ? null : current));
            }
          } catch (error) {
            console.error("Failed to refresh text-backed image bytes:", error);
            setOpenFiles((prev) => {
              const existing = prev[path];
              if (!existing || existing.kind !== "text") {
                return prev;
              }

              return {
                ...prev,
                [path]: {
                  ...existing,
                  externalState: "modified",
                },
              };
            });

            if (activeFilePath === path) {
              setExternalStatus({
                path,
                status: "modified",
              });
            }
          }
          continue;
        }

        if (file.kind === "image" && nextData.kind === "image") {
          if (file.version === nextData.version && file.size === nextData.size) {
            continue;
          }

          setOpenFiles((prev) => ({
            ...prev,
            [path]: {
              kind: "image",
              path,
              mime: nextData.mime,
              url: nextData.url,
              size: nextData.size,
              version: nextData.version,
              isTextBacked: nextData.isTextBacked,
              externalState: undefined,
            },
          }));
          if (activeFilePath === path) {
            setExternalStatus((current) => (current?.path === path ? null : current));
          }
          continue;
        }

        setOpenFiles((prev) => {
          const next = { ...prev };
          delete next[path];
          return next;
        });
        if (activeFilePath === path) {
          setExternalStatus({ path, status: "modified" });
        }
      }
    };

    void reconcileOpenFiles();

    return () => {
      cancelled = true;
    };
  }, [
    activeFilePath,
    dispatch,
    editorRefreshToken,
    loadTextBackedImageContent,
    openFiles,
    setOpenFiles,
    workspaceId,
    workspaceRootPath,
  ]);

  const handleClose = useCallback(async () => {
    if (diffPreview?.kind === "commit-file-diff") {
      setDiffPreview(diffPreview.parentList);
      return;
    }

    if (diffPreview?.kind === "commit-file-list") {
      setDiffPreview(null);
      if (currentFile) {
        const nextMode = deriveEditorModeForOpenFile(currentFile);
        if (nextMode !== mode) {
          setMode(nextMode);
        }
      }
      return;
    }

    if (currentFile?.path || activeFilePath) {
      closePath(currentFile?.path ?? activeFilePath ?? undefined);
    }

    setSaveError(null);
  }, [activeFilePath, closePath, currentFile, diffPreview, mode, setDiffPreview, setMode]);

  const toggleSvgTextMode = useCallback(() => {
    if (!workspaceId || !currentFile) {
      return;
    }

    const path = currentFile.path;
    const wantText = currentFile.kind === "image";
    setMode(wantText ? "edit" : "preview");

    setOpenFiles((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });
    if (workspaceRootPath && currentFile.kind === "text") {
      monacoModelRegistry.disposeFile(workspaceRootPath, path);
    }

    void loadFile(path, wantText ? { forceText: true } : undefined);
  }, [currentFile, loadFile, setMode, setOpenFiles, workspaceId, workspaceRootPath]);

  const openInDiffMode = useCallback(async () => {
    if (!workspaceId || !currentFile) {
      return false;
    }

    const result = await dispatch<GitFileDiffPayload>("git.diff", {
      workspaceId,
      path: currentFile.path,
      staged: false,
    });

    if (!result.ok || !result.data) {
      return false;
    }

    const nextPreview = {
      kind: "worktree-file-diff",
      path: currentFile.path,
      diff: result.data.diff,
      staged: false,
      ...(result.data.renderAs ? { renderAs: result.data.renderAs } : {}),
      ...(result.data.status ? { status: result.data.status } : {}),
      ...(result.data.mime ? { mime: result.data.mime } : {}),
      ...(result.data.originalPath ? { originalPath: result.data.originalPath } : {}),
      ...(result.data.modifiedPath ? { modifiedPath: result.data.modifiedPath } : {}),
      ...(result.data.originalContent !== undefined
        ? { originalContent: result.data.originalContent }
        : {}),
      ...(result.data.modifiedContent !== undefined
        ? { modifiedContent: result.data.modifiedContent }
        : {}),
      ...(result.data.originalRevision ? { originalRevision: result.data.originalRevision } : {}),
      ...(result.data.modifiedRevision ? { modifiedRevision: result.data.modifiedRevision } : {}),
    } as GitDiffPreview;
    setDiffPreviewDismissed(false);
    setDiffPreview(nextPreview);
    setMode("diff");
    return true;
  }, [currentFile, dispatch, setDiffPreview, setDiffPreviewDismissed, setMode, workspaceId]);

  const openCommitFileDiff = useCallback(
    async (file: GitCommitFileEntry) => {
      if (!workspaceId || diffPreview?.kind !== "commit-file-list") {
        return false;
      }

      const parentList = diffPreview;
      const requestId = nextCommitDiffRequestIdRef.current + 1;
      nextCommitDiffRequestIdRef.current = requestId;

      const result = await dispatch<GitFileDiffPayload>("git.commitFileDiff", {
        workspaceId,
        sha: parentList.commit.sha,
        path: file.path,
        ...(file.oldPath ? { oldPath: file.oldPath } : {}),
      });

      if (!result.ok || !result.data) {
        return false;
      }

      const payload = result.data;

      let applied = false;
      setDiffPreview((current) => {
        if (requestId !== nextCommitDiffRequestIdRef.current) {
          return current;
        }

        if (
          current?.kind !== "commit-file-list" ||
          current !== parentList ||
          current.path !== parentList.path ||
          current.commit.sha !== parentList.commit.sha
        ) {
          return current;
        }

        applied = true;
        return {
          kind: "commit-file-diff",
          path: file.path,
          title: file.path,
          commit: parentList.commit,
          file,
          parentList,
          diff: payload.diff,
          renderAs: payload.renderAs,
          status: payload.status,
          ...(payload.mime ? { mime: payload.mime } : {}),
          ...(payload.originalPath ? { originalPath: payload.originalPath } : {}),
          ...(payload.modifiedPath ? { modifiedPath: payload.modifiedPath } : {}),
          ...(payload.originalContent !== undefined
            ? { originalContent: payload.originalContent }
            : {}),
          ...(payload.modifiedContent !== undefined
            ? { modifiedContent: payload.modifiedContent }
            : {}),
          ...(payload.originalRevision ? { originalRevision: payload.originalRevision } : {}),
          ...(payload.modifiedRevision ? { modifiedRevision: payload.modifiedRevision } : {}),
        };
      });
      return applied;
    },
    [diffPreview, dispatch, setDiffPreview, workspaceId]
  );

  const isTextFile = currentFile?.kind === "text";
  const isImageFile = currentFile?.kind === "image";
  const isSvgTextBacked =
    (isImageFile && currentFile.isTextBacked) ||
    (isTextFile && currentFile.viewingTextBackedImageAsText === true);
  const canPreview = Boolean(currentFile);
  const canEdit =
    Boolean(currentFile) &&
    (currentFile?.kind === "text" || (currentFile?.kind === "image" && currentFile.isTextBacked));
  const activeFileHasGitChange = Boolean(
    activeFilePath &&
      gitState &&
      [...gitState.staged, ...gitState.modified, ...gitState.deleted, ...gitState.untracked].some(
        (change) => change.path === activeFilePath
      )
  );
  const canDiff = Boolean(activeFilePath && activeFileHasGitChange);
  const hasUnsavedChangesOutsideDiff = Boolean(
    mode === "diff" && activeFilePath && currentFile?.kind === "text" && currentFile.isDirty
  );
  const activeDiffChange =
    diffPreview &&
    (((diffPreview.kind === "worktree-file-diff" ||
      diffPreview.kind === "search-replace-file-diff") &&
      diffPreview.path === activeFilePath) ||
      diffPreview.kind === "commit-file-list" ||
      diffPreview.kind === "commit-file-diff")
      ? diffPreview
      : null;
  const isSaving = Boolean(isTextFile && savingPaths.has(currentFile.path));
  const canSave = Boolean(isTextFile && currentFile.isDirty && !isSaving);
  useEffect(() => {
    const handleSaveShortcut = (event: KeyboardEvent) => {
      const isSaveShortcut =
        event.key.toLowerCase() === "s" && (event.ctrlKey || event.metaKey) && !event.altKey;
      if (!isSaveShortcut) {
        return;
      }

      if (!isTextFile) {
        return;
      }

      event.preventDefault();
      if (canSave) {
        void handleSave();
      }
    };

    window.addEventListener("keydown", handleSaveShortcut);
    return () => {
      window.removeEventListener("keydown", handleSaveShortcut);
    };
  }, [canSave, handleSave, isTextFile]);

  const activeLoadError =
    activeFilePath && fileLoadError?.path === activeFilePath ? fileLoadError.message : null;
  const activeExternalStatus =
    activeFilePath && externalStatus?.path === activeFilePath ? externalStatus.status : null;
  const activeSaveError =
    activeFilePath && saveError?.path === activeFilePath ? saveError.message : null;
  const documentPreviewKind =
    currentFile?.kind === "text" ? deriveDocumentPreviewKind(currentFile.path) : null;
  const documentPreview = usePreviewSession({
    enabled: mode === "preview" && Boolean(documentPreviewKind),
    workspaceId,
    filePath: currentFile?.kind === "text" ? currentFile.path : null,
    content: currentFile?.kind === "text" ? currentFile.content : undefined,
    kind: documentPreviewKind,
  });

  return {
    activeFilePath,
    activeDiffChange,
    activeExternalStatus,
    activeLoadError,
    canSave,
    canDiff,
    canEdit,
    canPreview,
    currentFile,
    documentPreview,
    handleClose,
    handleContentChange,
    handleSave,
    hasUnsavedChangesOutsideDiff,
    isImageFile,
    isSaving,
    isSvgTextBacked,
    isTextFile,
    mode,
    openCommitFileDiff,
    openInDiffMode,
    saveError: activeSaveError,
    setMode: (nextMode: WorkspaceEditorMode) => {
      setMode(nextMode);
    },
    toggleSvgTextMode,
    workspace,
    workspaceId,
  };
}
