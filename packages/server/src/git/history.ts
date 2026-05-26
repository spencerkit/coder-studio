import type {
  GitCommitDetail,
  GitCommitFileEntry,
  GitCommitSummary,
  GitFileDiffPayload,
} from "@coder-studio/core";
import { getImageTypeInfo } from "../fs/image.js";
import { runGit } from "./cli.js";
import { buildHistoricalImageDiffPayload, buildHistoricalTextDiffPayload } from "./diff.js";

const EMPTY_TREE_SHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

interface CommitMetadata extends GitCommitSummary {
  parentSha?: string;
}

function toRenderMode(path: string): "text" | "image" {
  return getImageTypeInfo(path) ? "image" : "text";
}

function mapNameStatus(statusToken: string): Exclude<GitCommitFileEntry["status"], "untracked"> {
  const code = statusToken[0];
  switch (code) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
    case "C":
      return "renamed";
    default:
      return "modified";
  }
}

async function getCommitMetadata(cwd: string, sha: string): Promise<CommitMetadata> {
  const { stdout } = await runGit(cwd, [
    "show",
    "-s",
    "--format=%H%x1f%h%x1f%s%x1f%an%x1f%at%x1f%P",
    "--no-color",
    "--end-of-options",
    sha,
  ]);
  const [fullSha = "", shortSha = "", subject = "", authorName = "", authoredAt = "0", parents] =
    stdout.trimEnd().split("\x1f");
  return {
    sha: fullSha,
    shortSha,
    subject,
    authorName,
    authoredAt: Number.parseInt(authoredAt, 10) * 1000,
    parentSha: parents ? parents.split(" ")[0] : undefined,
  };
}

async function getCommitChangedFiles(cwd: string, sha: string): Promise<GitCommitFileEntry[]> {
  const { stdout } = await runGit(cwd, [
    "diff-tree",
    "--no-commit-id",
    "--root",
    "--name-status",
    "-M",
    "-r",
    "-z",
    sha,
  ]);
  const records = stdout.split("\0").filter((record) => record.length > 0);
  const files: GitCommitFileEntry[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const statusToken = records[index];
    if (!statusToken) {
      continue;
    }

    const status = mapNameStatus(statusToken);
    if (status === "renamed") {
      const oldPath = records[index + 1];
      const path = records[index + 2];
      if (!oldPath || !path) {
        break;
      }

      files.push({
        path,
        oldPath,
        status,
        renderAs: toRenderMode(path),
      });
      index += 2;
      continue;
    }

    const path = records[index + 1];
    if (!path) {
      break;
    }

    files.push({
      path,
      status,
      renderAs: toRenderMode(path),
    });
    index += 1;
  }

  return files;
}

function uniquePathspecs(...paths: Array<string | undefined>): string[] {
  return [...new Set(paths.filter((value): value is string => Boolean(value)))];
}

async function getCommitDiffForPaths(
  cwd: string,
  sha: string,
  parentSha: string | undefined,
  pathspecs: string[]
): Promise<string> {
  const baseRevision = parentSha ?? EMPTY_TREE_SHA;
  const args = [
    "diff",
    "--find-renames",
    "--no-color",
    "--no-ext-diff",
    baseRevision,
    sha,
    "--",
    ...pathspecs,
  ];
  const { stdout } = await runGit(cwd, args);
  return stdout;
}

function resolveCommitFileEntry(
  files: GitCommitFileEntry[],
  args: { path: string; oldPath?: string }
): GitCommitFileEntry | undefined {
  return (
    files.find((file) => file.path === args.path && file.oldPath === args.oldPath) ??
    files.find((file) => file.path === args.path) ??
    (args.oldPath ? files.find((file) => file.oldPath === args.oldPath) : undefined)
  );
}

export async function getGitCommitDetail(cwd: string, sha: string): Promise<GitCommitDetail> {
  const [commit, files] = await Promise.all([
    getCommitMetadata(cwd, sha),
    getCommitChangedFiles(cwd, sha),
  ]);
  return {
    commit,
    files,
  };
}

export async function getGitCommitFileDiff(
  cwd: string,
  args: { sha: string; path: string; oldPath?: string }
): Promise<GitFileDiffPayload> {
  const detail = await getGitCommitDetail(cwd, args.sha);
  const entry = resolveCommitFileEntry(detail.files, args);
  const originalPath = args.oldPath ?? entry?.oldPath ?? args.path;
  const modifiedPath = args.path;
  const diff = await getCommitDiffForPaths(
    cwd,
    args.sha,
    detail.commit.parentSha,
    uniquePathspecs(originalPath, modifiedPath)
  );
  const originalRevision = detail.commit.parentSha ?? EMPTY_TREE_SHA;
  const modifiedRevision = args.sha;

  if ((entry?.renderAs ?? toRenderMode(modifiedPath)) === "image") {
    return buildHistoricalImageDiffPayload({
      cwd,
      diff,
      originalPath,
      modifiedPath,
      originalRevision,
      modifiedRevision,
    });
  }

  return buildHistoricalTextDiffPayload({
    cwd,
    diff,
    originalPath,
    modifiedPath,
    originalRevision,
    modifiedRevision,
  });
}
