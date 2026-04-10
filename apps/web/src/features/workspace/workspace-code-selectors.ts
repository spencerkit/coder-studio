import type { Translator } from "../../i18n";
import { matchesGitPreviewPath, normalizeComparablePath } from "../../shared/utils/path";
import type { GitChangeEntry } from "../../types/app";

type GitChangeGroupKey = "changes" | "staged" | "untracked";

export type WorkspaceGitChangeGroup = {
  key: GitChangeGroupKey;
  label: string;
  items: GitChangeEntry[];
};

export const buildWorkspaceGitChangeGroups = (
  changes: GitChangeEntry[],
  t: Translator,
): WorkspaceGitChangeGroup[] => [
  {
    key: "changes" as const,
    label: t("changes"),
    items: changes.filter((change) => change.section === "changes"),
  },
  {
    key: "staged" as const,
    label: t("stagedChanges"),
    items: changes.filter((change) => change.section === "staged"),
  },
  {
    key: "untracked" as const,
    label: t("untrackedFiles"),
    items: changes.filter((change) => change.section === "untracked"),
  },
].filter((group) => group.items.length > 0);

export const findPreviewGitChange = (
  previewPath: string,
  changes: GitChangeEntry[],
) => changes.find((change) => matchesGitPreviewPath(previewPath, change.path));

export const resolveWorkspacePreviewPathLabel = (
  previewPath: string,
  workspaceRoot?: string,
) => {
  if (!previewPath) return "";
  if (!workspaceRoot) return previewPath;

  const normalizedRoot = normalizeComparablePath(workspaceRoot);
  const normalizedPreview = normalizeComparablePath(previewPath);
  if (!normalizedPreview.startsWith(normalizedRoot)) {
    return previewPath;
  }

  const relative = previewPath.slice(workspaceRoot.length).replace(/^[/\\]+/, "");
  return relative || previewPath;
};
