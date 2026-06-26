import type { GitCommitSummary, GitFileChange, TaskRun, WorktreeInfo } from "@coder-studio/core";
import { atom, useAtom, useAtomValue, useSetAtom } from "jotai";
import { atomFamily } from "jotai-family";
import { ChevronDown, ChevronRight, Minus, Plus, RotateCcw, Trash2 } from "lucide-react";
import type { FC, MouseEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { localeAtom } from "../../../../atoms/app-ui";
import { dispatchCommandAtom } from "../../../../atoms/connection";
import {
  ConfirmDialog,
  EmptyState,
  IconButton,
  Textarea,
  ThemedIcon,
  Tooltip,
} from "../../../../components/ui";
import { formatRelativeTime, useTranslation } from "../../../../lib/i18n";
import { useTerminalThemeBackground } from "../../../../theme";
import { pushToastAtom } from "../../../notifications/atoms";
import { latestVerifyRunAtomFamily, taskStateAtomFamily } from "../../../tasks/atoms";
import { terminalCommandSidePanelOpenAtomFamily } from "../../../terminal-panel/atoms";
import {
  type GitChangeType,
  type GitPanelChangeItem,
  useGitPanelActions,
} from "../../actions/use-git-actions";
import { useWorktreeManagementActions } from "../../actions/use-worktree-management-actions";
import type { GitDiffPreview } from "../../atoms";
import { getFileNodeSemantic } from "./file-tree-icon-semantics";
import { WorktreeManagerSurface } from "./worktree-manager-surface";

const HISTORY_LOAD_THRESHOLD_PX = 48;
const GIT_HISTORY_DEBUG_STORAGE_KEY = "coder-studio.debug.gitHistory";

interface GitHistoryDebugElementSnapshot {
  tag: string;
  className: string;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  remainingScroll: number;
  overflowY: string;
  canScroll: boolean;
}

function isGitHistoryDebugEnabled(): boolean {
  if (typeof window === "undefined" || import.meta.env.MODE === "test") {
    return false;
  }

  try {
    return window.localStorage.getItem(GIT_HISTORY_DEBUG_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function getGitHistoryDebugElementSnapshot(
  element: Element | null
): GitHistoryDebugElementSnapshot | null {
  if (!(element instanceof HTMLElement)) {
    return null;
  }

  const style = window.getComputedStyle(element);
  return {
    tag: element.tagName.toLowerCase(),
    className: element.className,
    scrollTop: element.scrollTop,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
    remainingScroll: element.scrollHeight - element.scrollTop - element.clientHeight,
    overflowY: style.overflowY,
    canScroll: element.scrollHeight > element.clientHeight,
  };
}

function getGitHistoryScrollAncestors(element: HTMLElement | null) {
  const ancestors: GitHistoryDebugElementSnapshot[] = [];
  let current = element?.parentElement ?? null;

  while (current && ancestors.length < 8) {
    const snapshot = getGitHistoryDebugElementSnapshot(current);
    if (snapshot && (snapshot.canScroll || /auto|scroll|overlay/.test(snapshot.overflowY))) {
      ancestors.push(snapshot);
    }
    current = current.parentElement;
  }

  return ancestors;
}

function getGitHistoryDebugRect(rect: DOMRectReadOnly | null | undefined) {
  return rect?.toJSON?.() ?? rect ?? null;
}

function debugGitHistory(message: string, details?: Record<string, unknown>) {
  if (!isGitHistoryDebugEnabled()) {
    return;
  }

  console.log("[git-history]", message, details);
}

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
  stagedExpanded: boolean;
  mergeChangesExpanded: boolean;
  changesExpanded: boolean;
  historyExpanded: boolean;
}

function createInitialGitPanelState(): GitPanelState {
  return {
    pendingWorktreeDeletePath: null,
    worktreeSurfaceView: null,
    commitExpanded: true,
    worktreesExpanded: false,
    stagedExpanded: true,
    mergeChangesExpanded: true,
    changesExpanded: true,
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
  const dispatch = useAtomValue(dispatchCommandAtom);
  const pushToast = useSetAtom(pushToastAtom);
  const setCommandSidePanelOpen = useSetAtom(terminalCommandSidePanelOpenAtomFamily(workspaceId));
  const taskState = useAtomValue(taskStateAtomFamily(workspaceId));
  const latestVerifyRun = useAtomValue(latestVerifyRunAtomFamily(workspaceId));
  const setTaskState = useSetAtom(taskStateAtomFamily(workspaceId));
  const themeBackground = useTerminalThemeBackground();
  const {
    commitMessage,
    diffPreview,
    groups,
    history,
    historyHasMore,
    historyLoading,
    historyPageLoading,
    isLoading,
    loadMoreGitHistory,
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
  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const historyLoadSentinelRef = useRef<HTMLDivElement | null>(null);
  const worktreeAutoLoadAttemptedRef = useRef(false);
  const {
    changesExpanded,
    commitExpanded,
    historyExpanded,
    mergeChangesExpanded,
    pendingWorktreeDeletePath,
    stagedExpanded,
    worktreeSurfaceView,
    worktreesExpanded,
  } = panelState;
  const pendingWorktreeDelete = useMemo(
    () => list.items.find((item) => item.path === pendingWorktreeDeletePath) ?? null,
    [list.items, pendingWorktreeDeletePath]
  );
  const stagedGroup = groups.find((group) => group.title === "staged") ?? {
    title: "staged",
    changes: [],
  };
  const changesGroup = groups.find((group) => group.title === "changes") ?? {
    title: "changes",
    changes: [],
  };
  const mergeChangesGroup = groups.find((group) => group.title === "mergeChanges") ?? {
    title: "mergeChanges",
    changes: [],
  };
  const stagedCount = stagedGroup.changes.length;
  const mergeChangesCount = mergeChangesGroup.changes.length;
  const unstagedCount = changesGroup.changes.length;
  const commitSectionLabel = commitExpanded
    ? t("git.commit_collapse_label")
    : t("git.commit_expand_label");
  const worktreesSectionLabel = `${t("worktree.list_title")}${list.items.length}`;
  const stagedSectionLabel = `${t("git.staged")}${stagedCount}`;
  const mergeChangesSectionLabel = `${t("git.merge_changes")}${mergeChangesCount}`;
  const changesSectionLabel = `${t("git.changes")}${unstagedCount}`;
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

  const requestMoreHistory = useCallback(() => {
    if (!historyExpanded || !historyHasMore || historyLoading || historyPageLoading) {
      debugGitHistory("skip load more request", {
        historyExpanded,
        historyHasMore,
        historyLoading,
        historyPageLoading,
        historyCount: history.length,
      });
      return;
    }

    debugGitHistory("request load more", {
      historyCount: history.length,
      cursor: history[history.length - 1]?.sha,
    });
    void loadMoreGitHistory();
  }, [
    history,
    historyExpanded,
    historyHasMore,
    historyLoading,
    historyPageLoading,
    loadMoreGitHistory,
  ]);

  const handleGitPanelScroll = useCallback(() => {
    const root = scrollRootRef.current;
    if (!root) {
      debugGitHistory("scroll event without scroll root");
      return;
    }

    const remainingScroll = root.scrollHeight - root.scrollTop - root.clientHeight;
    debugGitHistory("panel scroll", {
      root: getGitHistoryDebugElementSnapshot(root),
      ancestors: getGitHistoryScrollAncestors(root),
      threshold: HISTORY_LOAD_THRESHOLD_PX,
      historyExpanded,
      historyHasMore,
      historyLoading,
      historyPageLoading,
    });
    if (remainingScroll <= HISTORY_LOAD_THRESHOLD_PX) {
      requestMoreHistory();
    }
  }, [historyExpanded, historyHasMore, historyLoading, historyPageLoading, requestMoreHistory]);

  useEffect(() => {
    debugGitHistory("panel state", {
      workspaceId,
      variant,
      root: getGitHistoryDebugElementSnapshot(scrollRootRef.current),
      historyExpanded,
      historyHasMore,
      historyLoading,
      historyPageLoading,
      historyCount: history.length,
    });
  }, [
    workspaceId,
    variant,
    history.length,
    historyExpanded,
    historyHasMore,
    historyLoading,
    historyPageLoading,
  ]);

  useEffect(() => {
    if (!isGitHistoryDebugEnabled()) {
      return;
    }

    const root = scrollRootRef.current;
    if (!root) {
      debugGitHistory("debug listener skipped: no scroll root");
      return;
    }

    const handleNativeRootScroll = () => {
      debugGitHistory("native root scroll", {
        root: getGitHistoryDebugElementSnapshot(root),
        ancestors: getGitHistoryScrollAncestors(root),
      });
    };

    const handleCapturedScroll = (event: Event) => {
      debugGitHistory("captured scroll", {
        target: getGitHistoryDebugElementSnapshot(event.target as Element | null),
        root: getGitHistoryDebugElementSnapshot(root),
        ancestors: getGitHistoryScrollAncestors(root),
      });
    };

    root.addEventListener("scroll", handleNativeRootScroll, { passive: true });
    window.addEventListener("scroll", handleCapturedScroll, true);
    debugGitHistory("debug listener attached", {
      root: getGitHistoryDebugElementSnapshot(root),
      ancestors: getGitHistoryScrollAncestors(root),
    });

    return () => {
      root.removeEventListener("scroll", handleNativeRootScroll);
      window.removeEventListener("scroll", handleCapturedScroll, true);
      debugGitHistory("debug listener detached");
    };
  }, []);

  useEffect(() => {
    if (!historyExpanded || !historyHasMore || typeof IntersectionObserver === "undefined") {
      debugGitHistory("observer skipped", {
        historyExpanded,
        historyHasMore,
        intersectionObserverAvailable: typeof IntersectionObserver !== "undefined",
      });
      return;
    }

    const root = scrollRootRef.current;
    const sentinel = historyLoadSentinelRef.current;
    if (!root || !sentinel) {
      debugGitHistory("observer skipped: missing root or sentinel", {
        hasRoot: Boolean(root),
        hasSentinel: Boolean(sentinel),
        root: getGitHistoryDebugElementSnapshot(root),
      });
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        debugGitHistory("observer entries", {
          entries: entries.map((entry) => ({
            isIntersecting: entry.isIntersecting,
            intersectionRatio: entry.intersectionRatio,
            boundingClientRect: getGitHistoryDebugRect(entry.boundingClientRect),
            rootBounds: getGitHistoryDebugRect(entry.rootBounds),
          })),
          root: getGitHistoryDebugElementSnapshot(root),
        });
        if (entries.some((entry) => entry.isIntersecting)) {
          requestMoreHistory();
        }
      },
      {
        root,
        rootMargin: `${HISTORY_LOAD_THRESHOLD_PX}px 0px`,
        threshold: 0,
      }
    );

    observer.observe(sentinel);
    debugGitHistory("observer attached", {
      root: getGitHistoryDebugElementSnapshot(root),
      sentinel: getGitHistoryDebugElementSnapshot(sentinel),
      ancestors: getGitHistoryScrollAncestors(root),
    });
    return () => {
      observer.disconnect();
      debugGitHistory("observer detached");
    };
  }, [historyExpanded, historyHasMore, requestMoreHistory]);

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
  const verifyTask = taskState.tasks.find(
    (task) => task.kind === "verify" || task.id === latestVerifyRun?.taskId
  );

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

  const rerunVerify = async () => {
    if (!verifyTask) {
      pushToast({
        kind: "info",
        title: t("tasks.title"),
        body: t("tasks.no_verify_task"),
      });
      return null;
    }

    const result = await dispatch<TaskRun>("task.rerun", {
      workspaceId,
      taskId: verifyTask.id,
      themeBackground,
    });
    if (!result.ok || !result.data) {
      pushToast({
        kind: "error",
        title: t("tasks.run_failed_title"),
        body: result.error?.message ?? t("tasks.run_failed_body"),
      });
      return null;
    }

    setTaskState((previous) => ({
      ...previous,
      runs: [result.data!, ...previous.runs.filter((run) => run.taskId !== verifyTask.id)],
    }));
    return result.data;
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
        <div className="git-panel-scroll" ref={scrollRootRef} onScroll={handleGitPanelScroll}>
          {latestVerifyRun ? (
            <div
              className={`git-verification-banner git-verification-banner--${latestVerifyRun.status}`}
            >
              <span>
                {t("tasks.verification_status", {
                  status: t(`tasks.status_${latestVerifyRun.status}`),
                })}
              </span>
              <button type="button" onClick={() => setCommandSidePanelOpen(true)}>
                {t("tasks.view_tasks")}
              </button>
              <button type="button" onClick={() => void rerunVerify()}>
                {t("tasks.rerun_verify")}
              </button>
            </div>
          ) : null}

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

          <GitChangeSection
            expanded={stagedExpanded}
            group={stagedGroup}
            isLoading={isLoading}
            mobile={isMobile}
            sectionLabel={stagedSectionLabel}
            selectedPath={diffPreview?.path ?? null}
            title={t("git.staged")}
            workspaceId={workspaceId}
            emptyTitle={t("git.no_changes")}
            actions={
              stagedCount > 0 ? (
                <Tooltip content={t("git.unstage_all")}>
                  <IconButton
                    aria-label={t("git.unstage_all")}
                    className="git-panel-section-action-icon"
                    icon={<Minus size={12} />}
                    onClick={() => void handleUnstageAll()}
                    size="sm"
                    variant="ghost"
                  />
                </Tooltip>
              ) : null
            }
            onToggleExpanded={() =>
              setPanelState((current) => ({
                ...current,
                stagedExpanded: !current.stagedExpanded,
              }))
            }
            onViewDiff={openDiff}
            onRunMutation={runGitMutation}
            onRequestDiscard={handleRequestDiscardSingle}
          />

          {mergeChangesCount > 0 ? (
            <GitChangeSection
              expanded={mergeChangesExpanded}
              group={mergeChangesGroup}
              isLoading={isLoading}
              mobile={isMobile}
              sectionLabel={mergeChangesSectionLabel}
              selectedPath={diffPreview?.path ?? null}
              title={t("git.merge_changes")}
              workspaceId={workspaceId}
              emptyTitle={t("git.no_changes")}
              onToggleExpanded={() =>
                setPanelState((current) => ({
                  ...current,
                  mergeChangesExpanded: !current.mergeChangesExpanded,
                }))
              }
              onViewDiff={openDiff}
              onRunMutation={runGitMutation}
              onRequestDiscard={handleRequestDiscardSingle}
            />
          ) : null}

          <GitChangeSection
            expanded={changesExpanded}
            group={changesGroup}
            isLoading={isLoading}
            mobile={isMobile}
            sectionLabel={changesSectionLabel}
            selectedPath={diffPreview?.path ?? null}
            title={t("git.changes")}
            workspaceId={workspaceId}
            emptyTitle={t("git.no_changes")}
            actions={
              <>
                {unstagedCount > 0 ? (
                  <Tooltip content={t("git.stage_all")}>
                    <IconButton
                      aria-label={t("git.stage_all")}
                      className="git-panel-section-action-icon"
                      icon={<Plus size={12} />}
                      onClick={() => void handleStageAll()}
                      size="sm"
                      variant="ghost"
                    />
                  </Tooltip>
                ) : null}
                {unstagedCount > 0 ? (
                  <Tooltip content={t("git.discard_all")}>
                    <IconButton
                      aria-label={t("git.discard_all")}
                      className="git-panel-section-action-icon"
                      icon={<RotateCcw size={12} />}
                      onClick={handleDiscardAll}
                      size="sm"
                      variant="ghost"
                    />
                  </Tooltip>
                ) : null}
              </>
            }
            onToggleExpanded={() =>
              setPanelState((current) => ({
                ...current,
                changesExpanded: !current.changesExpanded,
              }))
            }
            onViewDiff={openDiff}
            onRunMutation={runGitMutation}
            onRequestDiscard={handleRequestDiscardSingle}
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
              <div className="git-panel-section-body git-panel-section-body--history">
                {historyLoading && history.length === 0 ? (
                  <GitPanelEmptyState title={t("common.loading")} />
                ) : history.length === 0 ? (
                  <GitPanelEmptyState title={t("git.no_commits")} />
                ) : (
                  <>
                    {history.map((entry, index) => (
                      <GitHistoryRow
                        key={entry.sha}
                        entry={entry}
                        isCurrent={index === 0}
                        locale={locale}
                        onOpen={openHistoryDiff}
                      />
                    ))}
                    {historyHasMore || historyPageLoading ? (
                      <div
                        aria-hidden={!historyPageLoading}
                        className="git-history-load-sentinel"
                        ref={historyLoadSentinelRef}
                      >
                        {historyPageLoading ? (
                          <span className="git-history-load-status">{t("common.loading")}</span>
                        ) : null}
                      </div>
                    ) : null}
                  </>
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

interface GitChangeSectionProps {
  expanded: boolean;
  group: { title: string; changes: GitPanelChangeItem[] };
  isLoading: boolean;
  mobile: boolean;
  sectionLabel: string;
  title: string;
  emptyTitle: string;
  actions?: ReactNode;
  selectedPath: string | null;
  workspaceId: string;
  onToggleExpanded: () => void;
  onRequestDiscard: (path: string) => void;
  onRunMutation: (
    op: "git.stage" | "git.unstage" | "git.discard" | "git.commit",
    args: Record<string, unknown>,
    errorMessage: string,
    errorTitle: string,
    afterSuccess?: () => void
  ) => Promise<boolean>;
  onViewDiff: (change: GitFileChange, type: GitChangeType) => Promise<void>;
}

const GitChangeSection: FC<GitChangeSectionProps> = ({
  expanded,
  group,
  isLoading,
  mobile,
  sectionLabel,
  title,
  emptyTitle,
  actions,
  selectedPath,
  workspaceId,
  onToggleExpanded,
  onRequestDiscard,
  onRunMutation,
  onViewDiff,
}) => {
  const t = useTranslation();
  const changes = group.changes;
  const totalCount = changes.length;

  return (
    <section className="git-panel-section git-panel-section-changes">
      <div className="git-panel-section-header">
        <button
          type="button"
          className="git-panel-section-toggle"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          aria-label={sectionLabel}
        >
          <span className="git-panel-section-chevron">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
          <span>{title}</span>
          <span className="git-panel-section-count">{totalCount}</span>
        </button>
        <div className="git-panel-section-actions">{actions ?? null}</div>
      </div>

      {expanded ? (
        <div className="git-panel-section-body git-panel-section-body--changes">
          {totalCount === 0 ? (
            <GitPanelEmptyState title={isLoading ? t("common.loading") : emptyTitle} />
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
      ) : null}
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
          {dirName ? <span className="git-row-dir">{dirName}</span> : null}
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

  if (type === "conflicted") {
    return "conflicted";
  }

  return "modified";
}

function getChangeSemantic(change: GitFileChange, type: GitChangeType) {
  const status = getResolvedChangeStatus(change, type);

  switch (status) {
    case "deleted":
      return "git.status.deleted";
    case "conflicted":
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
    case "conflicted":
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
    case "conflicted":
      return "!";
    case "modified":
    default:
      return "M";
  }
}

export default GitPanel;
