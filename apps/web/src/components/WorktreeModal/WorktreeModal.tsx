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
    <div className="modal-card">
      <div className="modal-header">
        <h3>{worktree.name}</h3>
        <button className="btn tiny" onClick={onClose}>{t("close")}</button>
      </div>
      <div className="file-tabs">
        {(["status", "diff", "tree"] as const).map((nextView) => (
          <div
            key={nextView}
            className={`t-tab ${view === nextView ? "active" : ""}`}
            onClick={() => onViewChange(nextView)}
          >
            {nextView === "status" ? t("statusTab") : nextView === "diff" ? t("diff") : t("treeTab")}
          </div>
        ))}
      </div>
      <div className="modal-body">
        {worktree.loading && <div className="empty">{t("loadingWorktreeDetails")}</div>}
        {view === "status" && (
          <div>
            <div className="muted">{t("path")}: {worktree.path}</div>
            <div className="muted">{t("branch")}: {worktree.branch}</div>
            <div className="status">{worktree.status || t("clean")}</div>
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
