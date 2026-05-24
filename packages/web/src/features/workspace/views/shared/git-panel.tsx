import type { GitCommitSummary, GitFileChange, WorktreeInfo } from "@coder-studio/core";
import { atom, useAtom, useAtomValue } from "jotai";
import { atomFamily } from "jotai-family";
import { ChevronDown, Minus, Plus, RotateCcw, Trash2 } from "lucide-react";
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
  variant?: "desktop" | "mobile";
}

interface GitPanelState {
  pendingWorktreeDeletePath: string | null;
  worktreeSurfaceView: "create" | null;
  worktreesExpanded: boolean;
  historyExpanded: boolean;
  collapsedGroups: Record<string, boolean>;
}

function createInitialCollapsedGroups(isMobile: boolean): Record<string, boolean> {
  return isMobile
    ? {
        staged: false,
        changes: true,
      }
    : {
        staged: false,
        changes: false,
      };
}

function createInitialGitPanelState(isMobile: boolean): GitPanelState {
  return {
    pendingWorktreeDeletePath: null,
    worktreeSurfaceView: null,
    worktreesExpanded: false,
    historyExpanded: false,
    collapsedGroups: createInitialCollapsedGroups(isMobile),
  };
}

function getGitPanelStateKey(workspaceId: string, variant: "desktop" | "mobile"): string {
  return `${workspaceId}::${variant}`;
}

const gitPanelStateAtomFamily = atomFamily((stateKey: string) =>
  atom<GitPanelState>(createInitialGitPanelState(stateKey.endsWith("::mobile")))
);

export const GitPanel: FC<GitPanelProps> = ({
  workspaceId,
  refreshToken = 0,
  onPreviewOpen,
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
    handleConfirmDiscard,
    handleRequestDiscardPaths,
    handleRequestDiscardSingle,
    handleStagePaths,
    handleUnstagePaths,
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
    collapsedGroups,
    historyExpanded,
    pendingWorktreeDeletePath,
    worktreeSurfaceView,
    worktreesExpanded,
  } = panelState;
  const pendingWorktreeDelete = useMemo(
    () => list.items.find((item) => item.path === pendingWorktreeDeletePath) ?? null,
    [list.items, pendingWorktreeDeletePath]
  );

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
          <section className="git-commit-block">
            <Textarea
              className="git-commit-input"
              placeholder={t("git.commit_summary_placeholder")}
              value={commitMessage}
              onChange={(event) => setCommitMessage(event.target.value)}
              rows={3}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  void handleCommit();
                }
              }}
            />

            <div className="git-commit-actions">
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
          </section>

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
              >
                <span>{t("worktree.list_title")}</span>
                <span className="git-panel-section-count">{list.items.length}</span>
                <span
                  className={`git-panel-section-chevron ${worktreesExpanded ? "expanded" : ""}`}
                >
                  <ChevronDown size={14} />
                </span>
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
                          className="git-worktree-row__main"
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

          <div className="git-panel-groups">
            {gitState ? (
              groups.length > 0 ? (
                groups.map((group) => (
                  <GitChangeGroup
                    key={group.title}
                    title={group.title}
                    changes={group.changes}
                    mobile={isMobile}
                    collapsed={collapsedGroups[group.title] ?? false}
                    selectedPath={diffPreview?.path ?? null}
                    onToggleCollapsed={() =>
                      setPanelState((current) => ({
                        ...current,
                        collapsedGroups: {
                          ...current.collapsedGroups,
                          [group.title]: !(current.collapsedGroups[group.title] ?? false),
                        },
                      }))
                    }
                    onStageAll={async () => {
                      if (group.title === "staged") {
                        await handleUnstagePaths(group.changes.map(({ change }) => change.path));
                        return;
                      }

                      await handleStagePaths(group.changes.map(({ change }) => change.path));
                    }}
                    onDiscardAll={() =>
                      handleRequestDiscardPaths(group.changes.map(({ change }) => change.path))
                    }
                    onViewDiff={openDiff}
                    onRunMutation={runGitMutation}
                    onRequestDiscard={handleRequestDiscardSingle}
                    workspaceId={workspaceId}
                  />
                ))
              ) : (
                <GitPanelEmptyState title={isLoading ? t("common.loading") : t("git.no_changes")} />
              )
            ) : (
              <GitPanelEmptyState title={isLoading ? t("common.loading") : t("git.no_changes")} />
            )}
          </div>

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
              >
                <span>{t("git.history")}</span>
                <span className={`git-panel-section-chevron ${historyExpanded ? "expanded" : ""}`}>
                  <ChevronDown size={14} />
                </span>
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

interface GitChangeGroupProps {
  title: string;
  changes: GitPanelChangeItem[];
  collapsed: boolean;
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
  onToggleCollapsed: () => void;
  onViewDiff: (change: GitFileChange, type: GitChangeType) => Promise<void>;
}

const GitChangeGroup: FC<GitChangeGroupProps> = ({
  title,
  changes,
  collapsed,
  mobile,
  selectedPath,
  workspaceId,
  onDiscardAll,
  onRequestDiscard,
  onRunMutation,
  onStageAll,
  onToggleCollapsed,
  onViewDiff,
}) => {
  const t = useTranslation();
  const titleKey = title === "staged" ? "git.staged" : "git.changes";
  const stageActionLabel = title === "staged" ? t("git.unstage_all") : t("git.stage_all");

  return (
    <section className="git-panel-section git-panel-section-changes">
      <div className="git-panel-section-header">
        <button
          type="button"
          className="git-panel-section-toggle"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
        >
          <span>{t(titleKey)}</span>
          <span className="git-panel-section-count">{changes.length}</span>
          <span className={`git-panel-section-chevron ${collapsed ? "" : "expanded"}`}>
            <ChevronDown size={14} />
          </span>
        </button>
        <div className="git-panel-section-actions">
          <Tooltip content={stageActionLabel}>
            <button
              type="button"
              className="git-panel-section-link"
              onClick={() => void onStageAll()}
            >
              {stageActionLabel}
            </button>
          </Tooltip>
          {title === "changes" ? (
            <Tooltip content={t("git.discard_all")}>
              <button
                type="button"
                className="git-panel-section-link"
                onClick={() => void onDiscardAll()}
              >
                {t("git.discard_all")}
              </button>
            </Tooltip>
          ) : null}
        </div>
      </div>

      {collapsed ? null : (
        <div className="git-panel-section-body">
          {changes.map(({ change, type }) => (
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
          ))}
        </div>
      )}
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
  const dirName = pathParts.length > 1 ? `${pathParts.slice(0, -1).join("/")}/` : "";
  const toggleStageLabel = type === "staged" ? t("git.unstage") : t("git.stage");
  const discardLabel = t("git.discard");
  const toggleStageIcon = type === "staged" ? <Minus size={12} /> : <Plus size={12} />;
  const semantic = getChangeSemantic(change, type);

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
      className={`git-row ${selected ? "active" : ""} ${mobile ? "mobile" : ""}`}
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
        <ThemedIcon semantic={semantic} size={13} />
      </span>

      <div className="git-row-content">
        <span className="git-row-name">{fileName}</span>
        <span className="git-row-meta">
          {dirName ? <span className="git-row-dir">{dirName}</span> : null}
          {change.oldPath ? <span className="git-row-rename">{change.oldPath}</span> : null}
        </span>
      </div>

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
      className={`git-history-row ${isCurrent ? "current" : ""}`}
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
      return "git.status.untracked";
    case "added":
    case "renamed":
    case "modified":
    default:
      return type === "staged" ? "git.status.staged" : "git.status.modified";
  }
}

export default GitPanel;
