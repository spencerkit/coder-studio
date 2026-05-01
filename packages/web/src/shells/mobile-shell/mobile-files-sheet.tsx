import { useEffect, useMemo, useState } from 'react';
import type { GitDiffPreview } from '../../atoms/git';
import { FileTreePanel } from '../../features/workspace/components/file-tree';
import { GitPanel } from '../../features/workspace/components/git-panel';
import { GitDiffViewer } from '../../features/workspace/components/git-diff-viewer';
import { CodeEditorHost } from '../../features/code-editor';

type MobileFilesRoute =
  | { kind: 'root' }
  | { kind: 'editor'; path: string }
  | { kind: 'diff'; path: string };

interface MobileFilesSheetProps {
  workspaceId: string;
  onRouteChange?: (route: MobileFilesRoute) => void;
}

export function MobileFilesSheet({ workspaceId, onRouteChange }: MobileFilesSheetProps) {
  const [activeTab, setActiveTab] = useState<'files' | 'git'>('files');
  const [route, setRoute] = useState<MobileFilesRoute>({ kind: 'root' });

  useEffect(() => {
    onRouteChange?.(route);
  }, [onRouteChange, route]);

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
    setRoute({ kind: 'editor', path });
  };

  const handlePreviewChange = (preview: GitDiffPreview) => {
    setRoute({ kind: 'diff', path: preview.path });
  };

  const handleBack = () => {
    setRoute({ kind: 'root' });
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

export type { MobileFilesRoute };
