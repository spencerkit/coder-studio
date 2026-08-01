import { join } from "node:path";
import type { CanvasOverlayDocument } from "@coder-studio/core";
import { readJsonFile, writeJsonFileAtomic } from "./json-file-store.js";

interface CanvasOverlayRepoOptions {
  rootDir: string;
}

interface CanvasOverlayWorkspaceFile {
  version: 1;
  workspaceId: string;
  overlays: Record<string, CanvasOverlayDocument>;
}

function emptyWorkspaceFile(workspaceId: string): CanvasOverlayWorkspaceFile {
  return {
    version: 1,
    workspaceId,
    overlays: {},
  };
}

export class CanvasOverlayRepo {
  constructor(private readonly options: CanvasOverlayRepoOptions) {}

  get(workspaceId: string, sourcePath: string): CanvasOverlayDocument | undefined {
    return this.readWorkspaceFile(workspaceId).overlays[sourcePath];
  }

  upsert(
    workspaceId: string,
    sourcePath: string,
    overlayDocument: CanvasOverlayDocument
  ): CanvasOverlayDocument {
    const file = this.readWorkspaceFile(workspaceId);
    file.overlays[sourcePath] = overlayDocument;
    this.writeWorkspaceFile(file);
    return overlayDocument;
  }

  private readWorkspaceFile(workspaceId: string): CanvasOverlayWorkspaceFile {
    return (
      readJsonFile<CanvasOverlayWorkspaceFile>(this.filePath(workspaceId)) ??
      emptyWorkspaceFile(workspaceId)
    );
  }

  private writeWorkspaceFile(file: CanvasOverlayWorkspaceFile): void {
    writeJsonFileAtomic(this.filePath(file.workspaceId), file);
  }

  private filePath(workspaceId: string): string {
    return join(this.options.rootDir, `${encodeURIComponent(workspaceId)}.json`);
  }
}
