/**
 * File Tree Panel Component
 *
 * Displays repository file tree with expand/collapse,
 * file icons, and click-to-open functionality.
 */

import type { FC } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { Folder, File, ChevronRight, ChevronDown, RefreshCw } from 'lucide-react';
import { fileTreeAtomFamily } from '../../../atoms/fs';
import { activeWorkspaceAtom } from '../../../atoms/workspaces';
import { useTranslation } from '../../../lib/i18n';
import type { FileNode } from '@coder-studio/core';

interface FileTreePanelProps {
  workspaceId: string;
}

/**
 * File Tree Panel
 *
 * PRD §9.3:
 *   - Header with "REPOSITORY NAVIGATOR" label
 *   - Branch chip showing current branch
 *   - Toolbar with refresh button
 *   - Tree structure with folders/files
 *   - Click to open, expand/collapse
 */
export const FileTreePanel: FC<FileTreePanelProps> = ({ workspaceId }) => {
  const t = useTranslation();
  const workspace = useAtomValue(activeWorkspaceAtom);
  const fileTree = useAtomValue(fileTreeAtomFamily(workspaceId));

  const handleRefresh = () => {
    // TODO: Dispatch file tree refresh command
    console.log('Refresh file tree');
  };

  return (
    <div className="file-tree-panel">
      <div className="file-tree-header">
        <span className="file-tree-label">{t('file.title').toUpperCase()}</span>
        {workspace?.branch && (
          <span className="file-tree-branch-chip">
            <Folder size={12} />
            <span>{workspace.branch}</span>
          </span>
        )}
      </div>

      <div className="file-tree-toolbar">
        <button
          className="btn btn-icon btn-sm"
          onClick={handleRefresh}
          aria-label={t('action.refresh')}
        >
          <RefreshCw size={14} />
        </button>
      </div>

      <div className="file-tree-content">
        {fileTree ? (
          <FileTreeNode node={fileTree} depth={0} />
        ) : (
          <div className="file-tree-empty">
            <p>{t('file.title')}</p>
          </div>
        )}
      </div>
    </div>
  );
};

interface FileTreeNodeProps {
  node: FileNode;
  depth: number;
}

/**
 * File Tree Node (recursive)
 */
const FileTreeNode: FC<FileTreeNodeProps> = ({ node, depth }) => {
  const isFolder = node.type === 'directory';
  const [isExpanded, setIsExpanded] = useState(false);

  const handleClick = () => {
    if (isFolder) {
      setIsExpanded(!isExpanded);
    } else {
      // TODO: Dispatch file open command
      console.log('Open file:', node.path);
    }
  };

  const paddingLeft = depth * 16;

  return (
    <div className="file-tree-node">
      <div
        className="file-tree-node-row"
        onClick={handleClick}
        style={{ paddingLeft }}
      >
        {isFolder && (
          <span className="file-tree-chevron">
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        )}

        <span className="file-tree-icon">
          {isFolder ? <Folder size={14} /> : <File size={14} />}
        </span>

        <span className="file-tree-name">{node.name}</span>
      </div>

      {isFolder && isExpanded && node.children && (
        <div className="file-tree-children">
          {node.children.map((child) => (
            <FileTreeNode key={child.path} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
};

import { useState } from 'react';

export default FileTreePanel;
