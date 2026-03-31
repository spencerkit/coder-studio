import test from "node:test";
import assert from "node:assert/strict";
import {
  FULL_ARTIFACT_REFRESH_SCOPE,
  mergeArtifactRefreshScopes,
  resolveInitialArtifactRefreshScope,
  resolveArtifactRefreshScope,
} from "../apps/web/src/features/workspace/workspace-artifact-refresh.ts";

test("resolveArtifactRefreshScope falls back to a full refresh when categories are missing", () => {
  assert.deepEqual(
    resolveArtifactRefreshScope({ reason: "file_watcher" }),
    FULL_ARTIFACT_REFRESH_SCOPE,
  );
});

test("resolveArtifactRefreshScope keeps tree refreshes out of git-only invalidations", () => {
  assert.deepEqual(
    resolveArtifactRefreshScope({
      reason: "git_stage_all",
      categories: ["git", "worktrees"],
    }),
    {
      git: true,
      worktrees: true,
      tree: false,
    },
  );
});

test("resolveArtifactRefreshScope includes tree refreshes when categories contain tree", () => {
  assert.deepEqual(
    resolveArtifactRefreshScope({
      reason: "git_commit",
      categories: ["git", "worktrees", "tree"],
    }),
    {
      git: true,
      worktrees: true,
      tree: true,
    },
  );
});

test("mergeArtifactRefreshScopes unions refresh work across repeated invalidations", () => {
  assert.deepEqual(
    mergeArtifactRefreshScopes(
      { git: true, worktrees: false, tree: false },
      { git: false, worktrees: true, tree: true },
    ),
    {
      git: true,
      worktrees: true,
      tree: true,
    },
  );
});

test("resolveInitialArtifactRefreshScope keeps initial reloads off the full artifact path when the code panel is hidden", () => {
  assert.deepEqual(
    resolveInitialArtifactRefreshScope(false, "files"),
    {
      git: true,
      worktrees: false,
      tree: false,
    },
  );
});

test("resolveInitialArtifactRefreshScope loads the workspace tree only when the files sidebar is visible", () => {
  assert.deepEqual(
    resolveInitialArtifactRefreshScope(true, "files"),
    {
      git: true,
      worktrees: false,
      tree: true,
    },
  );
  assert.deepEqual(
    resolveInitialArtifactRefreshScope(true, "git"),
    {
      git: true,
      worktrees: false,
      tree: false,
    },
  );
});
