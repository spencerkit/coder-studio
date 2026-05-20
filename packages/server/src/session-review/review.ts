import type {
  AgentSessionMetadata,
  GitChangeStatus,
  GitFileChange,
  SessionReviewSummary,
} from "@coder-studio/core";
import { GitError, runGit } from "../git/cli.js";
import { getFileDiff } from "../git/diff.js";
import { SessionMetadataRepo } from "../storage/repositories/session-metadata-repo.js";

interface SessionReviewInput {
  sessionId: string;
  workspacePath: string;
  metadataRepo: SessionMetadataRepo;
}

interface SessionReviewDiffInput extends SessionReviewInput {
  path: string;
}

const MISSING_BASELINE_WARNING = {
  code: "missing_baseline" as const,
  message: "Session baseline is missing.",
};

const NOT_GIT_REPO_WARNING = {
  code: "not_git_repo" as const,
  message: "Workspace is not a Git repository.",
};

function requireSessionMetadata(
  metadataRepo: SessionMetadataRepo,
  sessionId: string
): AgentSessionMetadata {
  const metadata = metadataRepo.get(sessionId);
  if (!metadata) {
    throw {
      code: "session_metadata_not_found",
      message: `Session metadata not found: ${sessionId}`,
    };
  }

  return metadata;
}

async function isGitRepository(workspacePath: string): Promise<boolean> {
  try {
    await runGit(workspacePath, ["rev-parse", "--git-dir"]);
    return true;
  } catch (error) {
    if (error instanceof GitError) {
      return false;
    }

    throw error;
  }
}

function compareGitChanges(a: GitFileChange, b: GitFileChange): number {
  const pathCompare = a.path.localeCompare(b.path);
  if (pathCompare !== 0) {
    return pathCompare;
  }

  return (a.oldPath ?? "").localeCompare(b.oldPath ?? "");
}

function mapGitStatus(code: string): GitChangeStatus {
  switch (code[0]) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "M":
    default:
      return "modified";
  }
}

async function listTrackedChangesSinceBaseline(
  workspacePath: string,
  baselineGitHead: string
): Promise<GitFileChange[]> {
  const { stdout } = await runGit(workspacePath, [
    "diff",
    "--name-status",
    "--find-renames",
    baselineGitHead,
    "--",
  ]);

  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const parts = line.split("\t");
      const statusCode = parts[0] ?? "M";

      if (statusCode.startsWith("R")) {
        const oldPath = parts[1];
        const path = parts[2];
        if (!oldPath || !path) {
          return null;
        }

        return {
          oldPath,
          path,
          status: "renamed" as const,
        };
      }

      const path = parts[1];
      if (!path) {
        return null;
      }

      return {
        path,
        status: mapGitStatus(statusCode),
      };
    })
    .filter((change): change is GitFileChange => change !== null)
    .sort(compareGitChanges);
}

async function listUntrackedChanges(workspacePath: string): Promise<GitFileChange[]> {
  const { stdout } = await runGit(workspacePath, ["ls-files", "--others", "--exclude-standard"]);
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((path) => ({
      path,
      status: "untracked" as const,
    }))
    .sort(compareGitChanges);
}

async function isUntrackedPath(workspacePath: string, filePath: string): Promise<boolean> {
  const { stdout } = await runGit(workspacePath, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "--",
    filePath,
  ]);

  return stdout.trim().length > 0;
}

export async function buildSessionReviewSummary(
  input: SessionReviewInput
): Promise<SessionReviewSummary> {
  const metadata = requireSessionMetadata(input.metadataRepo, input.sessionId);

  if (!metadata.baselineGitHead) {
    return {
      sessionId: metadata.sessionId,
      workspaceId: metadata.workspaceId,
      baselineGitHead: metadata.baselineGitHead,
      changedFiles: [],
      verificationRuns: metadata.verificationRuns,
      warnings: [MISSING_BASELINE_WARNING],
    };
  }

  if (!(await isGitRepository(input.workspacePath))) {
    return {
      sessionId: metadata.sessionId,
      workspaceId: metadata.workspaceId,
      baselineGitHead: metadata.baselineGitHead,
      changedFiles: [],
      verificationRuns: metadata.verificationRuns,
      warnings: [NOT_GIT_REPO_WARNING],
    };
  }

  const trackedChanges = await listTrackedChangesSinceBaseline(
    input.workspacePath,
    metadata.baselineGitHead
  );
  const trackedPaths = new Set(trackedChanges.map((change) => change.path));
  const untrackedChanges = (await listUntrackedChanges(input.workspacePath)).filter(
    (change) => !trackedPaths.has(change.path)
  );

  return {
    sessionId: metadata.sessionId,
    workspaceId: metadata.workspaceId,
    baselineGitHead: metadata.baselineGitHead,
    changedFiles: [...trackedChanges, ...untrackedChanges],
    verificationRuns: metadata.verificationRuns,
    warnings: [],
  };
}

export async function getSessionReviewDiff(input: SessionReviewDiffInput): Promise<string> {
  const metadata = requireSessionMetadata(input.metadataRepo, input.sessionId);
  if (!metadata.baselineGitHead) {
    return "";
  }

  if (!(await isGitRepository(input.workspacePath))) {
    return "";
  }

  if (await isUntrackedPath(input.workspacePath, input.path)) {
    return getFileDiff(input.workspacePath, input.path);
  }

  const { stdout } = await runGit(input.workspacePath, [
    "diff",
    metadata.baselineGitHead,
    "--",
    input.path,
  ]);
  return stdout;
}
