import { useMemo, useState } from 'react';
import type { MobileFilesRoute } from '../../actions/use-workspace-screen-model';
import { FileTreePanel } from '../shared/file-tree-panel';
import { GitPanel } from '../shared/git-panel';
import { GitDiffViewer } from '../shared/git-diff-viewer';
import { CodeEditorHost } from '../../../code-editor/views/shared/code-editor-host';

interface MobileFilesSheetProps {
  workspaceId: string;
  route: MobileFilesRoute;
  onRouteChange?: (route: MobileFilesRoute) => void;
}

export function MobileFilesSheet({ workspaceId, route, onRouteChange }: MobileFilesSheetProps) {
  const [activeTab, setActiveTab] = useState<'files' | 'git'>('files');

  const headerCopy = useMemo(() => {
    if (route.kind === 'editor') {
      return {
        kicker: 'Files',
        title: route.path.split('/').pop() ?? 'Editor',
      };
    }

    if (route.kind === 'diff') {
      return {
        kicker: 'Git Diff',
        title: route.path.split('/').pop() ?? 'Diff',
      };
    }

    return {
      kicker: 'Workspace',
      title: 'Files',
    };
  }, [route]);

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
        <div className="mobile-files-sheet__header">
          <button type="button" className="mobile-files-sheet__back" aria-label="Go back" onClick={handleBack}>
            返回
          </button>
          <div className="mobile-files-sheet__heading">
            <span className="mobile-files-sheet__kicker">{headerCopy.kicker}</span>
            <h3 className="mobile-files-sheet__title">{headerCopy.title}</h3>
          </div>
        </div>
        <div className="mobile-files-sheet__detail">
          <CodeEditorHost />
        </div>
      </div>
    );
  }

  if (route.kind === 'diff') {
    return (
      <div className="mobile-files-sheet">
        <div className="mobile-files-sheet__header">
          <button type="button" className="mobile-files-sheet__back" aria-label="Go back" onClick={handleBack}>
            返回
          </button>
          <div className="mobile-files-sheet__heading">
            <span className="mobile-files-sheet__kicker">{headerCopy.kicker}</span>
            <h3 className="mobile-files-sheet__title">{headerCopy.title}</h3>
          </div>
        </div>
        <div className="mobile-files-sheet__detail">
          <GitDiffViewer workspaceId={workspaceId} />
        </div>
      </div>
    );
  }

  return (
    <div className="mobile-files-sheet">
      <div className="panel-tabs mobile-files-sheet__tabs" role="tablist" aria-label="Files sheet tabs">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'files'}
          className={`panel-tab ${activeTab === 'files' ? 'active' : ''}`}
          onClick={() => setActiveTab('files')}
        >
          Files
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'git'}
          className={`panel-tab ${activeTab === 'git' ? 'active' : ''}`}
          onClick={() => setActiveTab('git')}
        >
          Git Diff
        </button>
      </div>

      <div className="mobile-files-sheet__content">
        {activeTab === 'files' ? (
          <FileTreePanel workspaceId={workspaceId} onSelectFile={handleSelectFile} />
        ) : (
          <GitPanel workspaceId={workspaceId} onPreviewChange={handlePreviewChange} />
        )}
      </div>
    </div>
  );
}
