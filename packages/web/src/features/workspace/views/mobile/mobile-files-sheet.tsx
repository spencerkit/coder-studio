import { useState } from 'react';
import { ChevronDown, GitBranch } from 'lucide-react';
import { useSetAtom } from 'jotai';
import { useAtomValue } from 'jotai';
import { branchQuickPickAtom, gitStateAtomFamily } from '../../atoms';
import type { MobileFilesRoute } from '../../actions/use-workspace-screen-model';
import { FileTreePanel } from '../shared/file-tree-panel';
import { GitPanel } from '../shared/git-panel';
import { GitDiffViewer } from '../shared/git-diff-viewer';
import { GitStatusBar } from '../shared/git-status-bar';
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
  const gitState = useAtomValue(gitStateAtomFamily(workspaceId));
  const setBranchQuickPick = useSetAtom(branchQuickPickAtom);
  const [activeTab, setActiveTab] = useState<'files' | 'git'>('files');
  const branchName = gitState?.branch?.trim() || t('git.no_branch');

  const handleSelectFile = (path: string) => {
    onRouteChange?.({ kind: 'editor', path });
  };

  const handlePreviewChange = (preview: { path: string }) => {
    onRouteChange?.({ kind: 'diff', path: preview.path });
  };

  const handleBack = () => {
    onRouteChange?.({ kind: 'root' });
  };

  const handleOpenBranchSwitcher = () => {
    setBranchQuickPick({
      visible: true,
      workspaceId,
      inputValue: '',
    });
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
      <div className="mobile-files-sheet__branch-row">
        <button
          className="panel-branch panel-branch-button mobile-files-sheet__branch"
          onClick={handleOpenBranchSwitcher}
          aria-label={`${t('git.current_branch')}: ${branchName}`}
          title={branchName}
          type="button"
        >
          <span className="mobile-files-sheet__branch-icon" aria-hidden="true">
            <GitBranch size={12} />
          </span>
          <span className="mobile-files-sheet__branch-copy">
            <span className="mobile-files-sheet__branch-label">{t('git.current_branch')}</span>
            <span className="mobile-files-sheet__branch-name">{branchName}</span>
          </span>
          <span className="mobile-files-sheet__branch-chevron" aria-hidden="true">
            <ChevronDown size={14} />
          </span>
        </button>
      </div>
      <div className="panel-tabs-row mobile-files-sheet__tabs-row">
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
        <GitStatusBar workspaceId={workspaceId} gitState={gitState} inline />
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
