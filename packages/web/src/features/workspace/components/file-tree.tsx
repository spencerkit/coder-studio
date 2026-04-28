/**
 * File Tree Panel Component
 *
 * Displays repository file tree with expand/collapse,
 * file icons, and click-to-open functionality.
 */

import type { FC } from 'react';
import { useState, useEffect, useCallback, useRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  FileCode2,
  FileImage,
  FileJson2,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Trash2,
  X,
} from 'lucide-react';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  activeFilePathAtomFamily,
  fileTreeAtomFamily,
  fileTreeStaleAtomFamily,
  loadedDirsAtomFamily,
  openFilesAtomFamily,
} from '../../../atoms/fs';
import { dispatchCommandAtom } from '../../../atoms/connection';
import { useTranslation } from '../../../lib/i18n';
import type { FileNode } from '@coder-studio/core';

interface CreateRequest {
  id: number;
  mode: 'file' | 'folder';
  baseDir: string | null;
}

interface FileTreePanelProps {
  workspaceId: string;
  refreshToken?: number;
  createRequest?: CreateRequest | null;
  onCreateRequestConsumed?: () => void;
}

interface ReadTreeResult {
  path: string;
  children: FileNode[];
}

interface CreateDialogState {
  mode: 'file' | 'folder';
  draftPath: string;
  error: string | null;
}

interface PendingDeleteState {
  path: string;
  name: string;
  error: string | null;
}

/**
 * File Tree Panel
 *
 * PRD §9.3:
 *   - Tree structure with folders/files
 *   - Click to open, expand/collapse
 */
export const FileTreePanel: FC<FileTreePanelProps> = ({
  workspaceId,
  refreshToken = 0,
  createRequest = null,
  onCreateRequestConsumed,
}) => {
  const t = useTranslation();
  const fileTree = useAtomValue(fileTreeAtomFamily(workspaceId));
  const fileTreeStale = useAtomValue(fileTreeStaleAtomFamily(workspaceId));
  const activeFilePath = useAtomValue(activeFilePathAtomFamily(workspaceId));
  const dispatch = useAtomValue(dispatchCommandAtom);
  const setFileTree = useSetAtom(fileTreeAtomFamily(workspaceId));
  const setFileTreeStale = useSetAtom(fileTreeStaleAtomFamily(workspaceId));
  const setActiveFilePath = useSetAtom(activeFilePathAtomFamily(workspaceId));
  const setOpenFiles = useSetAtom(openFilesAtomFamily(workspaceId));
  const loadedDirs = useAtomValue(loadedDirsAtomFamily(workspaceId));
  const setLoadedDirs = useSetAtom(loadedDirsAtomFamily(workspaceId));

  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingDir, setIsLoadingDir] = useState<string | null>(null);
  const [createDialog, setCreateDialog] = useState<CreateDialogState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDeleteState | null>(null);
  const lastRefreshTokenRef = useRef(refreshToken);
  const lastCreateRequestRef = useRef(0);

  const loadFileTree = useCallback(async () => {
    if (!workspaceId || isLoading) return false;

    setIsLoading(true);
    const result = await dispatch<ReadTreeResult>('file.readTree', {
      workspaceId,
    });

    if (result.ok && result.data) {
      const treeMap = new Map<string, FileNode[]>();
      treeMap.set('.', result.data.children);
      setFileTree(treeMap);
      setLoadedDirs(new Set()); // Clear loaded dirs on full refresh
      setIsLoading(false);
      return true;
    }

    if (!result.ok) {
      console.error('Failed to load file tree:', result.error?.message);
    }

    setIsLoading(false);
    return false;
  }, [workspaceId, isLoading, dispatch, setFileTree, setLoadedDirs]);

  const loadChildren = useCallback(async (dirPath: string) => {
    if (!workspaceId || isLoadingDir === dirPath || loadedDirs.has(dirPath)) return;

    setIsLoadingDir(dirPath);
    const result = await dispatch<ReadTreeResult>('file.readTree', {
      workspaceId,
      subPath: dirPath,
    });

    if (result.ok && result.data) {
      setFileTree((prev) => {
        if (!prev) return prev;
        const next = new Map(prev);
        next.set(dirPath, result.data!.children);
        return next;
      });
      setLoadedDirs((prev) => new Set(prev).add(dirPath));
    }

    setIsLoadingDir(null);
  }, [workspaceId, isLoadingDir, loadedDirs, dispatch, setFileTree, setLoadedDirs]);

  const openCreateDialog = useCallback((mode: 'file' | 'folder', baseDir: string | null) => {
    const normalizedBaseDir = baseDir ? `${baseDir.replace(/\/+$/, '')}/` : '';
    setCreateDialog({
      mode,
      draftPath: normalizedBaseDir,
      error: null,
    });
  }, []);

  const closeCreateDialog = useCallback(() => {
    setCreateDialog(null);
  }, []);

  const updateDraftPath = useCallback((draftPath: string) => {
    setCreateDialog((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        draftPath,
        error: null,
      };
    });
  }, []);

  const submitCreateDialog = useCallback(async () => {
    if (!createDialog) {
      return;
    }

    const path = createDialog.draftPath.trim();
    if (!path) {
      setCreateDialog((current) =>
        current
          ? {
              ...current,
              error: t('file.path_required'),
            }
          : current
      );
      return;
    }

    if (createDialog.mode === 'file' && path.endsWith('/')) {
      setCreateDialog((current) =>
        current
          ? {
              ...current,
              error: t('file.invalid_file_path'),
            }
          : current
      );
      return;
    }

    const op = createDialog.mode === 'file' ? 'file.create' : 'file.mkdir';
    const result = await dispatch(op, {
      workspaceId,
      path,
    });

    if (!result.ok) {
      setCreateDialog((current) =>
        current
          ? {
              ...current,
              error: result.error?.message ?? t('file.create_failed'),
            }
          : current
      );
      return;
    }

    await loadFileTree();
    closeCreateDialog();

    if (createDialog.mode === 'file') {
      setActiveFilePath(path);
    }
  }, [createDialog, dispatch, workspaceId, loadFileTree, closeCreateDialog, setActiveFilePath, t]);

  const cancelDelete = useCallback(() => {
    setPendingDelete(null);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) {
      return;
    }

    const result = await dispatch('file.delete', {
      workspaceId,
      path: pendingDelete.path,
    });

    if (!result.ok) {
      setPendingDelete((current) =>
        current
          ? {
              ...current,
              error: result.error?.message ?? t('file.delete_failed'),
            }
          : current
      );
      return;
    }

    if (activeFilePath === pendingDelete.path) {
      setActiveFilePath(null);
    }

    setOpenFiles((prev) => {
      if (!(pendingDelete.path in prev)) {
        return prev;
      }

      const next = { ...prev };
      delete next[pendingDelete.path];
      return next;
    });
    await loadFileTree();
    setPendingDelete(null);
  }, [
    pendingDelete,
    dispatch,
    workspaceId,
    activeFilePath,
    setActiveFilePath,
    setOpenFiles,
    loadFileTree,
    t,
  ]);

  useEffect(() => {
    if (!fileTree && !isLoading) {
      void loadFileTree();
    }
  }, [fileTree, isLoading, loadFileTree]);

  useEffect(() => {
    if (fileTreeStale && !isLoading) {
      setFileTreeStale(false);
      void loadFileTree();
    }
  }, [fileTreeStale, isLoading, loadFileTree, setFileTreeStale]);

  useEffect(() => {
    if (refreshToken <= lastRefreshTokenRef.current || isLoading) {
      return;
    }

    lastRefreshTokenRef.current = refreshToken;
    void loadFileTree();
  }, [refreshToken, isLoading, loadFileTree]);

  useEffect(() => {
    if (!createRequest || createRequest.id <= lastCreateRequestRef.current) {
      return;
    }

    lastCreateRequestRef.current = createRequest.id;
    openCreateDialog(createRequest.mode, createRequest.baseDir);
    onCreateRequestConsumed?.();
  }, [createRequest, openCreateDialog, onCreateRequestConsumed]);

  return (
    <>
      <div className="file-tree">
        {fileTree && fileTree.size > 0 ? (
          sortNodes(buildNestedTree(fileTree)).map((node) => (
            <FileTreeNode
              key={node.path}
              node={node}
              depth={0}
              selectedPath={activeFilePath}
              onRequestCreate={openCreateDialog}
              onRequestDelete={(path, name) => setPendingDelete({ path, name, error: null })}
              onSelectFile={setActiveFilePath}
              onLoadChildren={loadChildren}
              isLoadingDir={isLoadingDir}
            />
          ))
        ) : (
          <div className="file-tree-empty">
            <p>{isLoading ? 'Loading...' : t('file.title')}</p>
          </div>
        )}
      </div>

      <CreatePathModal
        dialog={createDialog}
        onCancel={closeCreateDialog}
        onConfirm={submitCreateDialog}
        onDraftPathChange={updateDraftPath}
      />

      <DeleteFileModal
        pendingDelete={pendingDelete}
        onCancel={cancelDelete}
        onConfirm={confirmDelete}
      />
    </>
  );
};

interface FileTreeNodeProps {
  node: FileNode;
  depth: number;
  selectedPath: string | null;
  onRequestCreate: (mode: 'file' | 'folder', baseDir: string | null) => void;
  onRequestDelete: (path: string, name: string) => void;
  onSelectFile: (path: string) => void;
  onLoadChildren: (dirPath: string) => void;
  isLoadingDir: string | null;
}

const FileTreeNode: FC<FileTreeNodeProps> = ({
  node,
  depth,
  selectedPath,
  onRequestCreate,
  onRequestDelete,
  onSelectFile,
  onLoadChildren,
  isLoadingDir,
}) => {
  const t = useTranslation();
  const isFolder = node.kind === 'dir';
  const defaultExpanded =
    isFolder && depth === 0 && ['app', 'packages', 'src'].includes(node.name.toLowerCase());
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const autoLoadRequestedRef = useRef(false);

  useEffect(() => {
    if (isFolder && isExpanded && !node.children && !autoLoadRequestedRef.current) {
      autoLoadRequestedRef.current = true;
      onLoadChildren(node.path);
    }
  }, [isFolder, isExpanded, node.children, node.path, onLoadChildren]);

  const handleClick = () => {
    if (isFolder) {
      if (!isExpanded) {
        // Load children on first expand
        onLoadChildren(node.path);
      }
      setIsExpanded(!isExpanded);
    } else {
      onSelectFile(node.path);
    }
  };

  const paddingLeft = depth * 14 + 12;
  const Icon = getNodeIcon(node, isExpanded);

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

        <div className="tree-item-actions">
          {isFolder ? (
            <>
              <button
                aria-label={`${t('file.new_file')} ${node.path}`}
                className="git-row-action"
                onClick={(event) => {
                  event.stopPropagation();
                  onRequestCreate('file', node.path);
                }}
                title={t('file.new_file')}
                type="button"
              >
                <FilePlus size={12} />
              </button>
              <button
                aria-label={`${t('file.new_folder')} ${node.path}`}
                className="git-row-action"
                onClick={(event) => {
                  event.stopPropagation();
                  onRequestCreate('folder', node.path);
                }}
                title={t('file.new_folder')}
                type="button"
              >
                <FolderPlus size={12} />
              </button>
              <button
                aria-label={`${t('file.delete')} ${node.path}`}
                className="git-row-action"
                onClick={(event) => {
                  event.stopPropagation();
                  onRequestDelete(node.path, node.name);
                }}
                title={t('file.delete')}
                type="button"
              >
                <Trash2 size={12} />
              </button>
            </>
          ) : (
            <button
              aria-label={`${t('file.delete')} ${node.path}`}
              className="git-row-action"
              onClick={(event) => {
                event.stopPropagation();
                onRequestDelete(node.path, node.name);
              }}
              title={t('file.delete')}
              type="button"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>

      {isFolder && isExpanded && node.children && (
        <div className="tree-children">
          {sortNodes(node.children).map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onRequestCreate={onRequestCreate}
              onRequestDelete={onRequestDelete}
              onSelectFile={onSelectFile}
              onLoadChildren={onLoadChildren}
              isLoadingDir={isLoadingDir}
            />
          ))}
          {node.children.length === 0 && !isLoadingDir && (
            <div className="tree-empty-hint">Empty directory</div>
          )}
        </div>
      )}

      {isFolder && isExpanded && !node.children && isLoadingDir === node.path && (
        <div className="tree-loading">Loading...</div>
      )}
    </>
  );
};

interface CreatePathModalProps {
  dialog: CreateDialogState | null;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
  onDraftPathChange: (draftPath: string) => void;
}

const CreatePathModal: FC<CreatePathModalProps> = ({
  dialog,
  onCancel,
  onConfirm,
  onDraftPathChange,
}) => {
  const t = useTranslation();

  if (!dialog) {
    return null;
  }

  const helperText =
    dialog.mode === 'file' ? t('file.path_helper_file') : t('file.path_helper_folder');

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            {dialog.mode === 'file' ? <FilePlus size={16} /> : <FolderPlus size={16} />}
            <h3>{dialog.mode === 'file' ? t('file.new_file') : t('file.new_folder')}</h3>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onCancel} aria-label={t('action.close')}>
            <X size={14} />
          </button>
        </div>

        <div className="modal-body">
          <div className="form-group">
            <label htmlFor="file-path">{t('file.path')}</label>
            <input
              id="file-path"
              className="input"
              value={dialog.draftPath}
              onChange={(event) => onDraftPathChange(event.target.value)}
              placeholder={dialog.mode === 'file' ? 'src/demo/new-file.ts' : 'src/demo/new-folder'}
              autoFocus
            />
            <span className="dialog-helper">{helperText}</span>
            {dialog.error ? (
              <span className="form-error" role="alert">
                {dialog.error}
              </span>
            ) : null}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onCancel}>
            {t('action.cancel')}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              void onConfirm();
            }}
          >
            {t('action.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
};

interface DeleteFileModalProps {
  pendingDelete: PendingDeleteState | null;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}

const DeleteFileModal: FC<DeleteFileModalProps> = ({ pendingDelete, onCancel, onConfirm }) => {
  const t = useTranslation();

  if (!pendingDelete) {
    return null;
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <AlertTriangle size={16} />
            <h3>{t('file.delete')}</h3>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onCancel} aria-label={t('action.close')}>
            <X size={14} />
          </button>
        </div>

        <div className="modal-body">
          <p>{t('file.delete_confirm', { name: pendingDelete.name })}</p>
          {pendingDelete.error ? (
            <span className="form-error" role="alert">
              {pendingDelete.error}
            </span>
          ) : null}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onCancel}>
            {t('action.cancel')}
          </button>
          <button
            className="btn btn-danger"
            onClick={() => {
              void onConfirm();
            }}
          >
            {t('action.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default FileTreePanel;

/**
 * Reconstructs a nested tree structure from a flat Map<path, FileNode[]>
 * for rendering. Only traverses loaded portions of the tree.
 */
function buildNestedTree(treeMap: Map<string, FileNode[]>): FileNode[] {
  const attachChildren = (nodes: FileNode[]): FileNode[] =>
    nodes.map((node) => {
      if (node.kind === 'dir' && treeMap.has(node.path)) {
        return {
          ...node,
          children: attachChildren(treeMap.get(node.path)!),
        };
      }
      return node;
    });

  return attachChildren(treeMap.get('.') ?? []);
}

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
