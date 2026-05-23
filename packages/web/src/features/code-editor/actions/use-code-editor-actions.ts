import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";
import { dispatchCommandAtom } from "../../../atoms/connection";
import { activeWorkspaceAtom } from "../../../atoms/workspaces";
import { useOpenEditorsActions } from "../../workspace/actions/use-open-editors-actions";
import {
  activeFilePathAtomFamily,
  deriveDocumentPreviewKind,
  deriveEditorModeForOpenFile,
  editorModeAtomFamily,
  editorRefreshTokenAtomFamily,
  type GitDiffPreview,
  gitDiffPreviewAtomFamily,
  gitStateAtomFamily,
  type OpenFile,
  openFilesAtomFamily,
  type WorkspaceEditorMode,
} from "../../workspace/atoms";
import { monacoModelRegistry } from "../monaco/model-registry";
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

type GitDiffPayload = {
  diff: string;
  renderAs: "text" | "image";
  status: "modified" | "added" | "deleted";
  originalContent?: string;
  modifiedContent?: string;
  originalRevision?: "HEAD" | "INDEX";
  modifiedRevision?: "INDEX" | "WORKTREE";
};

export function useCodeEditorActions() {
  const workspace = useAtomValue(activeWorkspaceAtom);
  const workspaceRootPath = workspace?.path;
  const dispatch = useAtomValue(dispatchCommandAtom);
  const setDiffPreview = useSetAtom(gitDiffPreviewAtomFamily(workspace?.id ?? ""));

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fileLoadError, setFileLoadError] = useState<{ path: string; message: string } | null>(
    null
  );
  const [externalStatus, setExternalStatus] = useState<{
    path: string;
    status: "modified" | "deleted";
  } | null>(null);

  const workspaceId = workspace?.id;
  const [activeFilePath, setActiveFilePath] = useAtom(activeFilePathAtomFamily(workspaceId ?? ""));
  const [openFiles, setOpenFiles] = useAtom(openFilesAtomFamily(workspaceId ?? ""));
  const [mode, setMode] = useAtom(editorModeAtomFamily(workspaceId ?? ""));
  const editorRefreshToken = useAtomValue(editorRefreshTokenAtomFamily(workspaceId ?? ""));
  const diffPreview = useAtomValue(gitDiffPreviewAtomFamily(workspaceId ?? ""));
  const gitState = useAtomValue(gitStateAtomFamily(workspaceId ?? ""));
  const lastSeededModePathRef = useRef<string | null>(null);
  const nextLoadRequestIdRef = useRef(0);
  const pendingLoadRequestIdsRef = useRef<Record<string, number>>({});
  const cancelledLoadRequestIdsRef = useRef<Record<string, number>>({});
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
      mode === "diff" && diffPreview?.source === "file" && diffPreview.path === activeFilePath;
    const nextMode = shouldPreserveDiffMode ? "diff" : deriveEditorModeForOpenFile(currentFile);
    if (nextMode !== mode) {
      setMode(nextMode);
    }
  }, [activeFilePath, currentFile, diffPreview, mode, setMode, workspaceId]);

  const shouldIgnoreLoadResult = useCallback((path: string, requestId: number) => {
    if (pendingLoadRequestIdsRef.current[path] !== requestId) {
      return true;
    }

    if (cancelledLoadRequestIdsRef.current[path] === requestId) {
      delete pendingLoadRequestIdsRef.current[path];
      delete cancelledLoadRequestIdsRef.current[path];
      return true;
    }

    delete pendingLoadRequestIdsRef.current[path];
    return false;
  }, []);

  const loadFile = useCallback(
    async (path: string, options?: { forceText?: boolean }) => {
      if (!workspaceId) {
        return;
      }

      const requestId = nextLoadRequestIdRef.current + 1;
      nextLoadRequestIdRef.current = requestId;
      pendingLoadRequestIdsRef.current[path] = requestId;
      setFileLoadError((current) => (current?.path === path ? null : current));
      const result = await dispatch<FileReadPayload>("file.read", {
        workspaceId,
        path,
      });

      if (shouldIgnoreLoadResult(path, requestId)) {
        return;
      }

      if (!result.ok || !result.data) {
        const message = result.error?.message ?? "Failed to open file";
        console.error("Failed to open file:", message);
        setFileLoadError({ path, message });
        return;
      }

      const data = result.data;

      if (options?.forceText && data.kind === "image" && data.isTextBacked) {
        try {
          const response = await fetch(data.url, { credentials: "include" });
          if (!response.ok) {
            const message = `Failed to fetch text-backed image bytes: ${response.status}`;
            console.error(message);
            setFileLoadError({ path, message });
            return;
          }

          const content = await response.text();
          if (cancelledLoadRequestIdsRef.current[path] === requestId) {
            delete cancelledLoadRequestIdsRef.current[path];
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
          const message =
            error instanceof Error ? error.message : "Failed to fetch text-backed image bytes";
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
    [dispatch, setOpenFiles, shouldIgnoreLoadResult, workspaceId, workspaceRootPath]
  );

  const loadTextBackedImageContent = useCallback(async (url: string) => {
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) {
      throw new Error(`Failed to fetch text-backed image bytes: ${response.status}`);
    }

    return response.text();
  }, []);

  const handleSave = useCallback(async () => {
    if (!workspaceId || !currentFile || currentFile.kind !== "text" || isSaving) {
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    const result = await dispatch<{ newHash: string }>("file.write", {
      workspaceId,
      path: currentFile.path,
      content: currentFile.content,
      baseHash: currentFile.baseHash || undefined,
    });

    if (result.ok && result.data) {
      setOpenFiles((prev) => {
        const prevFile = prev[currentFile.path];
        if (!prevFile || prevFile.kind !== "text") {
          return prev;
        }

        return {
          ...prev,
          [currentFile.path]: {
            ...prevFile,
            savedContent: currentFile.content,
            baseHash: result.data!.newHash,
            isDirty: false,
            externalState: undefined,
          },
        };
      });
      setExternalStatus((current) => (current?.path === currentFile.path ? null : current));
    } else {
      setSaveError(result.error?.message ?? "Failed to save file");
    }

    setIsSaving(false);
  }, [currentFile, dispatch, isSaving, setOpenFiles, workspaceId]);

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

    if (pendingLoadRequestIdsRef.current[activeFilePath] !== undefined) {
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

  const handleClose = useCallback(() => {
    if (currentFile?.path) {
      closePath(currentFile.path);
    } else if (activeFilePath) {
      const pendingRequestId = pendingLoadRequestIdsRef.current[activeFilePath];
      if (pendingRequestId !== undefined) {
        cancelledLoadRequestIdsRef.current[activeFilePath] = pendingRequestId;
      }
      setActiveFilePath(null);
      setMode("edit");
    }

    setSaveError(null);
  }, [activeFilePath, closePath, currentFile, setActiveFilePath, setMode]);

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

    const result = await dispatch<GitDiffPayload>("git.diff", {
      workspaceId,
      path: currentFile.path,
      staged: false,
    });

    if (!result.ok || !result.data) {
      return false;
    }

    const nextPreview: GitDiffPreview = {
      path: currentFile.path,
      diff: result.data.diff,
      staged: false,
      source: "file",
      ...(result.data.renderAs ? { renderAs: result.data.renderAs } : {}),
      ...(result.data.status ? { status: result.data.status } : {}),
      ...(result.data.originalContent !== undefined
        ? { originalContent: result.data.originalContent }
        : {}),
      ...(result.data.modifiedContent !== undefined
        ? { modifiedContent: result.data.modifiedContent }
        : {}),
      ...(result.data.originalRevision ? { originalRevision: result.data.originalRevision } : {}),
      ...(result.data.modifiedRevision ? { modifiedRevision: result.data.modifiedRevision } : {}),
    };
    setDiffPreview(nextPreview);
    setMode("diff");
    return true;
  }, [currentFile, dispatch, setDiffPreview, setMode, workspaceId]);

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
    ((diffPreview.source === "file" && diffPreview.path === activeFilePath) ||
      diffPreview.source === "commit")
      ? diffPreview
      : null;
  const canSave = Boolean(isTextFile && currentFile.isDirty && !isSaving);
  const activeLoadError =
    activeFilePath && fileLoadError?.path === activeFilePath ? fileLoadError.message : null;
  const activeExternalStatus =
    activeFilePath && externalStatus?.path === activeFilePath ? externalStatus.status : null;
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
    openInDiffMode,
    saveError,
    setMode: (nextMode: WorkspaceEditorMode) => {
      setMode(nextMode);
    },
    toggleSvgTextMode,
    workspace,
    workspaceId,
  };
}
