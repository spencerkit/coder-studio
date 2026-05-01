import { useCallback, useEffect, useState } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { activeWorkspaceAtom } from '../../../atoms/workspaces';
import { dispatchCommandAtom } from '../../../atoms/connection';
import {
  activeFilePathAtomFamily,
  openFilesAtomFamily,
  type OpenFile,
} from '../../workspace/atoms/files';
import { gitDiffPreviewAtomFamily } from '../../workspace/atoms/git';

type FileReadTextPayload = {
  kind: 'text';
  content: string;
  baseHash: string;
  encoding: 'utf-8';
};

type FileReadImagePayload = {
  kind: 'image';
  mime: string;
  url: string;
  size: number;
  isTextBacked: boolean;
};

type FileReadPayload = FileReadTextPayload | FileReadImagePayload;

export function useCodeEditorActions() {
  const workspace = useAtomValue(activeWorkspaceAtom);
  const dispatch = useAtomValue(dispatchCommandAtom);
  const setDiffPreview = useSetAtom(gitDiffPreviewAtomFamily(workspace?.id ?? ''));

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fileLoadError, setFileLoadError] = useState<{ path: string; message: string } | null>(null);

  const workspaceId = workspace?.id;
  const [activeFilePath, setActiveFilePath] = useAtom(
    activeFilePathAtomFamily(workspaceId ?? '')
  );
  const [openFiles, setOpenFiles] = useAtom(openFilesAtomFamily(workspaceId ?? ''));

  const currentFile: OpenFile | undefined = workspaceId
    ? openFiles[activeFilePath ?? '']
    : undefined;

  const loadFile = useCallback(
    async (path: string, options?: { forceText?: boolean }) => {
      if (!workspaceId) {
        return;
      }

      setFileLoadError((current) => (current?.path === path ? null : current));
      const result = await dispatch<FileReadPayload>('file.read', {
        workspaceId,
        path,
      });

      if (!result.ok || !result.data) {
        const message = result.error?.message ?? 'Failed to open file';
        console.error('Failed to open file:', message);
        setFileLoadError({ path, message });
        return;
      }

      const data = result.data;

      if (options?.forceText && data.kind === 'image' && data.isTextBacked) {
        try {
          const response = await fetch(data.url, { credentials: 'include' });
          if (!response.ok) {
            const message = `Failed to fetch text-backed image bytes: ${response.status}`;
            console.error(message);
            setFileLoadError({ path, message });
            return;
          }

          const content = await response.text();
          const newFile: OpenFile = {
            kind: 'text',
            path,
            content,
            baseHash: '',
            isDirty: false,
            viewingTextBackedImageAsText: true,
          };

          setOpenFiles((prev) => ({ ...prev, [path]: newFile }));
          setFileLoadError((current) => (current?.path === path ? null : current));
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Failed to fetch text-backed image bytes';
          console.error('Failed to fetch text-backed image bytes:', error);
          setFileLoadError({ path, message });
        }

        return;
      }

      const newFile: OpenFile =
        data.kind === 'text'
          ? {
              kind: 'text',
              path,
              content: data.content,
              baseHash: data.baseHash,
              isDirty: false,
            }
          : {
              kind: 'image',
              path,
              mime: data.mime,
              url: data.url,
              size: data.size,
              isTextBacked: data.isTextBacked,
            };

      setOpenFiles((prev) => ({ ...prev, [path]: newFile }));
      setFileLoadError((current) => (current?.path === path ? null : current));
    },
    [dispatch, setOpenFiles, workspaceId]
  );

  const handleSave = useCallback(async () => {
    if (!workspaceId || !currentFile || currentFile.kind !== 'text' || isSaving) {
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    const result = await dispatch<{ newHash: string }>('file.write', {
      workspaceId,
      path: currentFile.path,
      content: currentFile.content,
      baseHash: currentFile.baseHash || undefined,
    });

    if (result.ok && result.data) {
      setOpenFiles((prev) => {
        const prevFile = prev[currentFile.path];
        if (!prevFile || prevFile.kind !== 'text') {
          return prev;
        }

        return {
          ...prev,
          [currentFile.path]: {
            ...prevFile,
            baseHash: result.data!.newHash,
            isDirty: false,
          },
        };
      });
    } else {
      setSaveError(result.error?.message ?? 'Failed to save file');
    }

    setIsSaving(false);
  }, [currentFile, dispatch, isSaving, setOpenFiles, workspaceId]);

  const handleContentChange = useCallback(
    (newContent: string) => {
      if (!workspaceId || !currentFile || currentFile.kind !== 'text') {
        return;
      }

      setOpenFiles((prev) => {
        const prevFile = prev[currentFile.path];
        if (!prevFile || prevFile.kind !== 'text') {
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
    const wantText = currentFile.kind === 'image';

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

    const result = await dispatch<{ diff: string }>('git.diff', {
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

  const isTextFile = currentFile?.kind === 'text';
  const isImageFile = currentFile?.kind === 'image';
  const isSvgTextBacked =
    (isImageFile && currentFile.isTextBacked) ||
    (isTextFile && currentFile.viewingTextBackedImageAsText === true);
  const canSave = Boolean(isTextFile && currentFile.isDirty && !isSaving);
  const activeLoadError =
    activeFilePath && fileLoadError?.path === activeFilePath ? fileLoadError.message : null;

  return {
    activeFilePath,
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
