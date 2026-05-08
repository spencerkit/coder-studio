import type { WorktreeInfo } from "@coder-studio/core";
import { Tab, TabList, TabPanel, Tabs } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { useWorktreeActions } from "../../actions/use-workspace-launch-actions";

type TabType = "status" | "diff" | "tree";

interface WorktreeDetailPanelProps {
  workspaceId: string;
  worktree: WorktreeInfo;
  mobile?: boolean;
}

export function WorktreeDetailPanel({
  workspaceId,
  worktree,
  mobile = false,
}: WorktreeDetailPanelProps) {
  const t = useTranslation();
  const { activeTab, diff, error, handleTabChange, loading, status, tree } = useWorktreeActions(
    workspaceId,
    worktree
  );

  return (
    <>
      <div className={mobile ? "mobile-worktree-sheet__summary" : undefined}>
        <div className="worktree-chips">
          <span className="worktree-chip worktree-chip-branch">🌿 {worktree.branch}</span>
          <span className="worktree-chip worktree-chip-path">📁 {worktree.path}</span>
          <span
            className={`worktree-chip worktree-chip-status ${
              worktree.status === "clean" ? "worktree-clean" : "worktree-dirty"
            }`}
          >
            {worktree.status === "clean"
              ? `✓ ${t("worktree.clean")}`
              : `● ${t("worktree.dirty_status")}`}
          </span>
        </div>
      </div>

      <Tabs
        aria-label={t("worktree.title")}
        onValueChange={(value) => handleTabChange(value as TabType)}
        value={activeTab}
      >
        <TabList className={`worktree-tabs${mobile ? " mobile-worktree-sheet__tabs" : ""}`}>
          {(["status", "diff", "tree"] as TabType[]).map((tab) => (
            <Tab key={tab} className="worktree-tab" value={tab}>
              {tab === "status"
                ? t("worktree.status_tab")
                : tab === "diff"
                  ? t("worktree.diff_tab")
                  : t("worktree.tree_tab")}
            </Tab>
          ))}
        </TabList>

        <div className={mobile ? "mobile-worktree-sheet__content" : undefined}>
          <TabPanel className="modal-body worktree-content" value="status">
            {error ? <div className="worktree-error">{error}</div> : null}
            {loading ? (
              <div className="worktree-loading">{t("worktree.loading")}</div>
            ) : (
              <div className="worktree-status-tab">
                <div className="worktree-info-row">
                  <span className="worktree-info-label">{t("worktree.path")}</span>
                  <span className="worktree-info-value">{worktree.path}</span>
                </div>
                <div className="worktree-info-row">
                  <span className="worktree-info-label">{t("worktree.branch")}</span>
                  <span className="worktree-info-value">{worktree.branch}</span>
                </div>
                <div className="worktree-info-row">
                  <span className="worktree-info-label">{t("git.latest_commit")}</span>
                  <span className="worktree-info-value">
                    {status?.headShortSha || worktree.commit ? (
                      <>
                        <code>{status?.headShortSha ?? worktree.commit}</code>
                        {status?.headSubject ? ` ${status.headSubject}` : ""}
                      </>
                    ) : (
                      t("git.no_commits")
                    )}
                  </span>
                </div>
                <div className="worktree-info-row">
                  <span className="worktree-info-label">{t("label.status")}</span>
                  <span className="worktree-info-value">
                    {worktree.status === "clean" ? t("worktree.clean") : t("worktree.dirty")}
                  </span>
                </div>
                {status ? (
                  <div className="worktree-changes">
                    <h4>{t("worktree.changes")}</h4>
                    {status.staged.length > 0 ? (
                      <div className="worktree-change-group">
                        <span>{t("worktree.staged_count", { count: status.staged.length })}</span>
                      </div>
                    ) : null}
                    {status.modified.length > 0 ? (
                      <div className="worktree-change-group">
                        <span>
                          {t("worktree.modified_count", { count: status.modified.length })}
                        </span>
                      </div>
                    ) : null}
                    {status.untracked.length > 0 ? (
                      <div className="worktree-change-group">
                        <span>
                          {t("worktree.untracked_count", { count: status.untracked.length })}
                        </span>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}
          </TabPanel>

          <TabPanel className="modal-body worktree-content" value="diff">
            {error ? <div className="worktree-error">{error}</div> : null}
            {loading ? (
              <div className="worktree-loading">{t("worktree.loading")}</div>
            ) : (
              <div className="worktree-diff-tab">
                {diff ? (
                  <pre className="worktree-diff-output">{diff}</pre>
                ) : (
                  <div className="worktree-empty">{t("git.no_changes")}</div>
                )}
              </div>
            )}
          </TabPanel>

          <TabPanel className="modal-body worktree-content" value="tree">
            {error ? <div className="worktree-error">{error}</div> : null}
            {loading ? (
              <div className="worktree-loading">{t("worktree.loading")}</div>
            ) : (
              <div className="worktree-tree-tab">
                {tree.length > 0 ? (
                  <div className="worktree-tree">
                    {tree.map((node) => (
                      <div key={node.path} className="worktree-tree-node">
                        <span className="worktree-tree-icon">
                          {node.kind === "dir" ? "📁" : "📄"}
                        </span>
                        <span className="worktree-tree-name">{node.name}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="worktree-empty">{t("worktree.empty_tree")}</div>
                )}
              </div>
            )}
          </TabPanel>
        </div>
      </Tabs>
    </>
  );
}
