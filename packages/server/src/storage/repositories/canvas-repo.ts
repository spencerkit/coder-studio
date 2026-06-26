import { rmSync } from "node:fs";
import { join } from "node:path";
import type { CanvasRecord } from "@coder-studio/core";
import { readJsonFile, writeJsonFileAtomic } from "./json-file-store.js";

interface CanvasRepoOptions {
  rootDir: string;
}

interface CanvasWorkspaceFile {
  version: 1;
  workspaceId: string;
  canvases: Record<string, CanvasRecord>;
}

function emptyWorkspaceFile(workspaceId: string): CanvasWorkspaceFile {
  return {
    version: 1,
    workspaceId,
    canvases: {},
  };
}

export class CanvasRepo {
  constructor(private readonly options: CanvasRepoOptions) {}

  list(workspaceId: string): CanvasRecord[] {
    return Object.values(this.readWorkspaceFile(workspaceId).canvases).sort(
      (left, right) => right.updatedAt - left.updatedAt
    );
  }

  get(workspaceId: string, canvasId: string): CanvasRecord | undefined {
    return this.readWorkspaceFile(workspaceId).canvases[canvasId];
  }

  upsert(record: CanvasRecord): CanvasRecord {
    const file = this.readWorkspaceFile(record.workspaceId);
    file.canvases[record.id] = record;
    this.writeWorkspaceFile(file);
    return record;
  }

  delete(workspaceId: string, canvasId: string): void {
    const file = this.readWorkspaceFile(workspaceId);
    delete file.canvases[canvasId];
    this.writeWorkspaceFile(file);
  }

  removeWorkspace(workspaceId: string): void {
    rmSync(this.filePath(workspaceId), { force: true });
  }

  private readWorkspaceFile(workspaceId: string): CanvasWorkspaceFile {
    return (
      readJsonFile<CanvasWorkspaceFile>(this.filePath(workspaceId)) ??
      emptyWorkspaceFile(workspaceId)
    );
  }

  private writeWorkspaceFile(file: CanvasWorkspaceFile): void {
    writeJsonFileAtomic(this.filePath(file.workspaceId), file);
  }

  private filePath(workspaceId: string): string {
    return join(this.options.rootDir, `${encodeURIComponent(workspaceId)}.json`);
  }
}
