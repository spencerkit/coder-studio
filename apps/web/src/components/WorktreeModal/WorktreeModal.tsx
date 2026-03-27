import type { Locale, Translator } from "../../i18n";
import type { TreeNode } from "../../state/workbench";
import type { WorktreeModalState, WorktreeView } from "../../types/app";
import { TreeView } from "../TreeView";

type WorktreeModalProps = {
  locale: Locale;
  worktree: WorktreeModalState;
  view: WorktreeView;
  collapsedPaths: Set<string>;
  onClose: () => void;
  onViewChange: (view: WorktreeView) => void;
  onFileSelect: (node: TreeNode) => void;
  onToggleCollapse: (path: string) => void;
  t: Translator;
};

export const WorktreeModal = ({
  locale,
  worktree,
  view,
  collapsedPaths,
  onClose,
  onViewChange,
  onFileSelect,
  onToggleCollapse,
  t
}: WorktreeModalProps) => (
  <div className="modal-overlay">
    <div className="modal-card worktree-modal-card" role="dialog" aria-modal="true" data-testid="worktree-modal" data-density="compact">
      <div className="modal-header worktree-modal-header">
        <div className="worktree-modal-copy">
          <span className="section-kicker">{locale === "zh" ? "工作树检查" : "Worktree Inspect"}</span>
          <h3>{worktree.name}</h3>
        </div>
        <div className="worktree-modal-meta">
          <span className="worktree-meta-chip">{worktree.branch}</span>
          <span className="worktree-meta-chip" title={worktree.path}>{worktree.path}</span>
          <span className={`worktree-meta-chip status ${worktree.status ? "dirty" : "clean"}`}>
            {worktree.status || t("clean")}
          </span>
          <button className="btn tiny ghost" type="button" onClick={onClose}>{t("close")}</button>
        </div>
      </div>
      <div className="file-tabs worktree-modal-tabs">
        {(["status", "diff", "tree"] as const).map((nextView) => (
          <button
            key={nextView}
            type="button"
            className={`t-tab ${view === nextView ? "active" : ""}`}
            onClick={() => onViewChange(nextView)}
            aria-pressed={view === nextView}
          >
            {nextView === "status" ? t("statusTab") : nextView === "diff" ? t("diff") : t("treeTab")}
          </button>
        ))}
      </div>
      <div className="modal-body">
        {worktree.loading && <div className="empty">{t("loadingWorktreeDetails")}</div>}
        {view === "status" && (
          <div className="worktree-status-view">
            <div className="worktree-status-row">
              <span className="section-kicker">{t("path")}</span>
              <strong>{worktree.path}</strong>
            </div>
            <div className="worktree-status-row">
              <span className="section-kicker">{t("branch")}</span>
              <strong>{worktree.branch}</strong>
            </div>
            <div className="worktree-status-row">
              <span className="section-kicker">{t("statusTab")}</span>
              <strong>{worktree.status || t("clean")}</strong>
            </div>
          </div>
        )}
        {view === "diff" && (
          <pre className="diff">{worktree.diff || t("noDiffAvailable")}</pre>
        )}
        {view === "tree" && (
          <TreeView
            nodes={worktree.tree ?? []}
            onSelect={onFileSelect}
            collapsedPaths={collapsedPaths}
            locale={locale}
            onToggleCollapse={onToggleCollapse}
          />
        )}
      </div>
    </div>
  </div>
);

export default WorktreeModal;
