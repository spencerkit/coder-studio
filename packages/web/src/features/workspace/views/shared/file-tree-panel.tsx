import type { FileNode } from "@coder-studio/core";
import { useAtomValue, useSetAtom } from "jotai";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import type { FC, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { workspaceByIdAtomFamily } from "../../../../atoms/workspaces";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Input,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ThemedIcon,
  Tooltip,
} from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { useCreateShellTerminal } from "../../../terminal-panel/actions/use-create-shell-terminal";
import {
  type CreateDialogState,
  type CreateRequest,
  type PendingDeleteState,
  type RenameDialogState,
  useFileActions,
} from "../../actions/use-file-actions";
import { useFileContextActions } from "../../actions/use-file-context-actions";
import {
  type FileContextTarget,
  useFileTreeContextMenu,
} from "../../actions/use-file-tree-context-menu";
import { useWorkspaceUiStatePersistence } from "../../actions/use-workspace-ui-state-persistence";
import { expandedDirsAtomFamily } from "../../atoms";
import { FileContextMenu } from "./file-context-menu";
import { getFileNodeSemantic } from "./file-tree-icon-semantics";

const DEFAULT_EXPANDED_ROOT_DIRS = new Set(["app", "packages", "src"]);
const MAX_PERSISTED_EXPANDED_DIRS = 200;

const fileTreeEmptyStateStyle = {
  minHeight: "auto",
  padding: "var(--sp-4)",
  gap: 0,
};

const fileTreeEmptyStateTitleStyle = {
  margin: 0,
  color: "var(--text-tertiary)",
  fontSize: "inherit",
  fontWeight: "var(--font-normal)",
};

const fileTreeInlineStateStyle = {
  display: "block",
  width: "auto",
  minHeight: "auto",
  padding: 0,
  gap: 0,
  textAlign: "left" as const,
};

const fileTreeInlineStateTitleStyle = {
  margin: 0,
  color: "inherit",
  fontSize: "inherit",
  fontWeight: "inherit",
};

function FileTreeEmptyState({ title }: { title: string }) {
  return (
    <EmptyState
      className="file-tree-empty"
      style={fileTreeEmptyStateStyle}
      title={<p style={fileTreeEmptyStateTitleStyle}>{title}</p>}
    />
  );
}

function FileTreeInlineState({
  className,
  title,
}: {
  className: "tree-empty-hint" | "tree-loading";
  title: string;
}) {
  return (
    <EmptyState
      className={className}
      style={fileTreeInlineStateStyle}
      title={<p style={fileTreeInlineStateTitleStyle}>{title}</p>}
    />
  );
}

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

function normalizeExpandedDirs(paths: Iterable<string>): string[] {
  return [...new Set([...paths].map(normalizeDirPath).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b))
    .slice(0, MAX_PERSISTED_EXPANDED_DIRS);
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
  const workspace = useAtomValue(workspaceByIdAtomFamily(workspaceId));
  const expandedDirs = useAtomValue(expandedDirsAtomFamily(workspaceId));
  const setExpandedDirs = useSetAtom(expandedDirsAtomFamily(workspaceId));
  const { persistUiState } = useWorkspaceUiStatePersistence(workspaceId);
  const { createShellTerminal } = useCreateShellTerminal(workspaceId);
  const {
    activeFilePath,
    createDialog,
    fileTree,
    isLoading,
    isLoadingDir,
    renameDialog,
    pendingDelete,
    cancelDelete,
    confirmDelete,
    handleSelectFile,
    loadChildren,
    loadSearchResults,
    openCreateDialog,
    openRenameDialog,
    requestDelete,
    updateRenameDraft,
    submitRenameDialog,
    closeRenameDialog,
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
  const [contextTargetPath, setContextTargetPath] = useState<string | null>(null);
  const searchRequestIdRef = useRef(0);
  const {
    contextTarget,
    desktopAnchorPoint,
    isOpen: isContextMenuOpen,
    closeMenu,
    openDesktopMenu,
    beginLongPress,
    updateLongPress,
    cancelLongPress,
    consumeSuppressedClick,
  } = useFileTreeContextMenu();
  const hasSearch = searchQuery.length > 0;
  const visibleFileCount = useMemo(
    () => (hasSearch ? searchResults.length : countVisibleFiles(treeNodes)),
    [hasSearch, searchResults.length, treeNodes]
  );
  const defaultExpandedRootPaths = useMemo(
    () =>
      treeNodes
        .filter(
          (node) => node.kind === "dir" && DEFAULT_EXPANDED_ROOT_DIRS.has(node.name.toLowerCase())
        )
        .map((node) => node.path),
    [treeNodes]
  );
  const contextMenuSections = useFileContextActions({
    workspacePath: workspace?.path ?? null,
    target: contextTarget,
    createShellTerminal,
    openCreateDialog,
    openRenameDialog,
    requestDelete: ({ path, name, error }) => requestDelete({ path, name, error }),
  });

  useEffect(() => {
    if (expandedDirs !== null || !workspace) {
      return;
    }

    if (workspace.uiState.fileTreeExpandedDirs !== undefined) {
      setExpandedDirs(new Set(normalizeExpandedDirs(workspace.uiState.fileTreeExpandedDirs)));
    }
  }, [expandedDirs, setExpandedDirs, workspace]);

  const applyExpandedDirs = useCallback(
    (nextPaths: Iterable<string>) => {
      const normalized = normalizeExpandedDirs(nextPaths);
      setExpandedDirs(new Set(normalized));
      void persistUiState({ fileTreeExpandedDirs: normalized });
    },
    [persistUiState, setExpandedDirs]
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

  useEffect(() => {
    if (collapseVersion <= 0) {
      return;
    }

    applyExpandedDirs([]);
  }, [applyExpandedDirs, collapseVersion]);

  useEffect(() => {
    if (!contextTarget) {
      return;
    }

    setContextTargetPath(contextTarget.node.path);
  }, [contextTarget]);

  const closeContextMenu = useCallback(() => {
    setContextTargetPath(null);
    closeMenu();
  }, [closeMenu]);

  const openRowContextMenu = useCallback(
    (
      event: ReactMouseEvent<HTMLElement>,
      node: FileNode,
      surface: FileContextTarget["surface"]
    ) => {
      if (node.kind === "file") {
        handleSelectFile(node.path);
      }

      setContextTargetPath(node.path);
      openDesktopMenu(event, {
        node,
        surface,
        triggerElement: event.currentTarget,
      });
    },
    [handleSelectFile, openDesktopMenu]
  );

  const beginRowLongPress = useCallback(
    (
      event: ReactPointerEvent<HTMLElement>,
      node: FileNode,
      surface: FileContextTarget["surface"]
    ) => {
      beginLongPress(event, {
        node,
        surface,
        triggerElement: event.currentTarget,
      });
    },
    [beginLongPress]
  );

  return (
    <>
      <div className={`file-tree-shell file-tree-shell--${variant}`}>
        <label
          className={`file-tree-search ${variant === "desktop" ? "file-tree-search--desktop" : ""}`}
          htmlFor={`file-tree-search-${workspaceId}`}
        >
          <ThemedIcon
            semantic="file.action.search"
            size={14}
            className="file-tree-search-icon"
            aria-hidden="true"
          />
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
              <FileTreeEmptyState title={t("common.loading")} />
            ) : searchResults.length > 0 ? (
              searchResults.map((node) => (
                <FileSearchResultRow
                  key={node.path}
                  node={node}
                  variant={variant}
                  selectedPath={activeFilePath}
                  isContextTarget={contextTargetPath === node.path}
                  onSelectFile={handleSelectFile}
                  onOpenContextMenu={openRowContextMenu}
                  onBeginLongPress={beginRowLongPress}
                  onUpdateLongPress={updateLongPress}
                  onCancelLongPress={cancelLongPress}
                  consumeSuppressedClick={consumeSuppressedClick}
                />
              ))
            ) : (
              <FileTreeEmptyState title={t("command.no_results")} />
            )
          ) : fileTree && fileTree.size > 0 ? (
            treeNodes.map((node) => (
              <FileTreeNode
                key={node.path}
                node={node}
                depth={0}
                variant={variant}
                expandedDirs={expandedDirs}
                defaultExpandedRootPaths={defaultExpandedRootPaths}
                selectedPath={activeFilePath}
                contextTargetPath={contextTargetPath}
                onRequestCreate={openCreateDialog}
                onSelectFile={handleSelectFile}
                onLoadChildren={loadChildren}
                onToggleDirs={applyExpandedDirs}
                isLoadingDir={isLoadingDir}
                onOpenContextMenu={openRowContextMenu}
                onBeginLongPress={beginRowLongPress}
                onUpdateLongPress={updateLongPress}
                onCancelLongPress={cancelLongPress}
                consumeSuppressedClick={consumeSuppressedClick}
              />
            ))
          ) : (
            <FileTreeEmptyState title={isLoading ? t("common.loading") : t("file.title")} />
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

      <RenamePathModal
        dialog={renameDialog}
        onCancel={closeRenameDialog}
        onConfirm={submitRenameDialog}
        onDraftChange={updateRenameDraft}
      />

      <FileContextMenu
        title={t("file.context_menu_title")}
        open={isContextMenuOpen && contextMenuSections.length > 0}
        mode={variant === "mobile" ? "mobile" : "desktop"}
        sections={contextMenuSections}
        anchorPoint={desktopAnchorPoint}
        restoreFocusTo={contextTarget?.triggerElement ?? null}
        onClose={closeContextMenu}
      />
    </>
  );
};

interface FileSearchResultRowProps {
  node: FileNode;
  variant: "desktop" | "mobile";
  selectedPath: string | null;
  isContextTarget: boolean;
  onSelectFile: (path: string) => void;
  onOpenContextMenu: (
    event: ReactMouseEvent<HTMLElement>,
    node: FileNode,
    surface: FileContextTarget["surface"]
  ) => void;
  onBeginLongPress: (
    event: ReactPointerEvent<HTMLElement>,
    node: FileNode,
    surface: FileContextTarget["surface"]
  ) => void;
  onUpdateLongPress: (event: ReactPointerEvent<HTMLElement>) => void;
  onCancelLongPress: (pointerId?: number) => void;
  consumeSuppressedClick: () => boolean;
}

const FileSearchResultRow: FC<FileSearchResultRowProps> = ({
  node,
  variant,
  selectedPath,
  isContextTarget,
  onSelectFile,
  onOpenContextMenu,
  onBeginLongPress,
  onUpdateLongPress,
  onCancelLongPress,
  consumeSuppressedClick,
}) => {
  const dirName = node.path.includes("/") ? node.path.slice(0, node.path.lastIndexOf("/")) : "";
  const surface = variant === "mobile" ? "mobile" : "search";

  return (
    <div
      className={`tree-item tree-item--file ${selectedPath === node.path ? "selected" : ""} ${
        isContextTarget ? "tree-item--context-target" : ""
      }`}
      onClick={() => {
        if (consumeSuppressedClick()) {
          return;
        }

        onSelectFile(node.path);
      }}
      onContextMenu={
        variant === "desktop" ? (event) => onOpenContextMenu(event, node, surface) : undefined
      }
      onPointerDown={(event) => onBeginLongPress(event, node, surface)}
      onPointerMove={onUpdateLongPress}
      onPointerCancel={(event) => onCancelLongPress(event.pointerId)}
      onPointerUp={(event) => onCancelLongPress(event.pointerId)}
      style={{ paddingLeft: 12 }}
    >
      <span className="tree-chevron" aria-hidden="true" />

      <span className="tree-icon" aria-hidden="true">
        <ThemedIcon semantic={getFileNodeSemantic(node, false)} size={14} />
      </span>

      <span className="tree-search-labels">
        <span className="tree-label">{node.name}</span>
        {dirName ? <span className="tree-search-path">{dirName}</span> : null}
      </span>
    </div>
  );
};

interface FileTreeNodeProps {
  node: FileNode;
  depth: number;
  variant: "desktop" | "mobile";
  expandedDirs: Set<string> | null;
  defaultExpandedRootPaths: string[];
  selectedPath: string | null;
  contextTargetPath: string | null;
  onRequestCreate: (mode: "file" | "folder", baseDir: string | null) => void;
  onSelectFile: (path: string) => void;
  onLoadChildren: (dirPath: string) => void;
  onToggleDirs: (nextPaths: Iterable<string>) => void;
  isLoadingDir: string | null;
  onOpenContextMenu: (
    event: ReactMouseEvent<HTMLElement>,
    node: FileNode,
    surface: FileContextTarget["surface"]
  ) => void;
  onBeginLongPress: (
    event: ReactPointerEvent<HTMLElement>,
    node: FileNode,
    surface: FileContextTarget["surface"]
  ) => void;
  onUpdateLongPress: (event: ReactPointerEvent<HTMLElement>) => void;
  onCancelLongPress: (pointerId?: number) => void;
  consumeSuppressedClick: () => boolean;
}

const FileTreeNode: FC<FileTreeNodeProps> = ({
  node,
  depth,
  variant,
  expandedDirs,
  defaultExpandedRootPaths,
  selectedPath,
  contextTargetPath,
  onRequestCreate,
  onSelectFile,
  onLoadChildren,
  onToggleDirs,
  isLoadingDir,
  onOpenContextMenu,
  onBeginLongPress,
  onUpdateLongPress,
  onCancelLongPress,
  consumeSuppressedClick,
}) => {
  const t = useTranslation();
  const isFolder = node.kind === "dir";
  const hasPersistedExpansionState = expandedDirs !== null;
  const isExpanded =
    isFolder &&
    (hasPersistedExpansionState
      ? expandedDirs.has(node.path)
      : depth === 0 && defaultExpandedRootPaths.includes(node.path));
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
    if (variant === "mobile" && consumeSuppressedClick()) {
      return;
    }

    if (!isFolder) {
      onSelectFile(node.path);
      return;
    }

    const nextExpanded = new Set(expandedDirs ?? defaultExpandedRootPaths);
    if (isExpanded) {
      nextExpanded.delete(node.path);
    } else {
      nextExpanded.add(node.path);
      if (!node.children) {
        onLoadChildren(node.path);
      }
    }

    onToggleDirs(nextExpanded);
  };

  const paddingLeft = depth * 14 + 16;

  return (
    <>
      <div
        className={`tree-item tree-item--${node.kind} ${
          selectedPath === node.path ? "selected" : ""
        } ${contextTargetPath === node.path ? "tree-item--context-target" : ""}`}
        onClick={handleClick}
        onContextMenu={
          variant === "desktop" ? (event) => onOpenContextMenu(event, node, "tree") : undefined
        }
        onPointerDown={
          variant === "mobile" ? (event) => onBeginLongPress(event, node, "mobile") : undefined
        }
        onPointerMove={variant === "mobile" ? onUpdateLongPress : undefined}
        onPointerCancel={
          variant === "mobile" ? (event) => onCancelLongPress(event.pointerId) : undefined
        }
        onPointerUp={
          variant === "mobile" ? (event) => onCancelLongPress(event.pointerId) : undefined
        }
        style={{ paddingLeft }}
      >
        <span className="tree-chevron" aria-hidden="true">
          {isFolder ? isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : null}
        </span>

        <span className="tree-icon" aria-hidden="true">
          <ThemedIcon semantic={getFileNodeSemantic(node, isExpanded)} size={14} />
        </span>

        <span className="tree-label">{node.name}</span>

        {variant === "desktop" ? (
          <div className="tree-item-actions">
            {isFolder ? (
              <>
                <Tooltip content={t("file.new_file")}>
                  <IconButton
                    aria-label={`${t("file.new_file")} ${node.path}`}
                    className="git-row-action"
                    icon={<ThemedIcon semantic="file.action.new" size={12} />}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRequestCreate("file", node.path);
                    }}
                    size="sm"
                  />
                </Tooltip>
                <Tooltip content={t("file.new_folder")}>
                  <IconButton
                    aria-label={`${t("file.new_folder")} ${node.path}`}
                    className="git-row-action"
                    icon={<ThemedIcon semantic="file.action.newFolder" size={12} />}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRequestCreate("folder", node.path);
                    }}
                    size="sm"
                  />
                </Tooltip>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {isFolder && isExpanded && node.children && (
        <div className="tree-children">
          {sortNodes(node.children).map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              variant={variant}
              expandedDirs={expandedDirs}
              selectedPath={selectedPath}
              contextTargetPath={contextTargetPath}
              onRequestCreate={onRequestCreate}
              onSelectFile={onSelectFile}
              onLoadChildren={onLoadChildren}
              onToggleDirs={onToggleDirs}
              defaultExpandedRootPaths={defaultExpandedRootPaths}
              isLoadingDir={isLoadingDir}
              onOpenContextMenu={onOpenContextMenu}
              onBeginLongPress={onBeginLongPress}
              onUpdateLongPress={onUpdateLongPress}
              onCancelLongPress={onCancelLongPress}
              consumeSuppressedClick={consumeSuppressedClick}
            />
          ))}
          {node.children.length === 0 && !isLoadingDir && (
            <FileTreeInlineState className="tree-empty-hint" title={t("file.empty_directory")} />
          )}
        </div>
      )}

      {isFolder && isExpanded && !node.children && isLoadingDir === node.path && (
        <FileTreeInlineState className="tree-loading" title={t("common.loading")} />
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

  const helperId = "file-path-helper";
  const errorId = dialog.error ? "file-path-error" : undefined;
  const helperText =
    dialog.mode === "file" ? t("file.path_helper_file") : t("file.path_helper_folder");
  const describedBy = [helperId, errorId].filter(Boolean).join(" ");

  return (
    <Modal initialFocus={() => inputRef.current} onOpenChange={onCancel} open>
      <ModalHeader>
        <ModalTitle>
          {dialog.mode === "file" ? (
            <ThemedIcon aria-hidden="true" semantic="file.action.new" size={16} />
          ) : (
            <ThemedIcon aria-hidden="true" semantic="file.action.newFolder" size={16} />
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
            aria-describedby={describedBy}
            invalid={Boolean(dialog.error)}
            autoFocus
          />
          <span id={helperId} className="dialog-helper">
            {helperText}
          </span>
          {dialog.error ? (
            <span id={errorId} className="form-error" role="alert">
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

interface RenamePathModalProps {
  dialog: RenameDialogState | null;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
  onDraftChange: (value: string) => void;
}

const RenamePathModal: FC<RenamePathModalProps> = ({
  dialog,
  onCancel,
  onConfirm,
  onDraftChange,
}) => {
  const t = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);

  if (!dialog) {
    return null;
  }

  const helperId = "file-rename-helper";
  const errorId = dialog.error ? "file-rename-error" : undefined;
  const describedBy = [helperId, errorId].filter(Boolean).join(" ");

  return (
    <Modal initialFocus={() => inputRef.current} onOpenChange={onCancel} open>
      <ModalHeader>
        <ModalTitle>
          <span>{t("file.rename")}</span>
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
          <label htmlFor="file-rename">{t("file.rename_name")}</label>
          <Input
            id="file-rename"
            ref={inputRef}
            value={dialog.nextName}
            onChange={(event) => onDraftChange(event.target.value)}
            aria-describedby={describedBy}
            invalid={Boolean(dialog.error)}
            autoFocus
          />
          <span id={helperId} className="dialog-helper">
            {t("file.rename_helper")}
          </span>
          {dialog.error ? (
            <span id={errorId} className="form-error" role="alert">
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

export default FileTreePanel;

function normalizeDirPath(path: string): string {
  return path
    .trim()
    .replace(/^\.\/+/, "")
    .replace(/\/+$/, "");
}

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
