import type { Dispatch, SetStateAction } from "react";
import type { Translator } from "../../i18n";
import { createEmptyPreview, type ExecTarget, type FilePreview, type Tab, type WorktreeInfo } from "../../state/workbench";
import { previewFile } from "../../services/http/file.service";
import {
  getGitDiffFile,
  getGitFileDiffPayload,
} from "../../services/http/git.service";
import { inspectWorktree } from "../../services/http/workspace.service";
import { computeDiffStats } from "../../shared/utils/diff";
import {
  matchesGitPreviewPath,
  resolvePath,
  sanitizeGitRelativePath,
} from "../../shared/utils/path";
import type {
  GitChangeEntry,
  GitFileDiffPayload,
  Toast,
  WorktreeDetail,
  WorktreeModalState,
  WorktreeView,
} from "../../types/app";

type UpdateTab = (tabId: string, updater: (tab: Tab) => Tab) => void;
type WithServiceFallback = <T>(operation: () => Promise<T>, fallback: T) => Promise<T>;

type LoadWorkspaceGitChangePreviewArgs = {
  tab: Tab;
  change: GitChangeEntry;
  updateTab: UpdateTab;
  withServiceFallback: WithServiceFallback;
};

export const loadWorkspaceGitChangePreview = async ({
  tab,
  change,
  updateTab,
  withServiceFallback,
}: LoadWorkspaceGitChangePreviewArgs) => {
  const relativePath = sanitizeGitRelativePath(change.path);
  const path = resolvePath(tab.project?.path, relativePath);
  let payload = await withServiceFallback<GitFileDiffPayload>(() => getGitFileDiffPayload(
    tab.project?.path ?? "",
    tab.project?.target ?? { type: "native" },
    relativePath,
    change.section,
  ), {
    original_content: "",
    modified_content: "",
    diff: "",
  });

  if (!payload.original_content && !payload.modified_content && !payload.diff) {
    const fallbackDiff = await withServiceFallback<string>(() => getGitDiffFile(
      tab.project?.path ?? "",
      tab.project?.target ?? { type: "native" },
      relativePath,
      change.section === "staged",
    ), "");

    const fallbackPreview = await withServiceFallback<FilePreview | null>(() => previewFile(path), null);
    payload = {
      original_content: "",
      modified_content: fallbackPreview?.content ?? "",
      diff: fallbackDiff,
    };
  }

  const stats = computeDiffStats(payload.diff);
  updateTab(tab.id, (currentTab) => ({
    ...currentTab,
    filePreview: {
      ...currentTab.filePreview,
      path,
      content: payload.modified_content,
      mode: "diff",
      diff: payload.diff,
      originalContent: payload.original_content,
      modifiedContent: payload.modified_content,
      diffStats: { files: stats.files, additions: stats.additions, deletions: stats.deletions },
      diffFiles: [change.path],
      dirty: false,
      source: "git",
      statusLabel: change.status,
      parentPath: change.parent,
      section: change.section,
    },
  }));

  return `${change.section}:${change.path}:${change.code}`;
};

type PerformWorkspaceGitOperationArgs = {
  tab: Tab;
  activeSessionId: string;
  selectedGitChangeKey: string;
  previewMode: "preview" | "diff";
  updateTab: UpdateTab;
  refreshWorkspaceArtifacts: (tabId: string) => Promise<unknown>;
  onSelectGitChange: (change: GitChangeEntry) => Promise<void>;
  onReloadRepositoryDiff: () => Promise<void>;
  onClearPreviewSelection: () => void;
  addToast: (toast: Toast) => void;
  t: Translator;
  createToastId: () => string;
  getCurrentTab: (tabId: string) => Tab | undefined;
  operation: () => Promise<unknown>;
};

export const performWorkspaceGitOperation = async ({
  tab,
  activeSessionId,
  selectedGitChangeKey,
  previewMode,
  updateTab,
  refreshWorkspaceArtifacts,
  onSelectGitChange,
  onReloadRepositoryDiff,
  onClearPreviewSelection,
  addToast,
  t,
  createToastId,
  getCurrentTab,
  operation,
}: PerformWorkspaceGitOperationArgs) => {
  if (!tab.project?.path) {
    addToast({ id: createToastId(), text: t("selectProjectFirst"), sessionId: activeSessionId });
    return false;
  }

  try {
    await operation();
    await refreshWorkspaceArtifacts(tab.id);
    const refreshedTab = getCurrentTab(tab.id);
    const selectedChange = refreshedTab?.gitChanges.find((change) => `${change.section}:${change.path}:${change.code}` === selectedGitChangeKey)
      ?? refreshedTab?.gitChanges.find((change) => matchesGitPreviewPath(refreshedTab?.filePreview.path || tab.filePreview.path, change.path));

    if (selectedChange) {
      await onSelectGitChange(selectedChange);
    } else if (previewMode === "diff") {
      await onReloadRepositoryDiff();
    } else if (selectedGitChangeKey) {
      onClearPreviewSelection();
      updateTab(tab.id, (currentTab) => ({
        ...currentTab,
        filePreview: createEmptyPreview(),
      }));
    }

    return true;
  } catch (error) {
    addToast({
      id: createToastId(),
      text: `${t("gitActionFailed")}: ${String(error)}`,
      sessionId: activeSessionId,
    });
    return false;
  }
};

type OpenWorkspaceWorktreeArgs = {
  tree: WorktreeInfo;
  target: ExecTarget;
  fallbackTree: Tab["fileTree"];
  fallbackChanges: Tab["changesTree"];
  setWorktreeView: Dispatch<SetStateAction<WorktreeView>>;
  setWorktreeModal: Dispatch<SetStateAction<WorktreeModalState | null>>;
  withServiceFallback: WithServiceFallback;
};

export const openWorkspaceWorktree = async ({
  tree,
  target,
  fallbackTree,
  fallbackChanges,
  setWorktreeView,
  setWorktreeModal,
  withServiceFallback,
}: OpenWorkspaceWorktreeArgs) => {
  setWorktreeView("status");
  setWorktreeModal({
    name: tree.name,
    path: tree.path,
    branch: tree.branch,
    status: tree.status,
    diff: tree.diff,
    tree: tree.tree,
    changes: tree.changes,
    loading: true,
  });

  const detail = await withServiceFallback<WorktreeDetail | null>(
    () => inspectWorktree(tree.path, target, 4),
    null,
  );

  if (!detail) {
    setWorktreeModal({
      name: tree.name,
      path: tree.path,
      branch: tree.branch,
      status: tree.status,
      diff: tree.diff ?? "",
      tree: tree.tree ?? fallbackTree,
      changes: tree.changes ?? fallbackChanges,
      loading: false,
    });
    return;
  }

  setWorktreeModal({
    name: detail.name,
    path: detail.path,
    branch: detail.branch,
    status: detail.status,
    diff: detail.diff,
    tree: detail.root.children ?? [],
    changes: detail.changes,
    loading: false,
  });
};
