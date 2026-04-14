/**
 * Workspace Page Feature
 *
 * Main workspace view with left panel (file tree/git), central panel (agent panes),
 * and bottom panel (terminal).
 */

import type { FC } from 'react';
import { useAtomValue } from 'jotai';
import { useParams } from 'react-router-dom';
import { activeWorkspaceAtom } from '../../atoms/workspaces';
import { focusModeAtom } from '../../atoms/ui';
import { useTranslation } from '../../lib/i18n';
import { FileTreePanel } from './components/file-tree';
import { GitPanel } from './components/git-panel';

/**
 * Workspace Page
 *
 * PRD §7:
 *   - Layout: Left panel | Central panel | Bottom panel
 *   - Left panel: File tree / Git diff switcher
 *   - Central: Agent pane tree (multiple sessions)
 *   - Bottom: Terminal panel
 */
export const WorkspacePage: FC = () => {
  const t = useTranslation();
  const { id } = useParams<{ id?: string }>();
  const workspace = useAtomValue(activeWorkspaceAtom);
  const focusMode = useAtomValue(focusModeAtom);

  if (!workspace) {
    // TODO: Show empty state or redirect to welcome
    return (
      <div className="workspace-page workspace-page-empty">
        <p>{t('workspace.no_workspace')}</p>
      </div>
    );
  }

  return (
    <div className={`workspace-page ${focusMode ? 'workspace-page-focus' : ''}`}>
      {!focusMode && (
        <aside className="workspace-left-panel">
          <div className="workspace-sidebar-tabs">
            <button className="workspace-sidebar-tab workspace-sidebar-tab-active">
              {t('file.title')}
            </button>
            <button className="workspace-sidebar-tab">
              {t('git.title')}
            </button>
          </div>

          <div className="workspace-sidebar-content">
            <FileTreePanel workspaceId={workspace.id} />
          </div>
        </aside>
      )}

      <main className="workspace-central-panel">
        <div className="agent-panes-container">
          {/* TODO: Agent panes */}
          <div className="agent-panes-placeholder">
            <p>{t('session.no_session')}</p>
          </div>
        </div>
      </main>

      {!focusMode && (
        <footer className="workspace-bottom-panel">
          {/* TODO: Terminal panel */}
          <div className="terminal-panel-placeholder">
            <p>{t('terminal.title')}</p>
          </div>
        </footer>
      )}
    </div>
  );
};

export default WorkspacePage;
