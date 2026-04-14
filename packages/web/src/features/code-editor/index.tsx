/**
 * Code Editor Feature
 *
 * Monaco editor integration for viewing/editing files.
 * Supports syntax highlighting, file search, and diff mode.
 */

import type { FC } from 'react';
import { useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { Search, Save } from 'lucide-react';
import { activeWorkspaceAtom } from '../../atoms/workspaces';
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
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDiffMode, setIsDiffMode] = useState(false);

  const handleSave = () => {
    if (!currentFilePath) return;
    // TODO: Dispatch file save command
    console.log('Save file:', currentFilePath);
  };

  const handleFileOpen = (path: string) => {
    setCurrentFilePath(path);
    // TODO: Load file content
  };

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
          {currentFilePath ? (
            <span className="code-editor-path-text">{currentFilePath}</span>
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
            disabled={!currentFilePath}
          >
            <Save size={14} />
            <span>{t('action.save_file')}</span>
          </button>
        </div>
      </div>

      <div className="code-editor-content">
        {currentFilePath ? (
          <MonacoHost
            workspaceId={workspace.id}
            filePath={currentFilePath}
            isDiffMode={isDiffMode}
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
