/**
 * Code Editor Feature
 *
 * Renders the currently-active workspace file in the central pane. Files
 * come in two shapes:
 *
 *   - Text → Monaco editor with save + dirty tracking.
 *   - Image → <img> preview via the `/api/file` HTTP endpoint. SVG is an
 *     image by default but has an "edit as text" escape hatch because it's
 *     also a text-backed format people often want to tweak.
 *
 * Diff view is intentionally not part of this editor — Git Diff has its
 * own dedicated viewer.
 */

import type { FC } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useAtomValue, useAtom } from 'jotai';
import { Save, AlertCircle, X, Image as ImageIcon, FileText } from 'lucide-react';
import { activeWorkspaceAtom } from '../../atoms/workspaces';
import {
  openFilesAtomFamily,
  activeFilePathAtomFamily,
  type OpenFile,
} from '../workspace/atoms/files';
import { dispatchCommandAtom } from '../../atoms/connection';
import { useTranslation } from '../../lib/i18n';
import { MonacoHost } from './components/monaco-host';
import { ImagePreview } from './components/image-preview';

/**
 * Shape returned by the `file.read` command on the server. A discriminated
 * union on `kind` lets the client dispatch between text vs image rendering
 * without sniffing content or inspecting the path a second time.
 */
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

export const CodeEditorHost: FC = () => {
  const t = useTranslation();
  const workspace = useAtomValue(activeWorkspaceAtom);
  const dispatch = useAtomValue(dispatchCommandAtom);

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fileLoadError, setFileLoadError] = useState<{ path: string; message: string } | null>(null);

  const workspaceId = workspace?.id;

  const [activeFile, setActiveFile] = useAtom(
    activeFilePathAtomFamily(workspaceId ?? '')
  );
  const [openFiles, setOpenFiles] = useAtom(
    openFilesAtomFamily(workspaceId ?? '')
  );

  const currentFile: OpenFile | undefined = workspaceId
    ? openFiles[activeFile ?? '']
    : undefined;

  /**
   * Fetch a file from the server and seed the open-files cache.
   *
   * Force-text is used by the SVG "edit as text" escape hatch: even when
   * the server would have routed SVG through the image branch, we ask it
   * (via `asText: true`) for text content so Monaco can open it. The server
   * currently always decides based on extension, so we fall back to a text
   * fetch via a sentinel: if the caller requests text-as-text we hit a
   * dedicated codepath that reads the file via `file.read` with an
   * additional flag; otherwise we use the default routing.
   */
  const loadFile = useCallback(
    async (path: string, options?: { forceText?: boolean }) => {
      if (!workspaceId) return;

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

      // If the caller wants text but the server returned an image descriptor
      // (SVG), fetch the raw bytes via the HTTP asset endpoint and treat
      // them as text. This keeps the "edit as text" toggle working without
      // needing a dedicated server-side force-text flag.
      if (options?.forceText && data.kind === 'image' && data.isTextBacked) {
        try {
          const res = await fetch(data.url, { credentials: 'include' });
          if (!res.ok) {
            const message = `Failed to fetch text-backed image bytes: ${res.status}`;
            console.error(message);
            setFileLoadError({ path, message });
            return;
          }
          const content = await res.text();
          const newFile: OpenFile = {
            kind: 'text',
            path,
            content,
            // No server-provided hash for this path; set an empty string so
            // file.write skips conflict detection (baseHash is optional on
            // the server). Acceptable for now — writing SVG-as-text is a
            // rare path and a conflicting edit would be caught at the next
            // read anyway.
            baseHash: '',
            isDirty: false,
            viewingTextBackedImageAsText: true,
          };
          setOpenFiles((prev) => ({ ...prev, [path]: newFile }));
          setFileLoadError((current) => (current?.path === path ? null : current));
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to fetch text-backed image bytes';
          console.error('Failed to fetch text-backed image bytes:', err);
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
    [workspaceId, dispatch, setOpenFiles]
  );

  const handleSave = useCallback(async () => {
    if (!workspaceId || !currentFile || currentFile.kind !== 'text' || isSaving) return;

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
        if (!prevFile || prevFile.kind !== 'text') return prev;
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
  }, [workspaceId, currentFile, isSaving, dispatch, setOpenFiles]);

  const handleContentChange = useCallback(
    (newContent: string) => {
      if (!workspaceId || !currentFile || currentFile.kind !== 'text') return;

      setOpenFiles((prev) => {
        const prevFile = prev[currentFile.path];
        if (!prevFile || prevFile.kind !== 'text') return prev;
        const isDirty = newContent !== prevFile.content;
        return {
          ...prev,
          [currentFile.path]: {
            ...prevFile,
            content: newContent,
            isDirty,
          },
        };
      });
    },
    [workspaceId, currentFile, setOpenFiles]
  );

  // When the file tree picks a new file, activeFile flips first (so the
  // highlight is instant). We then ensure openFiles has a matching buffer;
  // if not, we request it from the server.
  useEffect(() => {
    if (!workspaceId || !activeFile) return;
    if (openFiles[activeFile]) return;
    void loadFile(activeFile);
  }, [workspaceId, activeFile, openFiles, loadFile]);

  const handleClose = useCallback(() => {
    if (!workspaceId) return;

    const currentPath = currentFile?.path;
    setActiveFile(null);
    if (currentPath) {
      setOpenFiles((prev) => {
        if (!(currentPath in prev)) return prev;
        const next = { ...prev };
        delete next[currentPath];
        return next;
      });
    }
    setSaveError(null);
  }, [workspaceId, currentFile, setActiveFile, setOpenFiles]);

  /**
   * SVG toggle: flip between image preview and text editing for a single
   * text-backed image. We drop the current buffer (so it's refetched with
   * the right `forceText` flag) and reload. For the image→text direction
   * we go through `loadFile(..., { forceText: true })`; for text→image we
   * just reload with defaults.
   */
  const toggleSvgTextMode = useCallback(() => {
    if (!workspaceId || !currentFile) return;
    const path = currentFile.path;
    const wantText = currentFile.kind === 'image';

    setOpenFiles((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });
    void loadFile(path, wantText ? { forceText: true } : undefined);
  }, [workspaceId, currentFile, setOpenFiles, loadFile]);

  if (!workspace) {
    return (
      <div className="workspace-git-view">
        <div className="code-editor workspace-git-editor">
          <div className="code-editor-body">
            <div className="git-diff-empty">
              <p className="git-diff-empty-title">{t('workspace.no_workspace')}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isTextFile = currentFile?.kind === 'text';
  const isImageFile = currentFile?.kind === 'image';
  const isSvgTextBacked =
    (isImageFile && currentFile.isTextBacked) ||
    (isTextFile && currentFile.viewingTextBackedImageAsText === true);

  const saveLabel = isSaving ? 'Saving…' : t('action.save_file');
  const canSave = isTextFile && currentFile.isDirty && !isSaving;

  const dirtyIndicator =
    isTextFile && currentFile.isDirty ? <span className="dirty-indicator">*</span> : null;
  const activeLoadError =
    activeFile && fileLoadError?.path === activeFile ? fileLoadError.message : null;

  return (
    // Reuse the Git Diff viewer's container/header/body class names so the
    // file editor gets the exact same frame (radius, border, shadow, header
    // chrome, scroll body). Content inside the body is what switches.
    <div className="workspace-git-view">
      <div className="code-editor workspace-git-editor">
        <div className="code-editor-header">
          <span className="code-file-path">
            {currentFile ? (
              <>
                {currentFile.path}
                {dirtyIndicator}
              </>
            ) : activeFile ? (
              activeFile
            ) : (
              t('file.title')
            )}
          </span>

          <div className="code-mode-toggle">
            {isSvgTextBacked && (
              <button
                type="button"
                className="code-mode-btn"
                onClick={toggleSvgTextMode}
                title={isImageFile ? 'Edit as text' : 'Preview as image'}
                aria-label={isImageFile ? 'Edit as text' : 'Preview as image'}
              >
                {isImageFile ? <FileText size={12} /> : <ImageIcon size={12} />}
                <span>{isImageFile ? 'Text' : 'Image'}</span>
              </button>
            )}
            <button
              type="button"
              className="code-mode-btn"
              onClick={handleSave}
              disabled={!canSave}
              title={saveLabel}
              aria-label={saveLabel}
            >
              <Save size={12} />
              <span>{saveLabel}</span>
            </button>
            <button
              type="button"
              className="code-mode-btn"
              onClick={handleClose}
              title={t('action.close')}
              aria-label={t('action.close')}
            >
              <X size={12} />
            </button>
          </div>
        </div>

        {saveError && (
          <div className="code-editor-error" role="alert">
            <AlertCircle size={14} />
            <span>{saveError}</span>
          </div>
        )}

        <div className="code-editor-body">
          {isTextFile ? (
            <MonacoHost
              workspaceId={workspace.id}
              filePath={currentFile.path}
              content={currentFile.content}
              onContentChange={handleContentChange}
            />
          ) : isImageFile ? (
            <ImagePreview
              url={currentFile.url}
              mime={currentFile.mime}
              sizeBytes={currentFile.size}
              alt={currentFile.path}
            />
          ) : activeLoadError ? (
            <div className="git-diff-empty" role="alert">
              <p className="git-diff-empty-title">Failed to open file</p>
              <p className="git-diff-empty-body">{activeLoadError}</p>
            </div>
          ) : activeFile ? (
            <div className="git-diff-empty">
              <p className="git-diff-empty-title">{t('status.connecting')}…</p>
            </div>
          ) : (
            <div className="git-diff-empty">
              <p className="git-diff-empty-title">{t('file.title')}</p>
              <p className="git-diff-empty-body">
                Select a file on the left to open it in the editor.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CodeEditorHost;
