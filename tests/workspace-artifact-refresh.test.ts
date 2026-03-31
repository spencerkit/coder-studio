import test from "node:test";
import assert from "node:assert/strict";
import {
  FULL_ARTIFACT_REFRESH_SCOPE,
  mergeArtifactRefreshScopes,
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
