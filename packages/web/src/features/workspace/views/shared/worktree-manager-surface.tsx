import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  Input,
  Modal,
  ModalHeader,
  ModalTitle,
  Sheet,
} from "../../../../components/ui";
import { useViewport } from "../../../../hooks/use-viewport";
import { useTranslation } from "../../../../lib/i18n";
import { useWorktreeManagementActions } from "../../actions/use-worktree-management-actions";
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
  const {
    createWorktree,
    currentWorktree,
    list,
    loadWorktrees,
    removeWorktreeByPath,
    suggestedPathForBranch,
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
  const initializedOpenViewRef = useRef(false);
  const branchInputRef = useRef<HTMLInputElement | null>(null);

  const resetCreateForm = () => {
    setBranchDraft("");
    setPathDraft("");
    setPathTouched(false);
    setCreateError(null);
  };

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
    } else {
      setView("list");
    }

    if (!list.lastLoadedAt && !list.loading) {
      void loadWorktrees();
    }
  }, [list.lastLoadedAt, list.loading, loadWorktrees, openView]);

  useEffect(() => {
    if (view !== "create" || pathTouched) {
      return;
    }

    setPathDraft(branchDraft.trim() ? suggestedPathForBranch(branchDraft) : "");
  }, [branchDraft, pathTouched, suggestedPathForBranch, view]);

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

  const canSubmit =
    branchDraft.trim().length > 0 && /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(pathDraft.trim());
  const pathHintId = `worktree-path-hint-${workspaceId}`;
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
              setView("list");
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
            placeholder="feature/worktree-manager"
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
              setPathTouched(true);
              setPathDraft(event.target.value);
            }}
            placeholder="/home/spencer/workspace/coder-studio-feature-worktree-manager"
            aria-describedby={pathHintId}
          />
          <span id={pathHintId} className="worktree-manager__field-hint">
            {t("worktree.create_path_hint")}
          </span>
        </div>

        <div className="worktree-manager__form-actions">
          <Button variant="secondary" onClick={() => setView("list")}>
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
        onBack={view === "list" ? undefined : () => setView("list")}
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
      <div className="modal-card modal-card-lg worktree-manager-surface worktree-manager-surface--inline-preview">
        <ModalHeader>
          <div className="worktree-header-info">
            <ModalTitle>{title}</ModalTitle>
          </div>
          <div className="worktree-manager-surface__header-actions">
            {view === "list" ? (
              <Button size="sm" variant="primary" onClick={openCreate}>
                {t("worktree.new")}
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setView("list")}>
                {t("action.back")}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onClose}>
              {t("action.close")}
            </Button>
          </div>
        </ModalHeader>

        <div className="modal-body">{body}</div>
      </div>
    );
  }

  return (
    <Modal
      className="worktree-manager-surface"
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
        <div className="worktree-header-info">
          <ModalTitle>{title}</ModalTitle>
        </div>
        <div className="worktree-manager-surface__header-actions">
          {view === "list" ? (
            <Button size="sm" variant="primary" onClick={openCreate}>
              {t("worktree.new")}
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setView("list")}>
              {t("action.back")}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onClose}>
            {t("action.close")}
          </Button>
        </div>
      </ModalHeader>

      {body}
    </Modal>
  );
}
