import { join } from "node:path";
import type { CanvasAnchorCommentDocument } from "@coder-studio/core";
import { readJsonFile, writeJsonFileAtomic } from "./json-file-store.js";

interface CanvasAnchorCommentRepoOptions {
  rootDir: string;
}

interface CanvasAnchorCommentWorkspaceFile {
  version: 1;
  workspaceId: string;
  commentsBySourcePath: Record<string, CanvasAnchorCommentDocument>;
}

function emptyWorkspaceFile(workspaceId: string): CanvasAnchorCommentWorkspaceFile {
  return {
    version: 1,
    workspaceId,
    commentsBySourcePath: {},
  };
}

export class CanvasAnchorCommentRepo {
  constructor(private readonly options: CanvasAnchorCommentRepoOptions) {}

  get(workspaceId: string, sourcePath: string): CanvasAnchorCommentDocument | undefined {
    return this.readWorkspaceFile(workspaceId).commentsBySourcePath[sourcePath];
  }

  upsert(
    workspaceId: string,
    sourcePath: string,
    anchorCommentDocument: CanvasAnchorCommentDocument
  ): CanvasAnchorCommentDocument {
    const file = this.readWorkspaceFile(workspaceId);
    file.commentsBySourcePath[sourcePath] = anchorCommentDocument;
    this.writeWorkspaceFile(file);
    return anchorCommentDocument;
  }

  private readWorkspaceFile(workspaceId: string): CanvasAnchorCommentWorkspaceFile {
    return (
      readJsonFile<CanvasAnchorCommentWorkspaceFile>(this.filePath(workspaceId)) ??
      emptyWorkspaceFile(workspaceId)
    );
  }

  private writeWorkspaceFile(file: CanvasAnchorCommentWorkspaceFile): void {
    writeJsonFileAtomic(this.filePath(file.workspaceId), file);
  }

  private filePath(workspaceId: string): string {
    return join(this.options.rootDir, `${encodeURIComponent(workspaceId)}.json`);
  }
}
