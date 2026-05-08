import type { FileNode } from "@coder-studio/core";
import type { LucideIcon } from "lucide-react";
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  File as FileIcon,
  FileImage,
  FileJson2,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import type { FC } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  ConfirmDialog,
  IconButton,
  Input,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import {
  type CreateDialogState,
  type CreateRequest,
  type PendingDeleteState,
  useFileActions,
} from "../../actions/use-file-actions";

interface FileTreePanelProps {
  workspaceId: string;
  refreshToken?: number;
  createRequest?: CreateRequest | null;
  onCreateRequestConsumed?: () => void;
  onSelectFile?: (path: string) => void;
  onVisibleCountChange?: (count: number, loading: boolean) => void;
  collapseVersion?: number;
  variant?: "desktop" | "mobile";
}

export const FileTreePanel: FC<FileTreePanelProps> = ({
  workspaceId,
  refreshToken = 0,
  createRequest = null,
  onCreateRequestConsumed,
  onSelectFile,
  onVisibleCountChange,
  collapseVersion = 0,
  variant = "desktop",
}) => {
  const t = useTranslation();
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
    loadSearchResults,
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
  const [searchValue, setSearchValue] = useState("");
  const searchQuery = searchValue.trim();
  const treeNodes = useMemo(
    () => (fileTree ? sortNodes(buildNestedTree(fileTree)) : []),
    [fileTree]
  );
  const [searchResults, setSearchResults] = useState<FileNode[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchRequestIdRef = useRef(0);
  const hasSearch = searchQuery.length > 0;
  const visibleFileCount = useMemo(
    () => (hasSearch ? searchResults.length : countVisibleFiles(treeNodes)),
    [hasSearch, searchResults.length, treeNodes]
  );

  useEffect(() => {
    let cancelled = false;

    if (!hasSearch) {
      setSearchResults([]);
      setSearchLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setSearchLoading(true);
    const requestId = ++searchRequestIdRef.current;

    const timeout = setTimeout(() => {
      void (async () => {
        const result = await loadSearchResults(searchQuery);

        if (cancelled || requestId !== searchRequestIdRef.current) {
          return;
        }

        setSearchResults(result);
        setSearchLoading(false);
      })();
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [hasSearch, loadSearchResults, searchQuery]);

  useEffect(() => {
    onVisibleCountChange?.(visibleFileCount, searchLoading || isLoading);
  }, [isLoading, onVisibleCountChange, searchLoading, visibleFileCount]);

  return (
    <>
      <div className={`file-tree-shell file-tree-shell--${variant}`}>
        <label className="file-tree-search" htmlFor={`file-tree-search-${workspaceId}`}>
          <Search size={14} className="file-tree-search-icon" aria-hidden="true" />
          <input
            id={`file-tree-search-${workspaceId}`}
            className="file-tree-search-input"
            type="search"
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            placeholder={t("action.search_files")}
            aria-label={t("action.search_files")}
          />
        </label>

        <div className="file-tree">
          {hasSearch ? (
            searchLoading ? (
              <div className="file-tree-empty">
                <p>{t("common.loading")}</p>
              </div>
            ) : searchResults.length > 0 ? (
              searchResults.map((node) => (
                <FileSearchResultRow
                  key={node.path}
                  node={node}
                  selectedPath={activeFilePath}
                  onRequestDelete={(path, name) => requestDelete({ path, name, error: null })}
                  onSelectFile={handleSelectFile}
                />
              ))
            ) : (
              <div className="file-tree-empty">
                <p>{t("command.no_results")}</p>
              </div>
            )
          ) : fileTree && fileTree.size > 0 ? (
            treeNodes.map((node) => (
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
                collapseVersion={collapseVersion}
              />
            ))
          ) : (
            <div className="file-tree-empty">
              <p>{isLoading ? t("common.loading") : t("file.title")}</p>
            </div>
          )}
        </div>
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

interface FileSearchResultRowProps {
  node: FileNode;
  selectedPath: string | null;
  onRequestDelete: (path: string, name: string) => void;
  onSelectFile: (path: string) => void;
}

const FileSearchResultRow: FC<FileSearchResultRowProps> = ({
  node,
  selectedPath,
  onRequestDelete,
  onSelectFile,
}) => {
  const t = useTranslation();
  const Icon = getNodeIcon(node, false);
  const dirName = node.path.includes("/") ? node.path.slice(0, node.path.lastIndexOf("/")) : "";

  return (
    <div
      className={`tree-item ${selectedPath === node.path ? "selected" : ""}`}
      onClick={() => onSelectFile(node.path)}
      style={{ paddingLeft: 12 }}
      title={node.path}
    >
      <span className="tree-chevron" aria-hidden="true" />

      <span className={`tree-icon ${getNodeToneClass(node, false)}`}>
        <Icon size={14} />
      </span>

      <span className="tree-search-labels">
        <span className="tree-label">{node.name}</span>
        {dirName ? <span className="tree-search-path">{dirName}</span> : null}
      </span>

      <div className="tree-item-actions">
        <button
          aria-label={`${t("file.delete")} ${node.path}`}
          className="git-row-action"
          onClick={(event) => {
            event.stopPropagation();
            onRequestDelete(node.path, node.name);
          }}
          title={t("file.delete")}
          type="button"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
};

interface FileTreeNodeProps {
  node: FileNode;
  depth: number;
  selectedPath: string | null;
  onRequestCreate: (mode: "file" | "folder", baseDir: string | null) => void;
  onRequestDelete: (path: string, name: string) => void;
  onSelectFile: (path: string) => void;
  onLoadChildren: (dirPath: string) => void;
  isLoadingDir: string | null;
  collapseVersion: number;
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
  collapseVersion,
}) => {
  const t = useTranslation();
  const isFolder = node.kind === "dir";
  const defaultExpanded =
    isFolder && depth === 0 && ["app", "packages", "src"].includes(node.name.toLowerCase());
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

  useEffect(() => {
    if (collapseVersion > 0) {
      setIsExpanded(false);
    }
  }, [collapseVersion]);

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

  const paddingLeft = depth * 14 + 16;
  const Icon = getNodeIcon(node, isExpanded);

  return (
    <>
      <div
        className={`tree-item ${selectedPath === node.path ? "selected" : ""}`}
        onClick={handleClick}
        style={{ paddingLeft }}
        title={node.path}
      >
        <span className="tree-chevron" aria-hidden="true">
          {isFolder ? isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : null}
        </span>

        <span className={`tree-icon ${getNodeToneClass(node, isExpanded)}`}>
          <Icon size={14} />
        </span>

        <span className="tree-label">{node.name}</span>

        <div className="tree-item-actions">
          {isFolder ? (
            <>
              <button
                aria-label={`${t("file.new_file")} ${node.path}`}
                className="git-row-action"
                onClick={(event) => {
                  event.stopPropagation();
                  onRequestCreate("file", node.path);
                }}
                title={t("file.new_file")}
                type="button"
              >
                <FilePlus size={12} />
              </button>
              <button
                aria-label={`${t("file.new_folder")} ${node.path}`}
                className="git-row-action"
                onClick={(event) => {
                  event.stopPropagation();
                  onRequestCreate("folder", node.path);
                }}
                title={t("file.new_folder")}
                type="button"
              >
                <FolderPlus size={12} />
              </button>
              <button
                aria-label={`${t("file.delete")} ${node.path}`}
                className="git-row-action"
                onClick={(event) => {
                  event.stopPropagation();
                  onRequestDelete(node.path, node.name);
                }}
                title={t("file.delete")}
                type="button"
              >
                <Trash2 size={12} />
              </button>
            </>
          ) : (
            <button
              aria-label={`${t("file.delete")} ${node.path}`}
              className="git-row-action"
              onClick={(event) => {
                event.stopPropagation();
                onRequestDelete(node.path, node.name);
              }}
              title={t("file.delete")}
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
              collapseVersion={collapseVersion}
            />
          ))}
          {node.children.length === 0 && !isLoadingDir && (
            <div className="tree-empty-hint">{t("file.empty_directory")}</div>
          )}
        </div>
      )}

      {isFolder && isExpanded && !node.children && isLoadingDir === node.path && (
        <div className="tree-loading">{t("common.loading")}</div>
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
  const inputRef = useRef<HTMLInputElement | null>(null);

  if (!dialog) {
    return null;
  }

  const helperText =
    dialog.mode === "file" ? t("file.path_helper_file") : t("file.path_helper_folder");

  return (
    <Modal initialFocus={() => inputRef.current} onOpenChange={onCancel} open>
      <ModalHeader>
        <ModalTitle>
          {dialog.mode === "file" ? (
            <FilePlus aria-hidden="true" size={16} />
          ) : (
            <FolderPlus aria-hidden="true" size={16} />
          )}
          <span>{dialog.mode === "file" ? t("file.new_file") : t("file.new_folder")}</span>
        </ModalTitle>
        <IconButton
          aria-label={t("action.close")}
          icon={<X size={14} />}
          onClick={onCancel}
          size="sm"
        />
      </ModalHeader>

      <ModalBody>
        <div className="form-group">
          <label htmlFor="file-path">{t("file.path")}</label>
          <Input
            id="file-path"
            ref={inputRef}
            value={dialog.draftPath}
            onChange={(event) => onDraftPathChange(event.target.value)}
            placeholder={dialog.mode === "file" ? "src/demo/new-file.ts" : "src/demo/new-folder"}
          />
          <span className="dialog-helper">{helperText}</span>
          {dialog.error ? (
            <span className="form-error" role="alert">
              {dialog.error}
            </span>
          ) : null}
        </div>
      </ModalBody>

      <ModalFooter>
        <Button onClick={onCancel}>{t("action.cancel")}</Button>
        <Button
          variant="primary"
          onClick={() => {
            void onConfirm();
          }}
        >
          {t("action.confirm")}
        </Button>
      </ModalFooter>
    </Modal>
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
    <ConfirmDialog
      open
      onOpenChange={onCancel}
      title={t("file.delete")}
      description={
        <>
          <p>{t("file.delete_confirm", { name: pendingDelete.name })}</p>
          {pendingDelete.error ? (
            <span className="form-error" role="alert">
              {pendingDelete.error}
            </span>
          ) : null}
        </>
      }
      cancelText={t("action.cancel")}
      closeLabel={t("action.close")}
      confirmText={t("action.confirm")}
      onConfirm={() => {
        void onConfirm();
      }}
      tone="danger"
    />
  );
};

export default FileTreePanel;

function countVisibleFiles(nodes: FileNode[]): number {
  return nodes.reduce((count, node) => {
    if (node.kind === "file") {
      return count + 1;
    }

    return count + countVisibleFiles(node.children ?? []);
  }, 0);
}

function buildNestedTree(treeMap: Map<string, FileNode[]>): FileNode[] {
  const attachChildren = (nodes: FileNode[]): FileNode[] =>
    nodes.map((node) => {
      if (node.kind === "dir" && treeMap.has(node.path)) {
        return {
          ...node,
          children: attachChildren(treeMap.get(node.path)!),
        };
      }
      return node;
    });

  return attachChildren(treeMap.get(".") ?? []);
}

function sortNodes(nodes: FileNode[]) {
  return [...nodes].sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === "dir" ? -1 : 1;
    }

    return a.name.localeCompare(b.name);
  });
}

function getNodeIcon(node: FileNode, isExpanded: boolean): LucideIcon {
  if (node.kind === "dir") {
    return isExpanded ? FolderOpen : Folder;
  }

  const ext = node.name.split(".").pop()?.toLowerCase();

  switch (ext) {
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
    case "py":
    case "go":
    case "rs":
    case "java":
      return FileCode2;
    case "json":
    case "yaml":
    case "yml":
    case "toml":
    case "lock":
      return FileJson2;
    case "md":
    case "txt":
      return FileText;
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "svg":
    case "webp":
      return FileImage;
    default:
      return FileIcon;
  }
}

function getNodeToneClass(node: FileNode, isExpanded: boolean) {
  if (node.kind === "dir") {
    return isExpanded ? "folder-open" : "folder";
  }

  return "file";
}
