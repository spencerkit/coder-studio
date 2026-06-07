/**
 * Git diff operations.
 */

import type { GitDiffHunk, GitFileDiffPayload, GitRevisionSource } from "@coder-studio/core";
import { mkdtemp, readFile, rm } from "fs/promises";
import os from "os";
import path from "path";
import { resolveSafe } from "../fs/file-io.js";
import { getImageTypeInfo } from "../fs/image.js";
import { GitError, runGit } from "./cli.js";
import { parseDiffHunks } from "./hunks.js";

export interface FileDiffResult {
  diff: string;
  renderAs: "text" | "image";
  status: "modified" | "added" | "deleted";
  originalContent?: string;
  modifiedContent?: string;
  originalRevision?: "HEAD" | "INDEX";
  modifiedRevision?: "INDEX" | "WORKTREE";
  mime?: string;
  originalPath?: string;
  modifiedPath?: string;
  hunks?: GitDiffHunk[];
}

interface HistoricalDiffInput {
  cwd: string;
  diff: string;
  originalPath?: string;
  modifiedPath?: string;
  originalRevision?: GitRevisionSource;
  modifiedRevision?: GitRevisionSource;
}

async function isTrackedPath(cwd: string, filePath: string): Promise<boolean> {
  try {
    await runGit(cwd, ["ls-files", "--error-unmatch", "--", filePath]);
    return true;
  } catch {
    return false;
  }
}

async function getUntrackedFileDiff(cwd: string, filePath: string): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "coder-studio-git-diff-"));
  const tempIndex = path.join(tempDir, "index");

  try {
    try {
      await runGit(cwd, ["read-tree", "HEAD"], {
        env: { GIT_INDEX_FILE: tempIndex },
      });
    } catch (error) {
      if (!(error instanceof GitError)) {
        throw error;
      }

      // Fresh repositories may not have HEAD yet; an empty temporary index is
      // sufficient for intent-to-add diffs in that case.
      await runGit(cwd, ["read-tree", "--empty"], {
        env: { GIT_INDEX_FILE: tempIndex },
      });
    }

    await runGit(cwd, ["add", "-N", "--", filePath], {
      env: { GIT_INDEX_FILE: tempIndex },
    });

    const result = await runGit(cwd, ["diff", "--", filePath], {
      env: { GIT_INDEX_FILE: tempIndex },
    });
    return result.stdout;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function pathExists(cwd: string, filePath: string): Promise<boolean> {
  try {
    await readFile(resolveSafe(cwd, filePath));
    return true;
  } catch {
    return false;
  }
}

function toGitSpec(revision: GitRevisionSource, filePath: string): string {
  return revision === "INDEX" ? `:${filePath}` : `${revision}:${filePath}`;
}

export async function pathExistsAtGitRevision(
  cwd: string,
  revision: GitRevisionSource,
  filePath: string
): Promise<boolean> {
  if (revision === "WORKTREE") {
    return pathExists(cwd, filePath);
  }

  try {
    await runGit(cwd, ["cat-file", "-e", toGitSpec(revision, filePath)]);
    return true;
  } catch {
    return false;
  }
}

export async function readTextAtGitRevision(
  cwd: string,
  revision: GitRevisionSource,
  filePath: string
): Promise<string> {
  if (revision === "WORKTREE") {
    return readFile(resolveSafe(cwd, filePath), "utf-8");
  }

  try {
    const result = await runGit(cwd, ["show", toGitSpec(revision, filePath)]);
    return result.stdout;
  } catch {
    return "";
  }
}

function deriveHistoricalStatus(
  originalExists: boolean,
  modifiedExists: boolean
): "modified" | "added" | "deleted" {
  if (!originalExists && modifiedExists) {
    return "added";
  }

  if (originalExists && !modifiedExists) {
    return "deleted";
  }

  return "modified";
}

export async function buildHistoricalTextDiffPayload(
  input: HistoricalDiffInput
): Promise<GitFileDiffPayload> {
  const originalExists =
    Boolean(input.originalPath) &&
    Boolean(input.originalRevision) &&
    (await pathExistsAtGitRevision(
      input.cwd,
      input.originalRevision as GitRevisionSource,
      input.originalPath as string
    ));
  const modifiedExists =
    Boolean(input.modifiedPath) &&
    Boolean(input.modifiedRevision) &&
    (await pathExistsAtGitRevision(
      input.cwd,
      input.modifiedRevision as GitRevisionSource,
      input.modifiedPath as string
    ));
  const status = deriveHistoricalStatus(originalExists, modifiedExists);

  return {
    diff: input.diff,
    renderAs: "text",
    status,
    ...(input.originalPath ? { originalPath: input.originalPath } : {}),
    ...(input.modifiedPath ? { modifiedPath: input.modifiedPath } : {}),
    originalContent:
      originalExists && input.originalPath && input.originalRevision
        ? await readTextAtGitRevision(input.cwd, input.originalRevision, input.originalPath)
        : "",
    modifiedContent:
      modifiedExists && input.modifiedPath && input.modifiedRevision
        ? await readTextAtGitRevision(input.cwd, input.modifiedRevision, input.modifiedPath)
        : "",
    ...(input.originalRevision ? { originalRevision: input.originalRevision } : {}),
    ...(input.modifiedRevision ? { modifiedRevision: input.modifiedRevision } : {}),
  };
}

export async function buildHistoricalImageDiffPayload(
  input: HistoricalDiffInput
): Promise<GitFileDiffPayload> {
  const imagePath = input.modifiedPath ?? input.originalPath;
  const imageType = imagePath ? getImageTypeInfo(imagePath) : null;
  if (!imageType) {
    throw { code: "not_an_image", message: "File is not an image" };
  }

  const originalExists =
    Boolean(input.originalPath) &&
    Boolean(input.originalRevision) &&
    (await pathExistsAtGitRevision(
      input.cwd,
      input.originalRevision as GitRevisionSource,
      input.originalPath as string
    ));
  const modifiedExists =
    Boolean(input.modifiedPath) &&
    Boolean(input.modifiedRevision) &&
    (await pathExistsAtGitRevision(
      input.cwd,
      input.modifiedRevision as GitRevisionSource,
      input.modifiedPath as string
    ));

  return {
    diff: input.diff,
    renderAs: "image",
    status: deriveHistoricalStatus(originalExists, modifiedExists),
    mime: imageType.mime,
    ...(originalExists && input.originalPath ? { originalPath: input.originalPath } : {}),
    ...(modifiedExists && input.modifiedPath ? { modifiedPath: input.modifiedPath } : {}),
    ...(input.originalRevision ? { originalRevision: input.originalRevision } : {}),
    ...(input.modifiedRevision ? { modifiedRevision: input.modifiedRevision } : {}),
  };
}

async function deriveFileDiffStatus(
  cwd: string,
  filePath: string,
  staged: boolean
): Promise<"modified" | "added" | "deleted"> {
  const tracked = await isTrackedPath(cwd, filePath);
  const existsOnDisk = await pathExists(cwd, filePath);

  if (!staged && !tracked) {
    return "added";
  }

  if (staged) {
    try {
      await runGit(cwd, ["cat-file", "-e", `HEAD:${filePath}`]);
      return existsOnDisk ? "modified" : "deleted";
    } catch {
      return "added";
    }
  }

  return existsOnDisk ? "modified" : "deleted";
}

async function buildTextDiffResult(
  cwd: string,
  filePath: string,
  staged: boolean,
  diff: string
): Promise<FileDiffResult> {
  const payload = await buildHistoricalTextDiffPayload({
    cwd,
    diff,
    originalPath: filePath,
    modifiedPath: filePath,
    originalRevision: staged ? "HEAD" : "INDEX",
    modifiedRevision: staged ? "INDEX" : "WORKTREE",
  });
  const status = await deriveFileDiffStatus(cwd, filePath, staged);
  return {
    diff: payload.diff,
    renderAs: payload.renderAs,
    status,
    originalContent: payload.originalContent,
    modifiedContent: payload.modifiedContent,
    hunks: parseDiffHunks({ diff: payload.diff, path: filePath, staged }),
  };
}

function buildImageDiffResult(
  filePath: string,
  imageMime: string,
  status: "modified" | "added" | "deleted",
  originalRevision: "HEAD" | "INDEX",
  modifiedRevision: "INDEX" | "WORKTREE",
  diff: string
): FileDiffResult {
  return {
    diff,
    renderAs: "image",
    status,
    originalRevision,
    modifiedRevision,
    mime: imageMime,
    originalPath: status === "added" ? undefined : filePath,
    modifiedPath: status === "deleted" ? undefined : filePath,
  };
}

/**
 * Gets diff for a specific file.
 *
 * @param cwd - Working directory
 * @param path - File path (relative to cwd)
 * @param staged - Whether to show staged diff
 * @returns Diff output
 */
export async function getFileDiff(
  cwd: string,
  path: string,
  staged = false
): Promise<FileDiffResult> {
  const imageType = getImageTypeInfo(path);

  if (!staged && !(await isTrackedPath(cwd, path))) {
    const diff = await getUntrackedFileDiff(cwd, path);
    if (imageType) {
      return buildImageDiffResult(path, imageType.mime, "added", "HEAD", "WORKTREE", diff);
    }

    return buildTextDiffResult(cwd, path, staged, diff);
  }

  const args = staged ? ["diff", "--staged", "--", path] : ["diff", "--", path];
  const result = await runGit(cwd, args);
  if (imageType && /Binary files .* differ/.test(result.stdout)) {
    return buildImageDiffResult(
      path,
      imageType.mime,
      await deriveFileDiffStatus(cwd, path, staged),
      staged ? "HEAD" : "INDEX",
      staged ? "INDEX" : "WORKTREE",
      result.stdout
    );
  }

  return buildTextDiffResult(cwd, path, staged, result.stdout);
}

/**
 * Gets full diff for the working directory.
 *
 * @param cwd - Working directory
 * @param staged - Whether to show staged diff
 * @returns Diff output
 */
export async function getDiff(cwd: string, staged = false): Promise<string> {
  const args = staged ? ["diff", "--staged"] : ["diff"];
  const result = await runGit(cwd, args);
  return result.stdout;
}
