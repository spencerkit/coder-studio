/**
 * File Tree Panel Component
 *
 * Displays repository file tree with expand/collapse,
 * file icons, and click-to-open functionality.
 */

import type { FC } from 'react';
import { useState, useEffect, useCallback } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  FileCode2,
  FileImage,
  FileJson2,
  FileText,
  Folder,
  FolderOpen,
} from 'lucide-react';
import { useAtomValue, useSetAtom } from 'jotai';
import { fileTreeAtomFamily, fileTreeStaleAtomFamily } from '../../../atoms/fs';
import { dispatchCommandAtom } from '../../../atoms/connection';
import { useTranslation } from '../../../lib/i18n';
import type { FileNode } from '@coder-studio/core';

interface FileTreePanelProps {
  workspaceId: string;
  refreshToken?: number;
}

interface ReadTreeResult {
  path: string;
  children: FileNode[];
}

/**
 * File Tree Panel
 *
 * PRD §9.3:
 *   - Tree structure with folders/files
 *   - Click to open, expand/collapse
 */
export const FileTreePanel: FC<FileTreePanelProps> = ({ workspaceId, refreshToken = 0 }) => {
  const t = useTranslation();
  const fileTree = useAtomValue(fileTreeAtomFamily(workspaceId));
  const fileTreeStale = useAtomValue(fileTreeStaleAtomFamily(workspaceId));
  const setFileTree = useSetAtom(fileTreeAtomFamily(workspaceId));
  const dispatch = useAtomValue(dispatchCommandAtom);

  const [isLoading, setIsLoading] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  /**
   * Load file tree: dispatch file.readTree command
   */
  const loadFileTree = useCallback(async () => {
    if (!workspaceId || isLoading) return;

    setIsLoading(true);
    const result = await dispatch<ReadTreeResult>('file.readTree', {
      workspaceId,
    });

    if (result.ok && result.data) {
      setFileTree(result.data.children);
    } else if (!result.ok) {
      console.error('Failed to load file tree:', result.error?.message);
    }

    setIsLoading(false);
  }, [workspaceId, isLoading, dispatch, setFileTree]);

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

  useEffect(() => {
    if (refreshToken > 0 && !isLoading) {
      loadFileTree();
    }
  }, [refreshToken, isLoading, loadFileTree]);

  return (
    <div className="file-tree">
      {fileTree && fileTree.length > 0 ? (
        sortNodes(fileTree).map((node) => (
          <FileTreeNode
            key={node.path}
            node={node}
            depth={0}
            workspaceId={workspaceId}
            selectedPath={selectedPath}
            onSelectFile={setSelectedPath}
          />
        ))
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
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
}

/**
 * File Tree Node (recursive)
 */
const FileTreeNode: FC<FileTreeNodeProps> = ({
  node,
  depth,
  workspaceId,
  selectedPath,
  onSelectFile,
}) => {
  const isFolder = node.kind === 'dir';
  const defaultExpanded =
    isFolder && depth === 0 && ['app', 'packages', 'src'].includes(node.name.toLowerCase());
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  // Use a callback to dispatch file open event
  // This would be handled by a parent component or event bus
  const handleClick = () => {
    if (isFolder) {
      setIsExpanded(!isExpanded);
    } else {
      onSelectFile(node.path);
      // Dispatch custom event for file open
      // The code editor will listen to this event
      window.dispatchEvent(
        new CustomEvent('coder-studio:file-open', {
          detail: { path: node.path, workspaceId },
        })
      );
    }
  };

  const paddingLeft = depth * 14 + 12;
  const Icon = getNodeIcon(node, isExpanded);
  const sortedChildren = node.children ? sortNodes(node.children) : [];

  return (
    <>
      <div
        className={`tree-item ${selectedPath === node.path ? 'selected' : ''}`}
        onClick={handleClick}
        style={{ paddingLeft }}
        title={node.path}
      >
        <span className="tree-chevron" aria-hidden="true">
          {isFolder ? (isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}
        </span>

        <span className={`tree-icon ${getFileToneClass(node)}`}>
          <Icon size={14} />
        </span>

        <span className="tree-label">{node.name}</span>
      </div>

      {isFolder && isExpanded && node.children && (
        <div className="tree-children">
          {sortedChildren.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              workspaceId={workspaceId}
              selectedPath={selectedPath}
              onSelectFile={onSelectFile}
            />
          ))}
        </div>
      )}
    </>
  );
};

export default FileTreePanel;

function sortNodes(nodes: FileNode[]) {
  return [...nodes].sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === 'dir' ? -1 : 1;
    }

    return a.name.localeCompare(b.name);
  });
}

function getNodeIcon(node: FileNode, isExpanded: boolean): LucideIcon {
  if (node.kind === 'dir') {
    return isExpanded ? FolderOpen : Folder;
  }

  const ext = node.name.split('.').pop()?.toLowerCase();

  switch (ext) {
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
    case 'py':
    case 'go':
    case 'rs':
    case 'java':
      return FileCode2;
    case 'json':
    case 'yaml':
    case 'yml':
    case 'toml':
    case 'lock':
      return FileJson2;
    case 'md':
    case 'txt':
      return FileText;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':
      return FileImage;
    default:
      return FileIcon;
  }
}

function getFileToneClass(node: FileNode) {
  if (node.kind === 'dir') {
    return 'folder';
  }

  const ext = node.name.split('.').pop()?.toLowerCase();

  switch (ext) {
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
      return 'code';
    case 'json':
    case 'yaml':
    case 'yml':
      return 'data';
    case 'md':
    case 'txt':
      return 'doc';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':
      return 'media';
    default:
      return 'file';
  }
}
