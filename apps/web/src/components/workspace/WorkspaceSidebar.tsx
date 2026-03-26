import type { Locale, Translator } from "../../i18n";
import { displayPathName } from "../../shared/utils/path";
import type { TreeNode } from "../../state/workbench";
import type { GitChangeAction, GitChangeEntry } from "../../types/app";
import {
  AgentSendIcon,
  GitDiscardIcon,
  GitStageIcon,
  GitUnstageIcon,
  RefreshIcon,
  WorkspaceBranchIcon,
  WorkspaceChangesIcon,
  WorkspaceFolderIcon,
  getFileIcon,
} from "../icons";
import { TreeView } from "../TreeView";

type ChangeGroup = {
  key: string;
  label: string;
  items: GitChangeEntry[];
};

type WorkspaceSidebarProps = {
  locale: Locale;
  view: "files" | "git";
  fileTree: TreeNode[];
  rootPath?: string;
  branchName?: string;
  selectedPath?: string;
  repoCollapsedPaths: Set<string>;
  gitChangeGroups: ChangeGroup[];
  activeGitChangeKey: string;
  commitMessage: string;
  onCommitMessageChange: (value: string) => void;
  onFileSelect: (node: TreeNode) => void;
  onToggleRepoCollapse: (path: string) => void;
  onRefresh: () => void;
  onStageAll: () => void;
  onUnstageAll: () => void;
  onDiscardAll: () => void;
  onCommit: () => void;
  onGitChangeSelect: (change: GitChangeEntry) => void;
  onGitChangeAction: (change: GitChangeEntry, action: GitChangeAction) => void;
  onSetView: (view: "files" | "git") => void;
  t: Translator;
};

export const WorkspaceSidebar = ({
  locale,
  view,
  fileTree,
  rootPath,
  branchName,
  selectedPath,
  repoCollapsedPaths,
  gitChangeGroups,
  activeGitChangeKey,
  commitMessage,
  onCommitMessageChange,
  onFileSelect,
  onToggleRepoCollapse,
  onRefresh,
  onStageAll,
  onUnstageAll,
  onDiscardAll,
  onCommit,
  onGitChangeSelect,
  onGitChangeAction,
  onSetView,
  t
}: WorkspaceSidebarProps) => {
  const rootLabel = displayPathName(rootPath) || rootPath || "";
  const dockMeta = view === "git"
    ? (branchName && branchName !== "—" ? branchName : "")
    : rootLabel;

  const dockActions = view === "git" ? (
    <div className="git-toolbar-actions">
      <button className="workspace-icon-button bare" type="button" onClick={onRefresh} title={t("refresh")} aria-label={t("refresh")}>
        <RefreshIcon />
      </button>
      <button className="workspace-icon-button bare" type="button" onClick={onStageAll} title={t("stageAll")} aria-label={t("stageAll")}>
        <GitStageIcon />
      </button>
      <button className="workspace-icon-button bare" type="button" onClick={onUnstageAll} title={t("unstageAll")} aria-label={t("unstageAll")}>
        <GitUnstageIcon />
      </button>
      <button className="workspace-icon-button bare" type="button" onClick={onDiscardAll} title={t("discardAll")} aria-label={t("discardAll")}>
        <GitDiscardIcon />
      </button>
      <button className="workspace-icon-button bare" type="button" onClick={onCommit} disabled={!commitMessage.trim()} title={t("commit")} aria-label={t("commit")}>
        <AgentSendIcon />
      </button>
    </div>
  ) : (
    <button className="workspace-icon-button bare" type="button" onClick={onRefresh} title={t("refresh")} aria-label={t("refresh")}>
      <RefreshIcon />
    </button>
  );

  const dockHeader = (
    <div className="workspace-review-dock-header" data-testid="workspace-review-dock-toolbar">
      <div className="workspace-review-dock-topline">
        <span className="section-kicker">{view === "files" ? t("repositoryNavigator") : t("sourceControl")}</span>
        {dockMeta ? (
          <span className="workspace-review-dock-chip" title={dockMeta}>
            {view === "git" ? <WorkspaceBranchIcon /> : <WorkspaceFolderIcon />}
            <span>{dockMeta}</span>
          </span>
        ) : null}
      </div>
      <div className="workspace-review-dock-bar">
        <div className="workspace-review-dock-tabs" data-testid="workspace-review-dock-tabs">
          <button
            type="button"
            className={`workspace-review-dock-tab ${view === "files" ? "active" : ""}`}
            onClick={() => onSetView("files")}
            aria-pressed={view === "files"}
          >
            <WorkspaceFolderIcon />
            <span>{t("files")}</span>
          </button>
          <button
            type="button"
            className={`workspace-review-dock-tab ${view === "git" ? "active" : ""}`}
            onClick={() => onSetView("git")}
            aria-pressed={view === "git"}
          >
            <WorkspaceChangesIcon />
            <span>Git Diff</span>
          </button>
        </div>
        {dockActions}
      </div>
    </div>
  );

  if (view === "files") {
    return (
      <div className="workspace-review-dock-section workspace-review-dock-section-files">
        {dockHeader}
        {fileTree.length === 0 ? (
          <div className="tree-empty">{t("selectProjectToLoadFiles")}</div>
        ) : (
          <TreeView
            nodes={fileTree}
            onSelect={onFileSelect}
            collapsedPaths={repoCollapsedPaths}
            locale={locale}
            selectedPath={selectedPath}
            rootPath={rootPath}
            onToggleCollapse={onToggleRepoCollapse}
          />
        )}
      </div>
    );
  }

  return (
    <div className="workspace-git-sidebar workspace-review-dock-section workspace-review-dock-section-git">
      {dockHeader}
      <div className="workspace-git-compose">
        <div className="form-row">
          <input
            value={commitMessage}
            onChange={(event) => onCommitMessageChange(event.target.value)}
            placeholder={t("commitPlaceholder")}
            data-testid="git-commit-message"
            className="workspace-git-commit-input"
          />
        </div>
      </div>
      <div className="source-control-list">
        {gitChangeGroups.length === 0 && <div className="tree-empty">{t("noChangesDetected")}</div>}
        {gitChangeGroups.map((group) => (
          <div key={group.key} className="source-group">
            <div className="source-group-head">
              <span>{group.label}</span>
              <span>{group.items.length}</span>
            </div>
            <div className="source-group-items">
              {group.items.map((change) => {
                const changeKey = `${change.section}:${change.path}:${change.code}`;
                const rowActions = change.section === "staged"
                  ? [{ id: "unstage" as const, title: t("unstageFile"), icon: <GitUnstageIcon /> }]
                  : [
                      { id: "stage" as const, title: t("stageFile"), icon: <GitStageIcon /> },
                      { id: "discard" as const, title: t("discardFile"), icon: <GitDiscardIcon /> }
                    ];
                return (
                  <div
                    key={changeKey}
                    role="button"
                    tabIndex={0}
                    className={`source-change-row ${activeGitChangeKey === changeKey ? "active" : ""}`}
                    data-section={change.section}
                    onClick={() => onGitChangeSelect(change)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onGitChangeSelect(change);
                      }
                    }}
                  >
                    <span className="source-change-file-icon" aria-hidden="true">
                      {getFileIcon(change.name, false, false)}
                    </span>
                    <span className="source-change-copy">
                      <span className="source-change-name">{change.name}</span>
                      <span className="source-change-parent">{change.parent || "."}</span>
                    </span>
                    <span className="source-change-tail">
                      <span className={`source-status-badge ${change.section}`} title={change.status}>{change.code}</span>
                      <span className="source-change-actions">
                        {rowActions.map((action) => (
                          <button
                            key={action.id}
                            type="button"
                            className="source-action-btn"
                            title={action.title}
                            aria-label={action.title}
                            onClick={(event) => {
                              event.stopPropagation();
                              onGitChangeAction(change, action.id);
                            }}
                          >
                            {action.icon}
                          </button>
                        ))}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default WorkspaceSidebar;
