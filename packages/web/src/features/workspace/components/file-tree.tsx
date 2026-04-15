/**
 * File Tree Panel Component
 *
 * Displays repository file tree with expand/collapse,
 * file icons, and click-to-open functionality.
 */

import type { FC } from 'react';
import { useState, useEffect, useCallback } from 'react';
import { useAtomValue } from 'jotai';
import { fileTreeAtomFamily, fileTreeStaleAtomFamily } from '../../../atoms/fs';
import { dispatchCommandAtom } from '../../../atoms/connection';
import { useTranslation } from '../../../lib/i18n';
import type { FileNode } from '@coder-studio/core';

interface FileTreePanelProps {
  workspaceId: string;
}

/**
 * File Tree Panel
 *
 * PRD §9.3:
 *   - Tree structure with folders/files
 *   - Click to open, expand/collapse
 */
export const FileTreePanel: FC<FileTreePanelProps> = ({ workspaceId }) => {
  const t = useTranslation();
  const fileTree = useAtomValue(fileTreeAtomFamily(workspaceId));
  const fileTreeStale = useAtomValue(fileTreeStaleAtomFamily(workspaceId));
  const dispatch = useAtomValue(dispatchCommandAtom);

  const [isLoading, setIsLoading] = useState(false);

  /**
   * Load file tree: dispatch file.readTree command
   */
  const loadFileTree = useCallback(async () => {
    if (!workspaceId || isLoading) return;

    setIsLoading(true);
    const result = await dispatch<FileNode>('file.readTree', {
      workspaceId,
    });

    if (!result.ok) {
      console.error('Failed to load file tree:', result.error?.message);
    }

    setIsLoading(false);
  }, [workspaceId, isLoading, dispatch]);

  // Load file tree on mount
  useEffect(() => {
    if (!fileTree && !isLoading) {
      loadFileTree();
    }
  }, [fileTree, isLoading, loadFileTree]);

  // Reload file tree when stale
  useEffect(() => {
    if (fileTreeStale && !isLoading) {
      loadFileTree();
    }
  }, [fileTreeStale, isLoading, loadFileTree]);

  return (
    <div className="file-tree">
      {fileTree ? (
        <FileTreeNode node={fileTree} depth={0} workspaceId={workspaceId} />
      ) : (
        <div className="file-tree-empty">
          <p>{isLoading ? 'Loading...' : t('file.title')}</p>
        </div>
      )}
    </div>
  );
};

interface FileTreeNodeProps {
  node: FileNode;
  depth: number;
  workspaceId: string;
}

/**
 * File Tree Node (recursive)
 */
const FileTreeNode: FC<FileTreeNodeProps> = ({ node, depth, workspaceId }) => {
  const isFolder = node.kind === 'dir';
  const [isExpanded, setIsExpanded] = useState(false);

  // Use a callback to dispatch file open event
  // This would be handled by a parent component or event bus
  const handleClick = () => {
    if (isFolder) {
      setIsExpanded(!isExpanded);
    } else {
      // Dispatch custom event for file open
      // The code editor will listen to this event
      window.dispatchEvent(
        new CustomEvent('coder-studio:file-open', {
          detail: { path: node.path, workspaceId },
        })
      );
    }
  };

  const paddingLeft = depth * 12 + 16;

  return (
    <>
      <div
        className="tree-item"
        onClick={handleClick}
        style={{ paddingLeft }}
      >
        {isFolder && (
          <span className="tree-chevron">
            {isExpanded ? '▼' : '▶'}
          </span>
        )}

        {!isFolder && (
          <span className="tree-chevron" style={{ visibility: 'hidden' }}>▶</span>
        )}

        <span className={`tree-icon ${isFolder ? 'folder' : ''}`}>
          {isFolder ? '📁' : '📄'}
        </span>

        <span className="tree-label">{node.name}</span>
      </div>

      {isFolder && isExpanded && node.children && (
        <div className="tree-children">
          {node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              workspaceId={workspaceId}
            />
          ))}
        </div>
      )}
    </>
  );
};

export default FileTreePanel;
