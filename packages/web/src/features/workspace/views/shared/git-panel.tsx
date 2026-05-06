import type { GitFileChange } from "@coder-studio/core";
import { AlertTriangle, ArrowUp, File, Minus, Plus, RefreshCw, RotateCcw, X } from "lucide-react";
import type { FC } from "react";
import { useMemo } from "react";
import { useTranslation } from "../../../../lib/i18n";
import { type GitChangeType, useGitPanelActions } from "../../actions/use-git-actions";
import type { GitDiffPreview } from "../../atoms";

interface GitPanelProps {
  workspaceId: string;
  refreshToken?: number;
  onPreviewOpen?: (preview: GitDiffPreview) => void;
}

export const GitPanel: FC<GitPanelProps> = ({ workspaceId, refreshToken = 0, onPreviewOpen }) => {
  const t = useTranslation();
  const {
    commitMessage,
    diffPreview,
    gitState,
    groups,
    hasChanges,
    isLoading,
    pendingDiscard,
    setCommitMessage,
    handleCancelDiscard,
    handleCommit,
    handleConfirmDiscard,
    handleDiscardAll,
    handleRequestDiscardSingle,
    handleStageAll,
    handleUnstageAll,
    loadGitStatus,
    openDiff,
    runGitMutation,
  } = useGitPanelActions({
    workspaceId,
    refreshToken,
    onPreviewOpen,
  });

  return (
    <div className="git-panel">
      <div className="panel-toolbar git-panel-toolbar">
        <div className="git-toolbar-cluster">
          <button
            className="panel-toolbar-btn"
            onClick={() => void loadGitStatus()}
            disabled={isLoading}
            title={t("action.refresh")}
            type="button"
          >
            <RefreshCw size={14} className={isLoading ? "spin" : undefined} />
          </button>

          {hasChanges && (
            <>
              <button
                className="panel-toolbar-btn"
                onClick={() => void handleStageAll()}
                title={t("git.stage_all")}
                type="button"
              >
                <Plus size={14} />
              </button>
              <button
                className="panel-toolbar-btn"
                onClick={() => void handleUnstageAll()}
                title={t("git.unstage_all")}
                type="button"
              >
                <Minus size={14} />
              </button>
              <button
                className="panel-toolbar-btn"
                onClick={() => void handleDiscardAll()}
                title={t("git.discard_all")}
                type="button"
              >
                <RotateCcw size={14} />
              </button>
              <button
                className="panel-toolbar-btn git-panel-commit-btn"
                onClick={() => void handleCommit()}
                disabled={!commitMessage.trim() || !gitState?.staged.length}
                title={t("git.commit")}
                type="button"
              >
                <ArrowUp size={14} />
              </button>
            </>
          )}
        </div>
      </div>

      <textarea
        className="git-commit-input"
        placeholder={t("git.commit_placeholder")}
        value={commitMessage}
        onChange={(event) => setCommitMessage(event.target.value)}
        rows={1}
      />

      {gitState?.headShortSha || gitState?.headSubject ? (
        <div className="git-head-summary" aria-label={t("git.latest_commit")}>
          <span className="git-head-summary__label">{t("git.latest_commit")}</span>
          <span className="git-head-summary__value">
            {gitState.headShortSha ? <code>{gitState.headShortSha}</code> : null}
            {gitState.headSubject ? <span>{gitState.headSubject}</span> : null}
          </span>
        </div>
      ) : null}

      <div className="git-list">
        {gitState ? (
          groups.length > 0 ? (
            groups.map((group) => (
              <GitChangeGroup
                key={group.title}
                title={group.title}
                changes={group.changes}
                type={group.type}
                selectedPath={diffPreview?.path ?? null}
                onViewDiff={openDiff}
                onRunMutation={runGitMutation}
                onRequestDiscard={handleRequestDiscardSingle}
                workspaceId={workspaceId}
              />
            ))
          ) : (
            <div className="git-empty">{t("git.no_changes")}</div>
          )
        ) : (
          <div className="git-empty">{isLoading ? t("common.loading") : t("git.no_changes")}</div>
        )}
      </div>

      <GitDiscardConfirmModal
        discard={pendingDiscard}
        onCancel={handleCancelDiscard}
        onConfirm={handleConfirmDiscard}
      />
    </div>
  );
};

interface GitChangeGroupProps {
  title: string;
  changes: GitFileChange[];
  type: GitChangeType;
  selectedPath: string | null;
  workspaceId: string;
  onViewDiff: (change: GitFileChange, type: GitChangeType) => Promise<void>;
  onRunMutation: (
    op: "git.stage" | "git.unstage" | "git.discard" | "git.commit",
    args: Record<string, unknown>,
    errorMessage: string,
    afterSuccess?: () => void
  ) => Promise<boolean>;
  onRequestDiscard: (path: string) => void;
}

const GitChangeGroup: FC<GitChangeGroupProps> = ({
  title,
  changes,
  type,
  selectedPath,
  workspaceId,
  onViewDiff,
  onRunMutation,
  onRequestDiscard,
}) => {
  const t = useTranslation();
  const titleKey =
    title === "staged"
      ? "git.staged"
      : title === "changes"
        ? "git.changes"
        : title === "deleted"
          ? "git.deleted"
          : "git.untracked";

  return (
    <div className="git-group">
      <div className="git-group-header">
        <span>{t(titleKey)}</span>
        <span className="git-group-count">{changes.length}</span>
      </div>

      {changes.map((change) => (
        <GitChangeRow
          key={change.path}
          change={change}
          type={type}
          workspaceId={workspaceId}
          selected={selectedPath === change.path}
          onViewDiff={onViewDiff}
          onRunMutation={onRunMutation}
          onRequestDiscard={onRequestDiscard}
        />
      ))}
    </div>
  );
};

interface GitChangeRowProps {
  change: GitFileChange;
  type: GitChangeType;
  workspaceId: string;
  selected: boolean;
  onViewDiff: (change: GitFileChange, type: GitChangeType) => Promise<void>;
  onRunMutation: (
    op: "git.stage" | "git.unstage" | "git.discard" | "git.commit",
    args: Record<string, unknown>,
    errorMessage: string,
    afterSuccess?: () => void
  ) => Promise<boolean>;
  onRequestDiscard: (path: string) => void;
}

const GitChangeRow: FC<GitChangeRowProps> = ({
  change,
  type,
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

  const badgeLabel =
    type === "staged"
      ? t("git.staged")
      : type === "modified"
        ? t("git.modified")
        : type === "deleted"
          ? t("git.deleted")
          : t("git.untracked");

  const iconTone =
    type === "modified"
      ? "modified"
      : type === "deleted"
        ? "deleted"
        : type === "staged"
          ? "staged"
          : "untracked";

  const handleToggleStage = async () => {
    if (type === "staged") {
      await onRunMutation(
        "git.unstage",
        { workspaceId, paths: [change.path] },
        "Failed to unstage:"
      );
      return;
    }

    await onRunMutation("git.stage", { workspaceId, paths: [change.path] }, "Failed to stage:");
  };

  return (
    <div
      className={`git-row ${selected ? "active" : ""}`}
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
      <span className={`git-row-icon git-row-icon-${iconTone}`}>
        <File size={14} />
      </span>

      <div className="git-row-content">
        <span className="git-row-name">{fileName}</span>
        <span className="git-row-meta">
          {dirName ? <span className="git-row-dir">{dirName}</span> : null}
          <span className={`git-row-status git-row-status-end git-row-status-${iconTone}`}>
            {badgeLabel}
          </span>
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
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <AlertTriangle size={16} />
            <h3>{title}</h3>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={onCancel}
            aria-label={t("action.close")}
          >
            <X size={14} />
          </button>
        </div>

        <div className="modal-body">
          <p>{message}</p>
          <p className="dialog-helper">{t("git.discard_confirm_irreversible")}</p>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onCancel}>
            {t("action.cancel")}
          </button>
          <button
            className="btn btn-danger"
            onClick={() => {
              void onConfirm();
            }}
          >
            {t("git.discard")}
          </button>
        </div>
      </div>
    </div>
  );
};

export default GitPanel;
