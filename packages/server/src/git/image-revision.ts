import { execFile } from "child_process";
import { promisify } from "util";
import { getImageTypeInfo } from "../fs/image.js";
import { GitError } from "./cli.js";

const execFileAsync = promisify(execFile);
const GIT_COMMIT_REVISION_RE = /^[0-9a-fA-F]{7,64}$/;

export interface GitImageRevisionAsset {
  exists: boolean;
  mime: string;
  bytes?: Buffer;
}

export type GitImageRevisionSelector = "HEAD" | "INDEX" | string;

export function parseGitImageRevisionSelector(revision: string): GitImageRevisionSelector | null {
  return revision === "HEAD" || revision === "INDEX" || GIT_COMMIT_REVISION_RE.test(revision)
    ? revision
    : null;
}

export async function readImageAtRevision(
  cwd: string,
  revision: GitImageRevisionSelector,
  filePath: string
): Promise<GitImageRevisionAsset> {
  const imageType = getImageTypeInfo(filePath);
  if (!imageType) {
    throw { code: "not_an_image", message: "File is not an image" };
  }

  const gitSpec = revision === "INDEX" ? `:${filePath}` : `${revision}:${filePath}`;

  try {
    const { stdout } = await execFileAsync("git", ["show", gitSpec], {
      cwd,
      encoding: "buffer",
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        LC_ALL: "C",
        LANG: "C",
      },
    });

    return {
      exists: true,
      mime: imageType.mime,
      bytes: stdout,
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new GitError(error.message, "");
    }
    throw error;
  }
}
