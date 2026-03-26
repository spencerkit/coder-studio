import type { Translator } from "../../i18n";
import type { FilePreview, Tab, TreeNode } from "../../state/workbench";
import { previewFile, saveFile } from "../../services/http/file.service";
import { getGitDiff } from "../../services/http/git.service";
import { computeDiffStats } from "../../shared/utils/diff";
import { fileParentLabel, resolvePath } from "../../shared/utils/path";
import type { Toast } from "../../types/app";

type UpdateTab = (tabId: string, updater: (tab: Tab) => Tab) => void;
type WithServiceFallback = <T>(operation: () => Promise<T>, fallback: T) => Promise<T>;

type LoadWorkspaceFilePreviewArgs = {
  tab: Tab;
  node: TreeNode;
  updateTab: UpdateTab;
  withServiceFallback: WithServiceFallback;
  t: Translator;
};

export const loadWorkspaceFilePreview = async ({
  tab,
  node,
  updateTab,
  withServiceFallback,
  t,
}: LoadWorkspaceFilePreviewArgs) => {
  const path = resolvePath(tab.project?.path, node.path);
  const preview = await withServiceFallback<FilePreview>(() => previewFile(path), {
    path: node.path,
    content: t("previewUnavailable"),
    mode: "preview",
  });
  updateTab(tab.id, (currentTab) => ({
    ...currentTab,
    filePreview: {
      ...currentTab.filePreview,
      path: preview.path || node.path,
      content: preview.content || t("previewUnavailable"),
      mode: "preview",
      originalContent: "",
      modifiedContent: "",
      dirty: false,
      source: "tree",
      statusLabel: node.status,
      parentPath: fileParentLabel(preview.path || node.path),
      section: undefined,
      diff: undefined,
    },
  }));
};

type OpenWorkspacePreviewPathArgs = {
  tab: Tab;
  path: string;
  updateTab: UpdateTab;
  withServiceFallback: WithServiceFallback;
  t: Translator;
  options?: {
    statusLabel?: string;
    parentPath?: string;
  };
};

export const openWorkspacePreviewPath = async ({
  tab,
  path,
  updateTab,
  withServiceFallback,
  t,
  options,
}: OpenWorkspacePreviewPathArgs) => {
  const preview = await withServiceFallback<FilePreview>(() => previewFile(path), {
    path,
    content: t("previewUnavailable"),
    mode: "preview",
  });
  updateTab(tab.id, (currentTab) => ({
    ...currentTab,
    filePreview: {
      ...currentTab.filePreview,
      path: preview.path || path,
      content: preview.content || t("previewUnavailable"),
      mode: "preview",
      originalContent: "",
      modifiedContent: "",
      dirty: false,
      source: "tree",
      statusLabel: options?.statusLabel ?? currentTab.filePreview.statusLabel,
      parentPath: options?.parentPath ?? fileParentLabel(preview.path || path),
      section: undefined,
      diff: undefined,
    },
  }));
};

type LoadWorkspaceRepositoryDiffArgs = {
  tab: Tab;
  updateTab: UpdateTab;
  withServiceFallback: WithServiceFallback;
};

export const loadWorkspaceRepositoryDiff = async ({
  tab,
  updateTab,
  withServiceFallback,
}: LoadWorkspaceRepositoryDiffArgs) => {
  const target = tab.project?.target ?? { type: "native" as const };
  const path = tab.project?.path ?? "";
  const diff = await withServiceFallback<string>(() => getGitDiff(path, target), "");
  const stats = computeDiffStats(diff);
  updateTab(tab.id, (currentTab) => ({
    ...currentTab,
    filePreview: {
      ...currentTab.filePreview,
      mode: "diff",
      diff,
      originalContent: "",
      modifiedContent: "",
      diffStats: { files: stats.files, additions: stats.additions, deletions: stats.deletions },
      diffFiles: stats.diffFiles,
      dirty: currentTab.filePreview.dirty,
    },
  }));
};

type SaveWorkspacePreviewArgs = {
  tab: Tab;
  activeSessionId: string;
  updateTab: UpdateTab;
  withServiceFallback: WithServiceFallback;
  refreshWorkspaceArtifacts: (tabId: string) => Promise<unknown>;
  addToast: (toast: Toast) => void;
  t: Translator;
  createToastId: () => string;
};

export const saveWorkspacePreview = async ({
  tab,
  activeSessionId,
  updateTab,
  withServiceFallback,
  refreshWorkspaceArtifacts,
  addToast,
  t,
  createToastId,
}: SaveWorkspacePreviewArgs) => {
  const preview = tab.filePreview;
  if (!preview.path || !preview.dirty) return false;
  const saved = await withServiceFallback<FilePreview | null>(
    () => saveFile(tab.id, tab.controller, preview.path, preview.content),
    null,
  );
  if (!saved) return false;

  updateTab(tab.id, (currentTab) => ({
    ...currentTab,
    filePreview: {
      ...currentTab.filePreview,
      path: saved.path,
      content: saved.content,
      dirty: false,
    },
  }));
  await refreshWorkspaceArtifacts(tab.id);
  addToast({ id: createToastId(), text: `${t("saved")}: ${saved.path}`, sessionId: activeSessionId });
  return true;
};
