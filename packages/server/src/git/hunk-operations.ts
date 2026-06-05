import type { GitHunkOperation } from "@coder-studio/core";
import { runGit } from "./cli.js";
import { getFileDiff } from "./diff.js";
import { buildSingleHunkPatch } from "./hunks.js";

function gitApplyArgs(operation: GitHunkOperation["operation"], staged: boolean): string[] {
  if (operation === "stage" && !staged) {
    return ["apply", "--cached", "--unidiff-zero"];
  }

  if (operation === "unstage" && staged) {
    return ["apply", "--cached", "--reverse", "--unidiff-zero"];
  }

  if (operation === "discard" && !staged) {
    return ["apply", "--reverse", "--unidiff-zero"];
  }

  throw {
    code: "git_hunk_operation_invalid",
    message: `Invalid hunk operation ${operation} for ${staged ? "staged" : "unstaged"} diff`,
  };
}

export async function applyGitHunkOperation(
  cwd: string,
  operation: GitHunkOperation
): Promise<void> {
  const diff = await getFileDiff(cwd, operation.path, operation.staged);
  if (diff.renderAs !== "text") {
    throw {
      code: "git_hunk_not_text",
      message: "Hunk operations are only available for text diffs",
    };
  }

  const patch = buildSingleHunkPatch(diff.diff, operation.hunkId, {
    path: operation.path,
    staged: operation.staged,
  });
  if (!patch) {
    throw {
      code: "git_hunk_stale",
      message: "Diff changed. Refresh and try again.",
    };
  }

  const args = gitApplyArgs(operation.operation, operation.staged);
  await runGit(cwd, [...args, "--check"], { stdin: patch });
  await runGit(cwd, args, { stdin: patch });
}
