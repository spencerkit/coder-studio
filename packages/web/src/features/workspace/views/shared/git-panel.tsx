import type { GitCommitSummary, GitFileChange, WorktreeInfo } from "@coder-studio/core";
import { useAtomValue } from "jotai";
import { ArrowUp, ChevronDown, Minus, Plus, RotateCcw } from "lucide-react";
import type { FC } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { localeAtom } from "../../../../atoms/app-ui";
import { ConfirmDialog, Textarea } from "../../../../components/ui";
import { formatRelativeTime, useTranslation } from "../../../../lib/i18n";
import {
  type GitChangeType,
  type GitPanelChangeItem,
  useGitPanelActions,
} from "../../actions/use-git-actions";
import { useWorktreeManagementActions } from "../../actions/use-worktree-management-actions";
import type { GitDiffPreview } from "../../atoms";
import { WorktreeManagerSurface } from "./worktree-manager-surface";

interface GitPanelProps {
  workspaceId: string;
  refreshToken?: number;
  onPreviewOpen?: (preview: GitDiffPreview) => void;
  variant?: "desktop" | "mobile";
}

export const GitPanel: FC<GitPanelProps> = ({
  workspaceId,
  refreshToken = 0,
  onPreviewOpen,
  variant = "desktop",
}) => {
  const isMobile = variant === "mobile";
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
  const { currentWorktree, hasWorkspace, list, loadWorktrees, openWorktree } =
    useWorktreeManagementActions(workspaceId);
  const [worktreeSurfaceView, setWorktreeSurfaceView] = useState<"list" | "create" | null>(null);
  const [worktreesExpanded, setWorktreesExpanded] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const worktreeAutoLoadAttemptedRef = useRef(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() =>
    isMobile
      ? {
          staged: false,
          changes: true,
        }
      : {
          staged: false,
          changes: false,
        }
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
      setWorktreeSurfaceView("list");
      return;
    }

    await openWorktree(worktree.path);
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
              <button
                className="git-commit-primary"
                onClick={() => void handleCommit()}
                disabled={!canCommit}
                title={canCommit ? t("git.commit") : t("git.nothing_staged")}
                type="button"
              >
                <span>{t("git.commit")}</span>
                <ArrowUp size={14} />
              </button>
            </div>
          </section>

          <section className="git-panel-section">
            <div className="git-panel-section-header">
              <button
                type="button"
                className="git-panel-section-toggle"
                onClick={() => setWorktreesExpanded((value) => !value)}
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
                onClick={() => setWorktreeSurfaceView("create")}
              >
                + {t("worktree.new")}
              </button>
            </div>

            {worktreesExpanded ? (
              <div className="git-panel-section-body">
                {list.loading && list.items.length === 0 ? (
                  <div className="git-panel-empty">{t("worktree.loading")}</div>
                ) : list.error ? (
                  <div className="git-panel-empty">
                    <span>{list.error}</span>
                    <button
                      type="button"
                      className="git-panel-section-link"
                      onClick={() => void loadWorktrees()}
                    >
                      {t("action.refresh")}
                    </button>
                  </div>
                ) : list.items.length === 0 ? (
                  <div className="git-panel-empty">{t("worktree.list_empty")}</div>
                ) : (
                  list.items.map((worktree) => (
                    <button
                      key={worktree.path}
                      type="button"
                      className={`git-worktree-row ${
                        currentWorktree?.path === worktree.path ? "active" : ""
                      }`}
                      onClick={() => void handleWorktreeOpen(worktree)}
                    >
                      <span
                        className={`git-worktree-row__dot git-worktree-row__dot-${worktree.status}`}
                        aria-hidden="true"
                      />
                      <span className="git-worktree-row__copy">
                        <span className="git-worktree-row__name">{worktree.name}</span>
                        <span className="git-worktree-row__meta">
                          {worktree.branch} ·{" "}
                          {worktree.status === "clean"
                            ? t("worktree.clean")
                            : t("worktree.dirty_status")}
                        </span>
                      </span>
                      {currentWorktree?.path === worktree.path ? (
                        <span className="git-worktree-row__chip">{t("worktree.current")}</span>
                      ) : null}
                    </button>
                  ))
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
                      setCollapsedGroups((prev) => ({
                        ...prev,
                        [group.title]: !(prev[group.title] ?? false),
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
                <div className="git-panel-empty">
                  {isLoading ? t("common.loading") : t("git.no_changes")}
                </div>
              )
            ) : (
              <div className="git-panel-empty">
                {isLoading ? t("common.loading") : t("git.no_changes")}
              </div>
            )}
          </div>

          <section className="git-panel-section git-panel-section-history">
            <div className="git-panel-section-header">
              <button
                type="button"
                className="git-panel-section-toggle"
                onClick={() => setHistoryExpanded((value) => !value)}
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
                  <div className="git-panel-empty">{t("common.loading")}</div>
                ) : history.length === 0 ? (
                  <div className="git-panel-empty">{t("git.no_commits")}</div>
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
        onClose={() => setWorktreeSurfaceView(null)}
      />

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
          <button
            type="button"
            className="git-panel-section-link"
            onClick={() => void onStageAll()}
            title={stageActionLabel}
          >
            {stageActionLabel}
          </button>
          {title === "changes" ? (
            <button
              type="button"
              className="git-panel-section-link"
              onClick={() => void onDiscardAll()}
              title={t("git.discard_all")}
            >
              {t("git.discard_all")}
            </button>
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
  const badge = getChangeBadge(change, type);
  const tone = getChangeTone(change, type);

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
      <span className={`git-row-status-badge git-row-status-badge-${tone}`}>{badge}</span>

      <div className="git-row-content">
        <span className="git-row-name">{fileName}</span>
        <span className="git-row-meta">
          {dirName ? <span className="git-row-dir">{dirName}</span> : null}
          {change.oldPath ? <span className="git-row-rename">{change.oldPath}</span> : null}
        </span>
      </div>

      <div className="git-row-actions">
        <button
          className="git-row-action"
          onClick={(event) => {
            event.stopPropagation();
            void handleToggleStage();
          }}
          title={type === "staged" ? t("git.unstage") : t("git.stage")}
          type="button"
        >
          {type === "staged" ? <Minus size={12} /> : <Plus size={12} />}
        </button>

        <button
          className="git-row-action"
          onClick={(event) => {
            event.stopPropagation();
            onRequestDiscard(change.path);
          }}
          title={t("git.discard")}
          type="button"
        >
          <RotateCcw size={12} />
        </button>
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
      title={entry.subject}
    >
      <span className="git-history-row__dot" aria-hidden="true" />
      <div className="git-history-row__copy">
        <span className="git-history-row__title">{entry.subject}</span>
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

function getChangeBadge(change: GitFileChange, type: GitChangeType) {
  const status = getResolvedChangeStatus(change, type);

  switch (status) {
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "untracked":
      return "?";
    case "modified":
    default:
      return "M";
  }
}

function getChangeTone(change: GitFileChange, type: GitChangeType) {
  return getResolvedChangeStatus(change, type);
}

export default GitPanel;
