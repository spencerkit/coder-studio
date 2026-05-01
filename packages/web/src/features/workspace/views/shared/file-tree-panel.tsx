import type { FC } from 'react';
import { useEffect, useRef, useState } from 'react';
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
import type { FileNode } from '@coder-studio/core';
import { useTranslation } from '../../../../lib/i18n';
import {
  useFileActions,
  type CreateDialogState,
  type CreateRequest,
  type PendingDeleteState,
} from '../../actions/use-file-actions';

interface FileTreePanelProps {
  workspaceId: string;
  refreshToken?: number;
  createRequest?: CreateRequest | null;
  onCreateRequestConsumed?: () => void;
  onSelectFile?: (path: string) => void;
}

export const FileTreePanel: FC<FileTreePanelProps> = ({
  workspaceId,
  refreshToken = 0,
  createRequest = null,
  onCreateRequestConsumed,
  onSelectFile,
}) => {
  const {
    activeFilePath,
    createDialog,
    fileTree,
    isLoading,
    isLoadingDir,
    pendingDelete,
    cancelDelete,
    confirmDelete,
    handleSelectFile,
    loadChildren,
    openCreateDialog,
    requestDelete,
    submitCreateDialog,
    updateDraftPath,
    closeCreateDialog,
  } = useFileActions({
    workspaceId,
    refreshToken,
    createRequest,
    onCreateRequestConsumed,
    onSelectFile,
  });
  const t = useTranslation();

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
              onRequestDelete={(path, name) => requestDelete({ path, name, error: null })}
              onSelectFile={handleSelectFile}
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
    if (node.children) {
      autoLoadRequestedRef.current = false;
    }
  }, [node.children]);

  useEffect(() => {
    if (isFolder && isExpanded && !node.children && !autoLoadRequestedRef.current) {
      autoLoadRequestedRef.current = true;
      onLoadChildren(node.path);
    }
  }, [isFolder, isExpanded, node.children, node.path, onLoadChildren]);

  const handleClick = () => {
    if (isFolder) {
      if (!isExpanded) {
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
