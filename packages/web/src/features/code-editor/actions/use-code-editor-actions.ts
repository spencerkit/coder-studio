import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useState } from "react";
import { dispatchCommandAtom } from "../../../atoms/connection";
import { activeWorkspaceAtom } from "../../../atoms/workspaces";
import {
  activeFilePathAtomFamily,
  editorRefreshTokenAtomFamily,
  gitDiffPreviewAtomFamily,
  type OpenFile,
  openFilesAtomFamily,
} from "../../workspace/atoms";

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
  const workspace = useAtomValue(activeWorkspaceAtom);
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
  const editorRefreshToken = useAtomValue(editorRefreshTokenAtomFamily(workspaceId ?? ""));

  const currentFile: OpenFile | undefined = workspaceId
    ? openFiles[activeFilePath ?? ""]
    : undefined;

  const loadFile = useCallback(
    async (path: string, options?: { forceText?: boolean }) => {
      if (!workspaceId) {
        return;
      }

      setFileLoadError((current) => (current?.path === path ? null : current));
      const result = await dispatch<FileReadPayload>("file.read", {
        workspaceId,
        path,
      });

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
          const newFile: OpenFile = {
            kind: "text",
            path,
            content,
            baseHash: "",
            isDirty: false,
            viewingTextBackedImageAsText: true,
          };

          setOpenFiles((prev) => ({ ...prev, [path]: newFile }));
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
      setExternalStatus((current) => (current?.path === path ? null : current));
      setFileLoadError((current) => (current?.path === path ? null : current));
    },
    [dispatch, setOpenFiles, workspaceId]
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
            isDirty: newContent !== prevFile.content,
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
              baseHash: nextData.baseHash,
              isDirty: false,
              externalState: undefined,
              viewingTextBackedImageAsText: file.viewingTextBackedImageAsText,
            },
          }));
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
  ]);

  const handleClose = useCallback(() => {
    if (!workspaceId) {
      return;
    }

    const currentPath = currentFile?.path;
    setActiveFilePath(null);

    if (currentPath) {
      setOpenFiles((prev) => {
        if (!(currentPath in prev)) {
          return prev;
        }

        const next = { ...prev };
        delete next[currentPath];
        return next;
      });
    }

    setSaveError(null);
  }, [currentFile, setActiveFilePath, setOpenFiles, workspaceId]);

  const toggleSvgTextMode = useCallback(() => {
    if (!workspaceId || !currentFile) {
      return;
    }

    const path = currentFile.path;
    const wantText = currentFile.kind === "image";

    setOpenFiles((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });

    void loadFile(path, wantText ? { forceText: true } : undefined);
  }, [currentFile, loadFile, setOpenFiles, workspaceId]);

  const openInDiffMode = useCallback(async () => {
    if (!workspaceId || !currentFile) {
      return false;
    }

    const result = await dispatch<{ diff: string }>("git.diff", {
      workspaceId,
      path: currentFile.path,
      staged: false,
    });

    if (!result.ok || !result.data) {
      return false;
    }

    setDiffPreview({
      path: currentFile.path,
      diff: result.data.diff,
      staged: false,
    });
    return true;
  }, [currentFile, dispatch, setDiffPreview, workspaceId]);

  const isTextFile = currentFile?.kind === "text";
  const isImageFile = currentFile?.kind === "image";
  const isSvgTextBacked =
    (isImageFile && currentFile.isTextBacked) ||
    (isTextFile && currentFile.viewingTextBackedImageAsText === true);
  const canSave = Boolean(isTextFile && currentFile.isDirty && !isSaving);
  const activeLoadError =
    activeFilePath && fileLoadError?.path === activeFilePath ? fileLoadError.message : null;
  const activeExternalStatus =
    activeFilePath && externalStatus?.path === activeFilePath ? externalStatus.status : null;

  return {
    activeFilePath,
    activeExternalStatus,
    activeLoadError,
    canSave,
    currentFile,
    handleClose,
    handleContentChange,
    handleSave,
    isImageFile,
    isSaving,
    isSvgTextBacked,
    isTextFile,
    openInDiffMode,
    saveError,
    toggleSvgTextMode,
    workspace,
    workspaceId,
  };
}
