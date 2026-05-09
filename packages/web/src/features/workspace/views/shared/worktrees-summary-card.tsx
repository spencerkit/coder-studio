import { useEffect, useRef, useState } from "react";
import { useTranslation } from "../../../../lib/i18n";
import { useWorktreeManagementActions } from "../../actions/use-worktree-management-actions";
import { WorktreeManagerSurface } from "./worktree-manager-surface";

interface WorktreesSummaryCardProps {
  workspaceId: string;
}

export function WorktreesSummaryCard({ workspaceId }: WorktreesSummaryCardProps) {
  const t = useTranslation();
  const { currentWorktree, dirtyCount, hasWorkspace, list, loadWorktrees } =
    useWorktreeManagementActions(workspaceId);
  const [openView, setOpenView] = useState<"list" | "create" | null>(null);
  const worktreeAutoLoadAttemptedRef = useRef(false);

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

  return (
    <>
      <section className="worktree-summary-card" aria-label={t("worktree.list_title")}>
        <div className="worktree-summary-card__header">
          <div className="worktree-summary-card__copy">
            <h3>{t("worktree.list_title")}</h3>
            <p>
              {currentWorktree
                ? t("worktree.summary_current", { name: currentWorktree.name })
                : t("worktree.summary_no_current")}
            </p>
          </div>

          <div className="worktree-summary-card__actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setOpenView("list")}
            >
              {t("worktree.manage")}
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setOpenView("create")}
            >
              {t("worktree.new")}
            </button>
          </div>
        </div>

        <div className="worktree-summary-card__stats">
          <span>{t("worktree.summary_total", { count: list.items.length })}</span>
          <span>{t("worktree.summary_dirty", { count: dirtyCount })}</span>
        </div>

        {list.error ? (
          <div className="worktree-error">
            <div>{list.error}</div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => void loadWorktrees()}
            >
              {t("action.refresh")}
            </button>
          </div>
        ) : null}
      </section>

      <WorktreeManagerSurface
        workspaceId={workspaceId}
        openView={openView}
        onClose={() => setOpenView(null)}
      />
    </>
  );
}
