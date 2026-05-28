import type { GitCommitSummary, GitFileChange, WorktreeInfo } from "@coder-studio/core";
import { atom, useAtom, useAtomValue } from "jotai";
import { atomFamily } from "jotai-family";
import { ChevronDown, ChevronRight, Minus, Plus, RotateCcw, Trash2 } from "lucide-react";
import type { FC, MouseEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef } from "react";
import { localeAtom } from "../../../../atoms/app-ui";
import {
  ConfirmDialog,
  EmptyState,
  IconButton,
  Textarea,
  ThemedIcon,
  Tooltip,
} from "../../../../components/ui";
import { formatRelativeTime, useTranslation } from "../../../../lib/i18n";
import {
  type GitChangeType,
  type GitPanelChangeItem,
  useGitPanelActions,
} from "../../actions/use-git-actions";
import { useWorktreeManagementActions } from "../../actions/use-worktree-management-actions";
import type { GitDiffPreview } from "../../atoms";
import { getFileNodeSemantic } from "./file-tree-icon-semantics";
import { WorktreeManagerSurface } from "./worktree-manager-surface";

const gitPanelEmptyStateStyle = {
  minHeight: "auto",
  padding: "12px 0",
  gap: "4px",
};

const gitPanelEmptyStateTitleStyle = {
  margin: 0,
  color: "var(--text-tertiary)",
  fontSize: "inherit",
  fontWeight: "var(--font-normal)",
};

interface GitPanelEmptyStateProps {
  title: string;
  action?: ReactNode;
}

function GitPanelEmptyState({ title, action }: GitPanelEmptyStateProps) {
  return (
    <EmptyState
      action={action}
      className="git-panel-empty"
      style={gitPanelEmptyStateStyle}
      title={<p style={gitPanelEmptyStateTitleStyle}>{title}</p>}
    />
  );
}

interface GitPanelProps {
  workspaceId: string;
  refreshToken?: number;
  onPreviewOpen?: (preview: GitDiffPreview) => void;
  toolbarAction?: {
    action: "refresh" | "stage-all" | "unstage-all" | "discard-all" | "commit";
    nonce: number;
  } | null;
  variant?: "desktop" | "mobile";
}

interface GitPanelState {
  pendingWorktreeDeletePath: string | null;
  worktreeSurfaceView: "create" | null;
  commitExpanded: boolean;
  worktreesExpanded: boolean;
  historyExpanded: boolean;
}

function createInitialGitPanelState(): GitPanelState {
  return {
    pendingWorktreeDeletePath: null,
    worktreeSurfaceView: null,
    commitExpanded: true,
    worktreesExpanded: false,
    historyExpanded: false,
  };
}

function getGitPanelStateKey(workspaceId: string, variant: "desktop" | "mobile"): string {
  return `${workspaceId}::${variant}`;
}

const gitPanelStateAtomFamily = atomFamily((_stateKey: string) =>
  atom<GitPanelState>(createInitialGitPanelState())
);

export const GitPanel: FC<GitPanelProps> = ({
  workspaceId,
  refreshToken = 0,
  onPreviewOpen,
  toolbarAction = null,
  variant = "desktop",
}) => {
  const isMobile = variant === "mobile";
  const [panelState, setPanelState] = useAtom(
    gitPanelStateAtomFamily(getGitPanelStateKey(workspaceId, variant))
  );
  const locale = useAtomValue(localeAtom) === "zh" ? "zh" : "en";
  const t = useTranslation();
  const {
    commitMessage,
    diffPreview,
    gitState,
    groups,
    history,
    historyLoading,
    isLoading,
    pendingDiscard,
    setCommitMessage,
    handleCancelDiscard,
    handleCommit,
    handleDiscardAll,
    handleConfirmDiscard,
    handleRequestDiscardSingle,
    handleStageAll,
    handleUnstageAll,
    loadGitStatus,
    openHistoryDiff,
    openDiff,
    runGitMutation,
  } = useGitPanelActions({
    workspaceId,
    refreshToken,
    onPreviewOpen,
    initialHistoryLimit: 20,
  });
  const { currentWorktree, hasWorkspace, list, loadWorktrees, openWorktree, removeWorktreeByPath } =
    useWorktreeManagementActions(workspaceId);
  const worktreeAutoLoadAttemptedRef = useRef(false);
  const {
    commitExpanded,
    historyExpanded,
    pendingWorktreeDeletePath,
    worktreeSurfaceView,
    worktreesExpanded,
  } = panelState;
  const pendingWorktreeDelete = useMemo(
    () => list.items.find((item) => item.path === pendingWorktreeDeletePath) ?? null,
    [list.items, pendingWorktreeDeletePath]
  );
  const totalChangeCount = groups.reduce((count, group) => count + group.changes.length, 0);
  const commitSectionLabel = commitExpanded
    ? t("git.commit_collapse_label")
    : t("git.commit_expand_label");
  const worktreesSectionLabel = `${t("worktree.list_title")}${list.items.length}`;
  const historySectionLabel = `${t("git.history")}${history.length}`;

  useEffect(() => {
    worktreeAutoLoadAttemptedRef.current = false;
  }, [workspaceId]);

  useEffect(() => {
    if (!hasWorkspace) {
      worktreeAutoLoadAttemptedRef.current = false;
      return;
    }

    if (list.lastLoadedAt || list.loading || worktreeAutoLoadAttemptedRef.current) {
      return;
    }

    worktreeAutoLoadAttemptedRef.current = true;
    void loadWorktrees();
  }, [hasWorkspace, list.lastLoadedAt, list.loading, loadWorktrees]);

  const stagedCount = gitState?.staged.length ?? 0;
  const canCommit = Boolean(commitMessage.trim()) && stagedCount > 0;
  const shouldRenderWorktreeSection =
    hasWorkspace ||
    list.items.length > 0 ||
    list.loading ||
    list.error != null ||
    worktreeSurfaceView === "create" ||
    pendingWorktreeDelete !== null;
  const showWorktreeCount = !isMobile || list.items.length > 0;
  const showHistoryCount = !isMobile || history.length > 0;

  useEffect(() => {
    if (!toolbarAction || variant !== "desktop") {
      return;
    }

    switch (toolbarAction.action) {
      case "refresh":
        void loadGitStatus();
        break;
      case "stage-all":
        void handleStageAll();
        break;
      case "unstage-all":
        void handleUnstageAll();
        break;
      case "discard-all":
        handleDiscardAll();
        break;
      case "commit":
        void handleCommit();
        break;
    }
  }, [
    handleCommit,
    handleDiscardAll,
    handleStageAll,
    handleUnstageAll,
    loadGitStatus,
    toolbarAction,
    variant,
  ]);

  const handleWorktreeOpen = async (worktree: WorktreeInfo) => {
    if (currentWorktree?.path === worktree.path) {
      return;
    }

    await openWorktree(worktree.path);
  };

  const closePendingWorktreeDelete = () => {
    setPanelState((current) => ({
      ...current,
      pendingWorktreeDeletePath: null,
    }));
  };

  return (
    <>
      <div className={`git-panel git-panel--${variant}`}>
        <div className="git-panel-scroll">
          <section className="git-panel-section git-commit-block">
            <div className="git-panel-section-header">
              <button
                type="button"
                className="git-panel-section-toggle"
                onClick={() =>
                  setPanelState((current) => ({
                    ...current,
                    commitExpanded: !current.commitExpanded,
                  }))
                }
                aria-expanded={commitExpanded}
                aria-label={commitSectionLabel}
              >
                <span className="git-panel-section-chevron">
                  {commitExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </span>
                <span>{t("git.commit")}</span>
              </button>
              <div className="git-panel-section-actions git-commit-actions">
                <Tooltip content={canCommit ? t("git.commit") : t("git.nothing_staged")}>
                  <button
                    className="git-commit-primary"
                    onClick={() => void handleCommit()}
                    disabled={!canCommit}
                    type="button"
                  >
                    <span>{t("git.commit")}</span>
                    <ThemedIcon semantic="git.commit" size={14} />
                  </button>
                </Tooltip>
              </div>
            </div>

            {commitExpanded ? (
              <div className="git-panel-section-body git-commit-body">
                <Textarea
                  className="git-commit-input"
                  placeholder={t("git.commit_summary_placeholder")}
                  value={commitMessage}
                  onChange={(event) => setCommitMessage(event.target.value)}
                  rows={isMobile ? 3 : 1}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                      event.preventDefault();
                      void handleCommit();
                    }
                  }}
                />
              </div>
            ) : null}
          </section>

          {shouldRenderWorktreeSection ? (
            <section className="git-panel-section">
              <div className="git-panel-section-header">
                <button
                  type="button"
                  className="git-panel-section-toggle"
                  onClick={() =>
                    setPanelState((current) => ({
                      ...current,
                      worktreesExpanded: !current.worktreesExpanded,
                    }))
                  }
                  aria-expanded={worktreesExpanded}
                  aria-label={worktreesSectionLabel}
                >
                  <span className="git-panel-section-chevron">
                    {worktreesExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </span>
                  <span>{t("worktree.list_title")}</span>
                  {showWorktreeCount ? (
                    <span className="git-panel-section-count">{list.items.length}</span>
                  ) : null}
                </button>
                <button
                  type="button"
                  className="git-panel-section-link"
                  onClick={() =>
                    setPanelState((current) => ({
                      ...current,
                      worktreeSurfaceView: "create",
                    }))
                  }
                >
                  <ThemedIcon semantic="worktree.action.new" size={12} />
                  <span>{t("worktree.new")}</span>
                </button>
              </div>

              {worktreesExpanded ? (
                <div className="git-panel-section-body">
                  {list.loading && list.items.length === 0 ? (
                    <GitPanelEmptyState title={t("worktree.loading")} />
                  ) : list.error ? (
                    <GitPanelEmptyState
                      action={
                        <button
                          type="button"
                          className="git-panel-section-link"
                          onClick={() => void loadWorktrees()}
                        >
                          {t("action.refresh")}
                        </button>
                      }
                      title={list.error}
                    />
                  ) : list.items.length === 0 ? (
                    <GitPanelEmptyState title={t("worktree.list_empty")} />
                  ) : (
                    list.items.map((worktree, index) => {
                      const isCurrent = currentWorktree?.path === worktree.path;
                      const isPrimary = index === 0;
                      const isRemovable = !isCurrent && !isPrimary;

                      return (
                        <div
                          key={worktree.path}
                          className={`git-worktree-row ${isCurrent ? "active" : ""}`}
                        >
                          <button
                            type="button"
                            className={`git-worktree-row__main workspace-sidebar-row ${
                              isCurrent ? "workspace-sidebar-row--selected" : ""
                            }`}
                            onClick={() => void handleWorktreeOpen(worktree)}
                          >
                            <span
                              className={`git-worktree-row__dot git-worktree-row__dot-${worktree.status}`}
                              aria-hidden="true"
                            />
                            <span className="git-worktree-row__name">{worktree.name}</span>
                            <span className="git-worktree-row__tail">
                              <span className="git-worktree-row__status">
                                {worktree.status === "clean"
                                  ? t("worktree.clean")
                                  : t("worktree.dirty_status")}
                              </span>
                              {isCurrent ? (
                                <span className="git-worktree-row__chip">
                                  {t("worktree.current")}
                                </span>
                              ) : null}
                            </span>
                          </button>
                          {isRemovable ? (
                            <IconButton
                              aria-label={t("worktree.remove_row_label", { name: worktree.name })}
                              className="git-worktree-row__delete"
                              icon={<Trash2 size={12} />}
                              onClick={() =>
                                setPanelState((current) => ({
                                  ...current,
                                  pendingWorktreeDeletePath: worktree.path,
                                }))
                              }
                              size="sm"
                              variant="ghost"
                            />
                          ) : null}
                        </div>
                      );
                    })
                  )}
                </div>
              ) : null}
            </section>
          ) : null}

          <GitChangesSection
            groups={groups}
            totalCount={totalChangeCount}
            isLoading={isLoading}
            mobile={isMobile}
            selectedPath={diffPreview?.path ?? null}
            onStageAll={handleStageAll}
            onUnstageAll={handleUnstageAll}
            onDiscardAll={handleDiscardAll}
            onViewDiff={openDiff}
            onRunMutation={runGitMutation}
            onRequestDiscard={handleRequestDiscardSingle}
            workspaceId={workspaceId}
          />

          <section className="git-panel-section git-panel-section-history">
            <div className="git-panel-section-header">
              <button
                type="button"
                className="git-panel-section-toggle"
                onClick={() =>
                  setPanelState((current) => ({
                    ...current,
                    historyExpanded: !current.historyExpanded,
                  }))
                }
                aria-expanded={historyExpanded}
                aria-label={historySectionLabel}
              >
                <span className="git-panel-section-chevron">
                  {historyExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </span>
                <span>{t("git.history")}</span>
                {showHistoryCount ? (
                  <span className="git-panel-section-count">{history.length}</span>
                ) : null}
              </button>
            </div>

            {historyExpanded ? (
              <div className="git-panel-section-body">
                {historyLoading && history.length === 0 ? (
                  <GitPanelEmptyState title={t("common.loading")} />
                ) : history.length === 0 ? (
                  <GitPanelEmptyState title={t("git.no_commits")} />
                ) : (
                  history.map((entry, index) => (
                    <GitHistoryRow
                      key={entry.sha}
                      entry={entry}
                      isCurrent={index === 0}
                      locale={locale}
                      onOpen={openHistoryDiff}
                    />
                  ))
                )}
              </div>
            ) : null}
          </section>
        </div>
      </div>

      <WorktreeManagerSurface
        workspaceId={workspaceId}
        openView={worktreeSurfaceView}
        onClose={() =>
          setPanelState((current) => ({
            ...current,
            pendingWorktreeDeletePath: null,
            worktreeSurfaceView: null,
          }))
        }
      />

      {pendingWorktreeDelete ? (
        <ConfirmDialog
          open
          title={t("common.delete")}
          description={
            <>
              <p>
                {pendingWorktreeDelete.status === "dirty"
                  ? t("worktree.remove_force_confirm")
                  : t("worktree.remove_confirm")}
              </p>
              <code className="worktree-manager__confirm-path">{pendingWorktreeDelete.path}</code>
            </>
          }
          cancelText={t("action.cancel")}
          closeLabel={t("action.close")}
          confirmText={
            pendingWorktreeDelete.status === "dirty"
              ? t("worktree.force_remove")
              : t("common.delete")
          }
          onOpenChange={(open) => {
            if (!open) {
              closePendingWorktreeDelete();
            }
          }}
          onConfirm={() => {
            void removeWorktreeByPath(
              pendingWorktreeDelete.path,
              pendingWorktreeDelete.status === "dirty"
            ).then((result) => {
              if (result.ok) {
                closePendingWorktreeDelete();
              }
            });
          }}
          tone="danger"
        />
      ) : null}

      <GitDiscardConfirmModal
        discard={pendingDiscard}
        onCancel={handleCancelDiscard}
        onConfirm={handleConfirmDiscard}
      />
    </>
  );
};

interface GitChangesSectionProps {
  groups: Array<{ title: string; changes: GitPanelChangeItem[] }>;
  totalCount: number;
  isLoading: boolean;
  mobile: boolean;
  selectedPath: string | null;
  workspaceId: string;
  onDiscardAll: () => void;
  onRequestDiscard: (path: string) => void;
  onRunMutation: (
    op: "git.stage" | "git.unstage" | "git.discard" | "git.commit",
    args: Record<string, unknown>,
    errorMessage: string,
    errorTitle: string,
    afterSuccess?: () => void
  ) => Promise<boolean>;
  onStageAll: () => Promise<void>;
  onUnstageAll: () => Promise<void>;
  onViewDiff: (change: GitFileChange, type: GitChangeType) => Promise<void>;
}

const GitChangesSection: FC<GitChangesSectionProps> = ({
  groups,
  totalCount,
  isLoading,
  mobile,
  selectedPath,
  workspaceId,
  onDiscardAll,
  onRequestDiscard,
  onRunMutation,
  onStageAll,
  onUnstageAll,
  onViewDiff,
}) => {
  const t = useTranslation();
  const hasStaged = groups.some((group) => group.title === "staged" && group.changes.length > 0);
  const hasUnstaged = groups.some((group) => group.title === "changes" && group.changes.length > 0);
  const changes = groups.flatMap((group) => group.changes);

  return (
    <section className="git-panel-section git-panel-section-changes">
      <div className="git-panel-section-header">
        <div className="git-panel-section-toggle git-panel-section-toggle-static">
          <span className="git-panel-section-chevron expanded" aria-hidden="true">
            <ChevronDown size={14} />
          </span>
          <span>{t("git.changes")}</span>
          <span className="git-panel-section-count">{totalCount}</span>
        </div>
        <div className="git-panel-section-actions">
          {hasStaged ? (
            <Tooltip content={t("git.unstage_all")}>
              <button
                type="button"
                className="git-panel-section-link"
                onClick={() => void onUnstageAll()}
              >
                {t("git.unstage_all")}
              </button>
            </Tooltip>
          ) : null}
          {hasUnstaged ? (
            <Tooltip content={t("git.stage_all")}>
              <button
                type="button"
                className="git-panel-section-link"
                onClick={() => void onStageAll()}
              >
                {t("git.stage_all")}
              </button>
            </Tooltip>
          ) : null}
          {totalCount > 0 ? (
            <Tooltip content={t("git.discard_all")}>
              <button type="button" className="git-panel-section-link" onClick={onDiscardAll}>
                {t("git.discard_all")}
              </button>
            </Tooltip>
          ) : null}
        </div>
      </div>

      <div className="git-panel-section-body git-panel-section-body--changes">
        {totalCount === 0 ? (
          <GitPanelEmptyState title={isLoading ? t("common.loading") : t("git.no_changes")} />
        ) : (
          changes.map(({ change, type }) => (
            <GitChangeRow
              key={`${type}:${change.path}`}
              change={change}
              type={type}
              mobile={mobile}
              workspaceId={workspaceId}
              selected={selectedPath === change.path}
              onViewDiff={onViewDiff}
              onRunMutation={onRunMutation}
              onRequestDiscard={onRequestDiscard}
            />
          ))
        )}
      </div>
    </section>
  );
};

interface GitChangeRowProps {
  change: GitFileChange;
  type: GitChangeType;
  mobile: boolean;
  workspaceId: string;
  selected: boolean;
  onViewDiff: (change: GitFileChange, type: GitChangeType) => Promise<void>;
  onRunMutation: (
    op: "git.stage" | "git.unstage" | "git.discard" | "git.commit",
    args: Record<string, unknown>,
    errorMessage: string,
    errorTitle: string,
    afterSuccess?: () => void
  ) => Promise<boolean>;
  onRequestDiscard: (path: string) => void;
}

const GitChangeRow: FC<GitChangeRowProps> = ({
  change,
  type,
  mobile,
  workspaceId,
  selected,
  onViewDiff,
  onRunMutation,
  onRequestDiscard,
}) => {
  const t = useTranslation();
  const pathParts = useMemo(() => change.path.split("/"), [change.path]);
  const fileName = pathParts[pathParts.length - 1] ?? change.path;
  const rawDirName = pathParts.length > 1 ? pathParts.slice(0, -1).join("/") : "";
  const dirName = rawDirName ? `${rawDirName}/` : "";
  const compactDirName =
    rawDirName.length > 14 ? `${rawDirName.split("/").slice(0, 2).join("/")}/…` : dirName;
  const toggleStageLabel = type === "staged" ? t("git.unstage") : t("git.stage");
  const discardLabel = t("git.discard");
  const toggleStageIcon = type === "staged" ? <Minus size={12} /> : <Plus size={12} />;
  const fileSemantic = getFileNodeSemantic(
    {
      kind: "file",
      name: fileName,
      path: change.path,
    },
    false
  );
  const statusSemantic = getChangeSemantic(change, type);
  const status = getResolvedChangeStatus(change, type);
  const badgeClass = type === "staged" ? "staged" : getStatusBadgeClass(status);
  const badgeLabel = getStatusBadgeLabel(status, type);

  const handleToggleStage = async () => {
    if (type === "staged") {
      await onRunMutation(
        "git.unstage",
        { workspaceId, paths: [change.path] },
        "Failed to unstage:",
        t("git.unstage_failed_title")
      );
      return;
    }

    await onRunMutation(
      "git.stage",
      { workspaceId, paths: [change.path] },
      "Failed to stage:",
      t("git.stage_failed_title")
    );
  };

  const handleToggleStageClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    void handleToggleStage();
  };

  const handleDiscardClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onRequestDiscard(change.path);
  };

  return (
    <div
      className={`git-row workspace-sidebar-row ${selected ? "active workspace-sidebar-row--selected" : ""} ${
        mobile ? "mobile" : ""
      }`}
      onClick={() => void onViewDiff(change, type)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          void onViewDiff(change, type);
        }
      }}
    >
      <span className="git-row-icon" aria-hidden="true">
        <ThemedIcon semantic={fileSemantic} size={13} />
      </span>

      <span className="git-row-status-icon" aria-hidden="true">
        <ThemedIcon semantic={statusSemantic} size={13} />
      </span>

      <div className="git-row-content">
        <span className="git-row-name">{fileName}</span>
        <span className="git-row-meta">
          {compactDirName ? <span className="git-row-dir">{compactDirName}</span> : null}
          {change.oldPath ? <span className="git-row-rename">{change.oldPath}</span> : null}
        </span>
      </div>

      <span className={`git-status-badge ${badgeClass}`} aria-hidden="true">
        {badgeLabel}
      </span>

      <div className="git-row-actions">
        <Tooltip content={toggleStageLabel}>
          <IconButton
            aria-label={toggleStageLabel}
            className="git-row-action"
            icon={toggleStageIcon}
            onClick={handleToggleStageClick}
            size="sm"
            type="button"
            variant="ghost"
          />
        </Tooltip>

        <Tooltip content={discardLabel}>
          <IconButton
            aria-label={discardLabel}
            className="git-row-action"
            icon={<RotateCcw size={12} />}
            onClick={handleDiscardClick}
            size="sm"
            type="button"
            variant="ghost"
          />
        </Tooltip>
      </div>
    </div>
  );
};

function GitHistoryRow({
  entry,
  isCurrent,
  locale,
  onOpen,
}: {
  entry: GitCommitSummary;
  isCurrent: boolean;
  locale: "zh" | "en";
  onOpen: (entry: GitCommitSummary) => Promise<GitDiffPreview | null>;
}) {
  return (
    <button
      type="button"
      className={`git-history-row workspace-sidebar-row ${
        isCurrent ? "current workspace-sidebar-row--selected" : ""
      }`}
      onClick={() => void onOpen(entry)}
    >
      <span className="git-history-row__dot" aria-hidden="true" />
      <div className="git-history-row__copy">
        <Tooltip content={entry.subject}>
          <span className="git-history-row__title">{entry.subject}</span>
        </Tooltip>
        <span className="git-history-row__meta">
          {entry.shortSha} · {entry.authorName}
        </span>
      </div>
      <span className="git-history-row__when">{formatRelativeTime(entry.authoredAt, locale)}</span>
    </button>
  );
}

interface PendingDiscardConfirmation {
  scope: "single" | "all";
  paths: string[];
  filePath?: string;
}

interface GitDiscardConfirmModalProps {
  discard: PendingDiscardConfirmation | null;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}

const GitDiscardConfirmModal: FC<GitDiscardConfirmModalProps> = ({
  discard,
  onCancel,
  onConfirm,
}) => {
  const t = useTranslation();

  if (!discard) {
    return null;
  }

  const title =
    discard.scope === "all"
      ? t("git.discard_all_confirm_title")
      : t("git.discard_file_confirm_title");
  const message =
    discard.scope === "all"
      ? t("git.discard_all_confirm_message", { count: discard.paths.length })
      : t("git.discard_file_confirm_message", {
          path: discard.filePath ?? discard.paths[0] ?? "",
        });

  return (
    <ConfirmDialog
      open
      onOpenChange={onCancel}
      title={title}
      description={
        <>
          <p>{message}</p>
          <p className="dialog-helper">{t("git.discard_confirm_irreversible")}</p>
        </>
      }
      cancelText={t("action.cancel")}
      closeLabel={t("action.close")}
      confirmText={t("git.discard")}
      onConfirm={() => {
        void onConfirm();
      }}
      tone="danger"
    />
  );
};

function getResolvedChangeStatus(change: GitFileChange, type: GitChangeType) {
  if (change.status) {
    return change.status;
  }

  if (type === "deleted") {
    return "deleted";
  }

  if (type === "untracked") {
    return "untracked";
  }

  return "modified";
}

function getChangeSemantic(change: GitFileChange, type: GitChangeType) {
  const status = getResolvedChangeStatus(change, type);

  switch (status) {
    case "deleted":
      return "git.status.deleted";
    case "untracked":
    case "added":
      return "git.status.untracked";
    case "renamed":
    case "modified":
    default:
      return type === "staged" ? "git.status.staged" : "git.status.modified";
  }
}

function getStatusBadgeClass(status: ReturnType<typeof getResolvedChangeStatus>): string {
  switch (status) {
    case "deleted":
      return "deleted";
    case "untracked":
    case "added":
      return "untracked";
    case "renamed":
    case "modified":
    default:
      return "modified";
  }
}

function getStatusBadgeLabel(
  status: ReturnType<typeof getResolvedChangeStatus>,
  type: GitChangeType
): string {
  if (type === "staged") {
    return "S";
  }

  switch (status) {
    case "deleted":
      return "D";
    case "untracked":
    case "added":
      return "A";
    case "renamed":
      return "R";
    case "modified":
    default:
      return "M";
  }
}

export default GitPanel;
