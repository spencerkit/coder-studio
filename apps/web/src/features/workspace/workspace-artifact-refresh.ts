import type { ArtifactsDirtyEvent } from "../../types/app";

export type ArtifactRefreshScope = {
  git: boolean;
  worktrees: boolean;
  tree: boolean;
};

export const FULL_ARTIFACT_REFRESH_SCOPE: ArtifactRefreshScope = {
  git: true,
  worktrees: true,
  tree: true,
};

const EMPTY_ARTIFACT_REFRESH_SCOPE: ArtifactRefreshScope = {
  git: false,
  worktrees: false,
  tree: false,
};

const CATEGORY_SCOPE: Record<NonNullable<ArtifactsDirtyEvent["categories"]>[number], ArtifactRefreshScope> = {
  git: {
    git: true,
    worktrees: false,
    tree: false,
  },
  worktrees: {
    git: false,
    worktrees: true,
    tree: false,
  },
  tree: {
    git: false,
    worktrees: false,
    tree: true,
  },
  full: FULL_ARTIFACT_REFRESH_SCOPE,
};

export const mergeArtifactRefreshScopes = (
  left: ArtifactRefreshScope,
  right: ArtifactRefreshScope,
): ArtifactRefreshScope => ({
  git: left.git || right.git,
  worktrees: left.worktrees || right.worktrees,
  tree: left.tree || right.tree,
});

export const hasArtifactRefreshWork = (scope: ArtifactRefreshScope) =>
  scope.git || scope.worktrees || scope.tree;

export const resolveArtifactRefreshScope = (
  event?: Pick<ArtifactsDirtyEvent, "categories" | "reason"> | null,
): ArtifactRefreshScope => {
  if (!event?.categories?.length) {
    return FULL_ARTIFACT_REFRESH_SCOPE;
  }

  return event.categories.reduce<ArtifactRefreshScope>((scope, category) => (
    mergeArtifactRefreshScopes(scope, CATEGORY_SCOPE[category] ?? FULL_ARTIFACT_REFRESH_SCOPE)
  ), EMPTY_ARTIFACT_REFRESH_SCOPE);
};

export const resolveInitialArtifactRefreshScope = (
  showCodePanel: boolean,
  codeSidebarView: "files" | "git",
): ArtifactRefreshScope => ({
  git: true,
  worktrees: false,
  tree: showCodePanel && codeSidebarView === "files",
});
