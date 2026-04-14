/**
 * Code Editor Feature
 *
 * Monaco editor integration for viewing/editing files.
 * Supports syntax highlighting, file search, and diff mode.
 */

import type { FC } from 'react';
import { useState, useCallback } from 'react';
import { useAtomValue, useSetAtom, useAtom } from 'jotai';
import { Search, Save, AlertCircle } from 'lucide-react';
import { activeWorkspaceAtom } from '../../atoms/workspaces';
import {
  openFilesAtomFamily,
  activeFilePathAtomFamily,
  activeFileAtomFamily,
  type OpenFile,
} from '../../atoms/fs';
import { dispatchCommandAtom } from '../../atoms/connection';
import { useTranslation } from '../../lib/i18n';
import { MonacoHost } from './components/monaco-host';
import { XtermHost } from './components/xterm-host';

/**
 * Code Editor Host
 *
 * PRD §9.5:
 *   - Header: file path + search field
 *   - Monaco editor (syntax highlighting, line numbers)
 *   - Preview mode / Diff mode toggle
 *   - Save shortcut (Ctrl/Cmd + S)
 */
export const CodeEditorHost: FC = () => {
  const t = useTranslation();
  const workspace = useAtomValue(activeWorkspaceAtom);
  const dispatch = useSetAtom(dispatchCommandAtom);

  const [searchQuery, setSearchQuery] = useState('');
  const [isDiffMode, setIsDiffMode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const workspaceId = workspace?.id;

  const [activeFile, setActiveFile] = useAtom(
    activeFilePathAtomFamily(workspaceId ?? '')
  );
  const [openFiles, setOpenFiles] = useAtom(
    openFilesAtomFamily(workspaceId ?? '')
  );

  const currentFile = workspaceId ? openFiles[activeFile ?? ''] : null;

  /**
   * Handle file open: dispatch file.read command
   */
  const handleFileOpen = useCallback(
    async (path: string) => {
      if (!workspaceId) return;

      // Check if file is already open
      if (openFiles[path]) {
        setActiveFile(path);
        return;
      }

      const result = await dispatch<{ content: string; hash: string }>(
        'file.read',
        {
          workspaceId,
          path,
        }
      );

      if (result.ok && result.data) {
        const newFile: OpenFile = {
          path,
          content: result.data.content,
          baseHash: result.data.hash,
          isDirty: false,
        };

        setOpenFiles((prev) => ({
          ...prev,
          [path]: newFile,
        }));
        setActiveFile(path);
      } else {
        console.error('Failed to open file:', result.error?.message);
      }
    },
    [workspaceId, dispatch, openFiles, setOpenFiles, setActiveFile]
  );

  /**
   * Handle save: dispatch file.write command
   */
  const handleSave = useCallback(async () => {
    if (!workspaceId || !currentFile || isSaving) return;

    setIsSaving(true);
    setSaveError(null);

    const result = await dispatch<{ hash: string }>('file.write', {
      workspaceId,
      path: currentFile.path,
      content: currentFile.content,
      baseHash: currentFile.baseHash,
    });

    if (result.ok && result.data) {
      // Update baseHash and mark as clean
      setOpenFiles((prev) => ({
        ...prev,
        [currentFile.path]: {
          ...prev[currentFile.path],
          baseHash: result.data!.hash,
          isDirty: false,
        },
      }));
    } else {
      setSaveError(result.error?.message ?? 'Failed to save file');
    }

    setIsSaving(false);
  }, [workspaceId, currentFile, isSaving, dispatch, setOpenFiles]);

  /**
   * Handle content change: update local state
   */
  const handleContentChange = useCallback(
    (newContent: string) => {
      if (!workspaceId || !currentFile) return;

      setOpenFiles((prev) => ({
        ...prev,
        [currentFile.path]: {
          ...prev[currentFile.path],
          content: newContent,
          isDirty: newContent !== prev[currentFile.path]?.content,
        },
      }));
    },
    [workspaceId, currentFile, setOpenFiles]
  );

  // Listen for file open events from file tree
  useEffect(() => {
    const handleFileOpenEvent = (e: CustomEvent) => {
      const { path, workspaceId: eventWorkspaceId } = e.detail;
      if (eventWorkspaceId === workspaceId) {
        handleFileOpen(path);
      }
    };

    window.addEventListener(
      'coder-studio:file-open',
      handleFileOpenEvent as EventListener
    );

    return () => {
      window.removeEventListener(
        'coder-studio:file-open',
        handleFileOpenEvent as EventListener
      );
    };
  }, [workspaceId, handleFileOpen]);

  if (!workspace) {
    return (
      <div className="code-editor-empty">
        <p>{t('workspace.no_workspace')}</p>
      </div>
    );
  }

  return (
    <div className="code-editor-host">
      <div className="code-editor-header">
        <div className="code-editor-file-path">
          {currentFile ? (
            <span className="code-editor-path-text">
              {currentFile.path}
              {currentFile.isDirty && <span className="dirty-indicator">*</span>}
            </span>
          ) : (
            <span className="code-editor-path-empty">{t('file.title')}</span>
          )}
        </div>

        <div className="code-editor-search">
          <Search size={14} />
          <input
            className="input"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('action.search_files')}
          />
        </div>

        <div className="code-editor-actions">
          <button
            className="btn btn-sm"
            onClick={() => setIsDiffMode(!isDiffMode)}
          >
            {isDiffMode ? 'Preview' : 'Diff'}
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleSave}
            disabled={!currentFile || !currentFile.isDirty || isSaving}
          >
            <Save size={14} />
            <span>{isSaving ? 'Saving...' : t('action.save_file')}</span>
          </button>
        </div>
      </div>

      {saveError && (
        <div className="code-editor-error">
          <AlertCircle size={14} />
          <span>{saveError}</span>
        </div>
      )}

      <div className="code-editor-content">
        {currentFile ? (
          <MonacoHost
            workspaceId={workspace.id}
            filePath={currentFile.path}
            content={currentFile.content}
            isDiffMode={isDiffMode}
            onContentChange={handleContentChange}
          />
        ) : (
          <div className="code-editor-placeholder">
            <p>{t('file.title')}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default CodeEditorHost;
