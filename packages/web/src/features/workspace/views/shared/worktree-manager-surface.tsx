import { useAtomValue } from "jotai";
import { ArrowUp } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dispatchCommandAtom } from "../../../../atoms/connection";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  Input,
  Modal,
  ModalBody,
  ModalHeader,
  ModalTitle,
  Sheet,
  Spinner,
  ThemedIcon,
} from "../../../../components/ui";
import { useViewport } from "../../../../hooks/use-viewport";
import { useTranslation } from "../../../../lib/i18n";
import { useWorktreeManagementActions } from "../../actions/use-worktree-management-actions";
import {
  getAbsolutePathName,
  getAbsolutePathParent,
  isAbsoluteWorktreePath,
  joinAbsoluteChildPath,
} from "../../path-utils";
import { WorktreeDetailPanel } from "./worktree-detail-panel";

type WorktreeManagerView = "list" | "detail" | "create" | "confirm-delete";

interface WorktreeManagerSurfaceProps {
  workspaceId: string;
  openView: "list" | "create" | null;
  onClose: () => void;
  desktopPreviewInline?: boolean;
}

const worktreeListEmptyStateStyle = {
  minHeight: "auto",
  padding: "var(--sp-4) 0",
  gap: 0,
};

const worktreeListEmptyStateTitleStyle = {
  margin: 0,
  color: "var(--text-tertiary)",
  fontWeight: "var(--font-normal)",
};

const directoryEmptyStateStyle = {
  minHeight: "auto",
  padding: "var(--sp-6)",
  gap: 0,
};

const directoryLoadingStateStyle = {
  padding: "var(--sp-8)",
  gap: "var(--sp-2)",
};

const directoryEmptyStateTitleStyle = {
  margin: 0,
  color: "var(--text-tertiary)",
  fontWeight: "var(--font-normal)",
};

const visuallyHiddenTitleStyle = {
  position: "absolute" as const,
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap" as const,
  border: 0,
};

interface DirectoryInfo {
  name: string;
  path: string;
  itemCount?: number;
}

interface BrowseResult {
  currentPath: string;
  parentPath: string | null;
  directories: DirectoryInfo[];
  rootPaths?: string[];
}

function isBrowseResult(value: unknown): value is BrowseResult {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<BrowseResult>;
  return (
    typeof candidate.currentPath === "string" &&
    (typeof candidate.parentPath === "string" || candidate.parentPath === null) &&
    Array.isArray(candidate.directories)
  );
}

function WorktreeListLoadingState({ title }: { title: string }) {
  return (
    <EmptyState
      className="worktree-loading"
      style={worktreeListEmptyStateStyle}
      title={<p style={worktreeListEmptyStateTitleStyle}>{title}</p>}
    />
  );
}

export function WorktreeManagerSurface({
  workspaceId,
  openView,
  onClose,
  desktopPreviewInline = false,
}: WorktreeManagerSurfaceProps) {
  const isMobile = useViewport() === "mobile";
  const t = useTranslation();
  const dispatch = useAtomValue(dispatchCommandAtom);
  const {
    createWorktree,
    currentWorktree,
    list,
    loadWorktrees,
    removeWorktreeByPath,
    suggestedPathForBranch,
    workspacePath,
  } = useWorktreeManagementActions(workspaceId);
  const [view, setView] = useState<WorktreeManagerView>("list");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [branchDraft, setBranchDraft] = useState("");
  const [pathDraft, setPathDraft] = useState("");
  const [pathTouched, setPathTouched] = useState(false);
  const [deleteTargetPath, setDeleteTargetPath] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [browsePath, setBrowsePath] = useState("");
  const [browseParentPath, setBrowseParentPath] = useState<string | null>(null);
  const [browseRootPaths, setBrowseRootPaths] = useState<string[]>(["/"]);
  const [browseDirectories, setBrowseDirectories] = useState<DirectoryInfo[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [selectedDirectoryPath, setSelectedDirectoryPath] = useState<string | null>(null);
  const [browseHomePath, setBrowseHomePath] = useState<string | null>(null);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [createFolderError, setCreateFolderError] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const initializedOpenViewRef = useRef(false);
  const branchInputRef = useRef<HTMLInputElement | null>(null);
  const createFolderInputRef = useRef<HTMLInputElement | null>(null);
  const browseRequestIdRef = useRef(0);

  const resetCreateForm = () => {
    setBranchDraft("");
    setPathDraft("");
    setPathTouched(false);
    setCreateError(null);
    setSelectedDirectoryPath(null);
    setBrowseError(null);
    setIsCreatingFolder(false);
    setNewFolderName("");
    setCreateFolderError(null);
    setCreatingFolder(false);
  };

  const loadBrowseDirectory = useCallback(
    async (path?: string, options?: { useFallback?: boolean }) => {
      if (!workspaceId) {
        return;
      }

      const requestId = browseRequestIdRef.current + 1;
      browseRequestIdRef.current = requestId;
      setBrowseLoading(true);
      setBrowseError(null);

      const fallbackPath =
        browsePath || getAbsolutePathParent(pathDraft.trim()) || pathDraft.trim();
      const requestedPath =
        path ??
        (options?.useFallback === false
          ? undefined
          : fallbackPath && isAbsoluteWorktreePath(fallbackPath)
            ? fallbackPath
            : undefined);

      const result = await dispatch<BrowseResult>("file.browse", {
        workspaceId,
        path: requestedPath,
      });

      if (browseRequestIdRef.current !== requestId) {
        return;
      }

      if (!result.ok || !isBrowseResult(result.data)) {
        setBrowseError(result.error?.message ?? t("workspace.launch.browse_failed"));
        setBrowseLoading(false);
        return;
      }

      setBrowsePath(result.data.currentPath);
      setBrowseParentPath(result.data.parentPath);
      setBrowseDirectories(result.data.directories);
      const nextRootPaths = result.data.rootPaths?.filter(Boolean) ?? ["/"];
      setBrowseRootPaths(nextRootPaths);
      setBrowseHomePath(
        nextRootPaths.find((candidate) => candidate !== "/" && candidate !== "\\") ?? null
      );
      setBrowseLoading(false);
    },
    [browsePath, dispatch, pathDraft, t, workspaceId]
  );

  const updatePathDraft = useCallback((value: string, options?: { markTouched?: boolean }) => {
    if (options?.markTouched !== false) {
      setPathTouched(true);
    }

    setPathDraft(value);
  }, []);

  const getShortPath = useCallback(
    (path: string) => {
      if (browseHomePath && path === browseHomePath) {
        return "~";
      }

      if (browseHomePath && path.startsWith(`${browseHomePath}/`)) {
        return `~${path.slice(browseHomePath.length)}`;
      }

      if (browseHomePath && path.startsWith(`${browseHomePath}\\`)) {
        return `~${path.slice(browseHomePath.length)}`;
      }

      return path;
    },
    [browseHomePath]
  );

  const handleBrowseNavigate = useCallback(
    (path: string) => {
      const currentLeafName = getAbsolutePathName(pathDraft.trim());
      setSelectedDirectoryPath(null);
      setIsCreatingFolder(false);
      setNewFolderName("");
      setCreateFolderError(null);
      setCreatingFolder(false);
      if (currentLeafName) {
        updatePathDraft(joinAbsoluteChildPath(path, currentLeafName), { markTouched: true });
      }
      void loadBrowseDirectory(path);
    },
    [getAbsolutePathName, loadBrowseDirectory, pathDraft, updatePathDraft]
  );

  const handleBrowseSelect = useCallback((path: string) => {
    setSelectedDirectoryPath(path);
    setCreateError(null);
  }, []);

  const openCreateFolder = useCallback(() => {
    setIsCreatingFolder(true);
    setCreateFolderError(null);
  }, []);

  const closeCreateFolder = useCallback(() => {
    browseRequestIdRef.current += 1;
    setIsCreatingFolder(false);
    setNewFolderName("");
    setCreateFolderError(null);
    setCreatingFolder(false);
  }, []);

  const submitCreateFolder = useCallback(async () => {
    const trimmedName = newFolderName.trim();

    if (!trimmedName) {
      setCreateFolderError(t("workspace.launch.folder_name_required"));
      return;
    }

    if (trimmedName.includes("/") || trimmedName.includes("\\")) {
      setCreateFolderError(t("workspace.launch.folder_name_invalid"));
      return;
    }

    if (!browsePath || !isAbsoluteWorktreePath(browsePath)) {
      setCreateFolderError(t("workspace.launch.create_folder_failed"));
      return;
    }

    setCreatingFolder(true);
    setCreateFolderError(null);
    const requestId = browseRequestIdRef.current + 1;
    browseRequestIdRef.current = requestId;

    const createPath = joinAbsoluteChildPath(browsePath, trimmedName);
    const result = await dispatch<{ ok: true }>("file.mkdirAbsolute", {
      workspaceId,
      path: createPath,
    });

    if (browseRequestIdRef.current !== requestId) {
      return;
    }

    if (!result.ok) {
      setCreateFolderError(result.error?.message ?? t("workspace.launch.create_folder_failed"));
      setCreatingFolder(false);
      return;
    }

    const currentLeafName = getAbsolutePathName(pathDraft.trim()) || trimmedName;
    const nextBrowsePath = createPath;
    await loadBrowseDirectory(nextBrowsePath);

    if (browseRequestIdRef.current !== requestId) {
      return;
    }

    setSelectedDirectoryPath(null);
    updatePathDraft(joinAbsoluteChildPath(nextBrowsePath, currentLeafName), { markTouched: true });
    setIsCreatingFolder(false);
    setNewFolderName("");
    setCreateFolderError(null);
    setCreatingFolder(false);
  }, [
    getAbsolutePathName,
    browsePath,
    dispatch,
    loadBrowseDirectory,
    newFolderName,
    pathDraft,
    t,
    updatePathDraft,
    workspaceId,
  ]);

  useEffect(() => {
    if (!openView) {
      initializedOpenViewRef.current = false;
      return;
    }

    if (initializedOpenViewRef.current) {
      return;
    }

    initializedOpenViewRef.current = true;
    setNotice(null);
    setRemoveError(null);
    setDeleteTargetPath(null);
    setSelectedPath(null);

    if (openView === "create") {
      resetCreateForm();
      setView("create");
      const suggestedPath = suggestedPathForBranch(branchDraft);
      const initialBrowsePath =
        getAbsolutePathParent(suggestedPath) ??
        getAbsolutePathParent(workspacePath) ??
        (isAbsoluteWorktreePath(workspacePath) ? workspacePath : undefined);
      void loadBrowseDirectory(initialBrowsePath, { useFallback: false });
    } else {
      setView("list");
    }

    if (!list.lastLoadedAt && !list.loading) {
      void loadWorktrees();
    }
  }, [
    branchDraft,
    list.lastLoadedAt,
    list.loading,
    loadBrowseDirectory,
    loadWorktrees,
    openView,
    suggestedPathForBranch,
    workspacePath,
  ]);

  useEffect(() => {
    if (view !== "create" || pathTouched) {
      return;
    }

    const nextPath = branchDraft.trim() ? suggestedPathForBranch(branchDraft) : "";
    setPathDraft(nextPath);
    setSelectedDirectoryPath(null);
  }, [branchDraft, pathTouched, suggestedPathForBranch, view]);

  useEffect(() => {
    if (!isCreatingFolder) {
      return;
    }

    const input = createFolderInputRef.current;
    if (!input) {
      return;
    }

    const focusInput = () => {
      input.focus();
    };

    focusInput();

    if (document.activeElement === input) {
      return;
    }

    const timeoutId = window.setTimeout(focusInput, 0);
    return () => window.clearTimeout(timeoutId);
  }, [isCreatingFolder]);

  const selected = useMemo(
    () => list.items.find((item) => item.path === selectedPath) ?? null,
    [list.items, selectedPath]
  );
  const deleteTarget = useMemo(
    () => list.items.find((item) => item.path === deleteTargetPath) ?? null,
    [deleteTargetPath, list.items]
  );

  useEffect(() => {
    if (view === "detail" && selectedPath && !selected) {
      setNotice(t("worktree.selection_removed"));
      setSelectedPath(null);
      setView("list");
    }
  }, [selected, selectedPath, t, view]);

  if (!openView) {
    return null;
  }

  const title =
    view === "detail" && selected
      ? selected.name
      : view === "create"
        ? t("worktree.create_title")
        : t("worktree.list_title");

  const canSubmit = branchDraft.trim().length > 0 && isAbsoluteWorktreePath(pathDraft.trim());
  const pathHintId = `worktree-path-hint-${workspaceId}`;
  const branchPlaceholder = t("worktree.create_branch_placeholder");
  const pathPlaceholder =
    suggestedPathForBranch(branchPlaceholder) || t("worktree.create_path_placeholder");
  const createOnlyMode = openView === "create";
  const closeDeleteConfirm = () => {
    setRemoveError(null);
    setDeleteTargetPath(null);
    setView("list");
  };

  const openCreate = () => {
    resetCreateForm();
    setDeleteTargetPath(null);
    setSelectedPath(null);
    setNotice(null);
    setView("create");
    const initialBrowsePath =
      getAbsolutePathParent(workspacePath) ??
      (isAbsoluteWorktreePath(workspacePath) ? workspacePath : undefined);
    void loadBrowseDirectory(initialBrowsePath, { useFallback: false });
  };

  const submitDeleteConfirm = () => {
    if (!deleteTarget) {
      return;
    }

    setRemoveError(null);
    void removeWorktreeByPath(deleteTarget.path, deleteTarget.status === "dirty").then((result) => {
      if (result.ok) {
        closeDeleteConfirm();
        return;
      }

      setRemoveError(result.error);
    });
  };

  const body =
    view === "detail" && selected ? (
      <div className={isMobile ? "mobile-worktree-sheet" : undefined}>
        <WorktreeDetailPanel workspaceId={workspaceId} worktree={selected} mobile={isMobile} />
      </div>
    ) : view === "create" ? (
      <form
        className="worktree-manager__form"
        onSubmit={(event) => {
          event.preventDefault();
          setCreateError(null);
          void createWorktree(branchDraft.trim(), pathDraft.trim()).then((result) => {
            if (result.ok) {
              resetCreateForm();
              if (createOnlyMode) {
                onClose();
              } else {
                setView("list");
              }
              return;
            }

            setCreateError(result.error);
          });
        }}
      >
        {createError ? <div className="worktree-error">{createError}</div> : null}

        <div className="worktree-manager__field">
          <label
            className="worktree-manager__field-label"
            htmlFor={`worktree-branch-${workspaceId}`}
          >
            {t("worktree.branch")}
          </label>
          <Input
            id={`worktree-branch-${workspaceId}`}
            ref={branchInputRef}
            value={branchDraft}
            onChange={(event) => setBranchDraft(event.target.value)}
            placeholder={branchPlaceholder}
            autoFocus
          />
        </div>

        <div className="worktree-manager__field">
          <label className="worktree-manager__field-label" htmlFor={`worktree-path-${workspaceId}`}>
            {t("worktree.path")}
          </label>
          <Input
            id={`worktree-path-${workspaceId}`}
            value={pathDraft}
            onChange={(event) => {
              updatePathDraft(event.target.value);
            }}
            placeholder={pathPlaceholder}
            aria-describedby={pathHintId}
          />
          <span id={pathHintId} className="worktree-manager__field-hint">
            {t("worktree.create_path_hint")}
          </span>
        </div>

        <div className="folder-picker">
          <div className="fp-toolbar">
            <button className="fp-btn" type="button" onClick={() => void loadBrowseDirectory()}>
              {t("action.refresh")}
            </button>
            {browseParentPath ? (
              <button
                className="fp-btn"
                type="button"
                onClick={() => handleBrowseNavigate(browseParentPath)}
              >
                <ArrowUp size={12} />
                {t("workspace.launch.go_up")}
              </button>
            ) : null}
            <button className="fp-btn" type="button" onClick={openCreateFolder}>
              {t("workspace.launch.new_folder")}
            </button>
          </div>

          <div className="fp-root-chips">
            {browseRootPaths.map((rootPath) => (
              <span
                key={rootPath}
                className={`fp-chip ${browsePath === rootPath ? "active" : ""}`}
                onClick={() => handleBrowseNavigate(rootPath)}
              >
                {getShortPath(rootPath)}
              </span>
            ))}
            {browsePath && !browseRootPaths.includes(browsePath) ? (
              <span className="fp-chip active">{getShortPath(browsePath)}</span>
            ) : null}
          </div>

          {isCreatingFolder ? (
            <div className="fp-create-folder">
              <Input
                ref={createFolderInputRef}
                aria-label={t("workspace.launch.folder_name_label")}
                className="fp-create-folder__input"
                disabled={creatingFolder}
                invalid={Boolean(createFolderError)}
                onChange={(event) => setNewFolderName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void submitCreateFolder();
                    return;
                  }

                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    closeCreateFolder();
                  }
                }}
                placeholder={t("workspace.launch.new_folder_placeholder")}
                value={newFolderName}
              />
              <button
                className="fp-create-folder__action"
                type="button"
                onClick={() => void submitCreateFolder()}
                disabled={creatingFolder}
              >
                {creatingFolder
                  ? t("workspace.launch.creating_folder")
                  : t("workspace.launch.create_folder")}
              </button>
              <button
                className="fp-create-folder__cancel"
                type="button"
                onClick={closeCreateFolder}
                disabled={creatingFolder}
              >
                {t("workspace.launch.create_folder_cancel")}
              </button>
              {createFolderError ? <div className="form-error">{createFolderError}</div> : null}
            </div>
          ) : null}

          <div className="fp-dir-list">
            {browseLoading ? (
              <EmptyState
                className="directory-loading"
                icon={<Spinner label={t("common.loading")} />}
                style={directoryLoadingStateStyle}
                title={<span style={visuallyHiddenTitleStyle}>{t("common.loading")}</span>}
              />
            ) : browseDirectories.length === 0 ? (
              <EmptyState
                className="directory-empty"
                style={directoryEmptyStateStyle}
                title={
                  <p style={directoryEmptyStateTitleStyle}>
                    {t("workspace.launch.no_directories")}
                  </p>
                }
              />
            ) : (
              browseDirectories.map((dir) => {
                const isSelected = selectedDirectoryPath === dir.path;
                return (
                  <div
                    key={dir.path}
                    className={`fp-dir ${isSelected ? "selected" : ""}`}
                    onClick={() => handleBrowseSelect(dir.path)}
                    onDoubleClick={() => handleBrowseNavigate(dir.path)}
                  >
                    <span className="fp-dir-icon">
                      <ThemedIcon semantic="file.folder.closed" size={14} />
                    </span>
                    <span className={`fp-dir-name ${isSelected ? "selected" : ""}`}>
                      {dir.name}
                    </span>
                    {dir.itemCount !== undefined ? (
                      <span className="fp-dir-hint">
                        {t("workspace.launch.items_count", { count: dir.itemCount })}
                      </span>
                    ) : null}
                    {isSelected ? (
                      <button
                        className="fp-dir-action"
                        type="button"
                        aria-label={t("worktree.use_as_parent", { name: dir.name })}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleBrowseNavigate(dir.path);
                        }}
                      >
                        {t("worktree.use_as_parent")}
                      </button>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {browseError ? <div className="form-error">{browseError}</div> : null}

        <div className="worktree-manager__form-actions">
          <Button
            variant="secondary"
            onClick={() => {
              if (createOnlyMode) {
                onClose();
              } else {
                setView("list");
              }
            }}
          >
            {t("action.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={!canSubmit}>
            {t("worktree.create_submit")}
          </Button>
        </div>
      </form>
    ) : view === "confirm-delete" && deleteTarget ? (
      <div className="worktree-manager__confirm">
        {removeError ? <div className="worktree-error">{removeError}</div> : null}
        <p>
          {deleteTarget.status === "dirty"
            ? t("worktree.remove_force_confirm")
            : t("worktree.remove_confirm")}
        </p>
        <code className="worktree-manager__confirm-path">{deleteTarget.path}</code>
        <div className="worktree-manager__confirm-actions">
          <Button variant="secondary" onClick={closeDeleteConfirm}>
            {t("action.cancel")}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              submitDeleteConfirm();
            }}
          >
            {deleteTarget.status === "dirty" ? t("worktree.force_remove") : t("common.delete")}
          </Button>
        </div>
      </div>
    ) : (
      <div className="worktree-manager__list">
        {notice ? <div className="worktree-error">{notice}</div> : null}
        {list.error ? (
          <div className="worktree-error">
            <div>{list.error}</div>
            <Button variant="secondary" size="sm" onClick={() => void loadWorktrees()}>
              {t("action.refresh")}
            </Button>
          </div>
        ) : null}
        {list.loading && list.items.length === 0 ? (
          <WorktreeListLoadingState title={t("worktree.loading")} />
        ) : list.error && list.items.length === 0 ? null : list.items.length === 0 ? (
          <EmptyState
            className="worktree-empty"
            style={worktreeListEmptyStateStyle}
            title={<p style={worktreeListEmptyStateTitleStyle}>{t("worktree.list_empty")}</p>}
          />
        ) : (
          list.items.map((item, index) => {
            const isCurrent = currentWorktree?.path === item.path;
            // git worktree list returns the primary worktree first.
            const isMainWorktree = index === 0;

            return (
              <div key={item.path} className="worktree-manager__row">
                <button
                  type="button"
                  className="worktree-manager__row-main"
                  onClick={() => {
                    setNotice(null);
                    setSelectedPath(item.path);
                    setView("detail");
                  }}
                >
                  <span className="worktree-manager__row-name">{item.name}</span>
                  <div className="worktree-manager__meta">
                    <span className="worktree-chip worktree-chip-branch">🌿 {item.branch}</span>
                    <span
                      className={`worktree-chip worktree-chip-status ${
                        item.status === "clean" ? "worktree-clean" : "worktree-dirty"
                      }`}
                    >
                      {item.status === "clean" ? t("worktree.clean") : t("worktree.dirty_status")}
                    </span>
                    {isCurrent ? (
                      <span className="worktree-chip">{t("worktree.current")}</span>
                    ) : null}
                  </div>
                  <span className="worktree-manager__row-path">{item.path}</span>
                </button>

                {!isCurrent && !isMainWorktree ? (
                  <Button
                    aria-label={t("worktree.remove_row_label", { name: item.name })}
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setRemoveError(null);
                      setDeleteTargetPath(item.path);
                      setView("confirm-delete");
                    }}
                  >
                    {t("common.delete")}
                  </Button>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    );

  if (!isMobile && view === "confirm-delete" && deleteTarget) {
    return (
      <ConfirmDialog
        open
        className="worktree-manager-surface"
        title={t("common.delete")}
        description={
          <div className="worktree-manager__confirm">
            {removeError ? <div className="worktree-error">{removeError}</div> : null}
            <p>
              {deleteTarget.status === "dirty"
                ? t("worktree.remove_force_confirm")
                : t("worktree.remove_confirm")}
            </p>
            <code className="worktree-manager__confirm-path">{deleteTarget.path}</code>
          </div>
        }
        cancelText={t("action.cancel")}
        closeLabel={t("action.close")}
        confirmText={
          deleteTarget.status === "dirty" ? t("worktree.force_remove") : t("common.delete")
        }
        onOpenChange={(open) => {
          if (!open) {
            closeDeleteConfirm();
          }
        }}
        onConfirm={submitDeleteConfirm}
        tone="danger"
      />
    );
  }

  if (isMobile) {
    return (
      <Sheet
        kicker={t("worktree.title").toUpperCase()}
        title={title}
        body={<div className="worktree-manager-surface">{body}</div>}
        bodyClassName="mobile-sheet__body--flush"
        contentClassName="mobile-sheet--worktree"
        onBack={
          view === "list"
            ? undefined
            : () => {
                if (createOnlyMode) {
                  onClose();
                } else {
                  setView("list");
                }
              }
        }
        headerAction={
          view === "list" ? (
            <Button size="sm" variant="primary" onClick={openCreate}>
              {t("worktree.new")}
            </Button>
          ) : undefined
        }
        onClose={onClose}
      />
    );
  }

  if (desktopPreviewInline) {
    return (
      <div className="drawer-panel worktree-manager-surface worktree-manager-surface--inline-preview">
        <div className="drawer-header">
          <div className="worktree-header-info">
            <h2 className="drawer-title">{title}</h2>
          </div>
          <div className="worktree-manager-surface__header-actions">
            {view === "list" ? (
              <Button size="sm" variant="primary" onClick={openCreate}>
                {t("worktree.new")}
              </Button>
            ) : createOnlyMode ? null : (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (createOnlyMode) {
                    onClose();
                  } else {
                    setView("list");
                  }
                }}
              >
                {t("action.back")}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onClose}>
              {t("action.close")}
            </Button>
          </div>
        </div>

        <div className="drawer-body">{body}</div>
      </div>
    );
  }

  return (
    <Modal
      className="worktree-manager-surface"
      dismissible={false}
      initialFocus={() => (view === "create" ? branchInputRef.current : null)}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open
      size="lg"
    >
      <ModalHeader>
        <ModalTitle>{title}</ModalTitle>
        <div className="worktree-manager-surface__header-actions">
          {view === "list" ? (
            <Button size="sm" variant="primary" onClick={openCreate}>
              {t("worktree.new")}
            </Button>
          ) : createOnlyMode ? null : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (createOnlyMode) {
                  onClose();
                } else {
                  setView("list");
                }
              }}
            >
              {t("action.back")}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onClose}>
            {t("action.close")}
          </Button>
        </div>
      </ModalHeader>
      <ModalBody>{body}</ModalBody>
    </Modal>
  );
}
