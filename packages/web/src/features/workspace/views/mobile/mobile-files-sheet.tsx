import { useState } from 'react';
import type { MobileFilesRoute } from '../../actions/use-workspace-screen-model';
import { FileTreePanel } from '../shared/file-tree-panel';
import { GitPanel } from '../shared/git-panel';
import { GitDiffViewer } from '../shared/git-diff-viewer';
import { useTranslation } from '../../../../lib/i18n';
import {
  CodeEditorHost,
  type CodeEditorState,
} from '../../../code-editor/views/shared/code-editor-host';

interface MobileFilesSheetProps {
  workspaceId: string;
  route: MobileFilesRoute;
  onRouteChange?: (route: MobileFilesRoute) => void;
  detailBackMode?: 'sheet' | 'inline';
  editorState?: CodeEditorState;
}

export function MobileFilesSheet({
  workspaceId,
  route,
  onRouteChange,
  detailBackMode = 'inline',
  editorState,
}: MobileFilesSheetProps) {
  const t = useTranslation();
  const [activeTab, setActiveTab] = useState<'files' | 'git'>('files');

  const handleSelectFile = (path: string) => {
    onRouteChange?.({ kind: 'editor', path });
  };

  const handlePreviewChange = (preview: { path: string }) => {
    onRouteChange?.({ kind: 'diff', path: preview.path });
  };

  const handleBack = () => {
    onRouteChange?.({ kind: 'root' });
  };

  if (route.kind === 'editor') {
    return (
      <div className="mobile-files-sheet">
        {detailBackMode === 'inline' ? (
          <div className="mobile-files-sheet__detail-toolbar">
            <button
              type="button"
              className="mobile-files-sheet__back"
              aria-label={t('action.back')}
              onClick={handleBack}
            >
              {t('action.back')}
            </button>
          </div>
        ) : null}
        <div className="mobile-files-sheet__detail">
          <CodeEditorHost chrome="content-only" editorState={editorState} />
        </div>
      </div>
    );
  }

  if (route.kind === 'diff') {
    return (
      <div className="mobile-files-sheet">
        {detailBackMode === 'inline' ? (
          <div className="mobile-files-sheet__detail-toolbar">
            <button
              type="button"
              className="mobile-files-sheet__back"
              aria-label={t('action.back')}
              onClick={handleBack}
            >
              {t('action.back')}
            </button>
          </div>
        ) : null}
        <div className="mobile-files-sheet__detail">
          <GitDiffViewer workspaceId={workspaceId} />
        </div>
      </div>
    );
  }

  return (
    <div className="mobile-files-sheet">
      <div
        className="panel-tabs mobile-files-sheet__tabs"
        role="tablist"
        aria-label={t('mobile.files.tabs')}
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'files'}
          className={`panel-tab ${activeTab === 'files' ? 'active' : ''}`}
          onClick={() => setActiveTab('files')}
        >
          {t('file.title')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'git'}
          className={`panel-tab ${activeTab === 'git' ? 'active' : ''}`}
          onClick={() => setActiveTab('git')}
        >
          {t('mobile.files.git_diff')}
        </button>
      </div>

      <div className="mobile-files-sheet__content">
        {activeTab === 'files' ? (
          <FileTreePanel workspaceId={workspaceId} onSelectFile={handleSelectFile} />
        ) : (
          <GitPanel workspaceId={workspaceId} onPreviewOpen={handlePreviewChange} />
        )}
      </div>
    </div>
  );
}
