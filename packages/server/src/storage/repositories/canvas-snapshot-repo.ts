import type { CanvasDocumentEnvelope, CanvasSnapshotDataResponse } from "@coder-studio/core";
import { readJsonFile, writeJsonFileAtomic } from "./json-file-store.js";

export interface CanvasSnapshotRecord extends CanvasSnapshotDataResponse {
  source: CanvasDocumentEnvelope;
}

interface CanvasSnapshotRepoOptions {
  filePath: string;
}

export class CanvasSnapshotRepo {
  constructor(private readonly options: CanvasSnapshotRepoOptions) {}

  get(snapshotId: string): CanvasSnapshotRecord | undefined {
    const snapshots =
      readJsonFile<Record<string, CanvasSnapshotRecord>>(this.options.filePath) ?? {};
    return snapshots[snapshotId];
  }

  upsert(record: CanvasSnapshotRecord): CanvasSnapshotRecord {
    const snapshots =
      readJsonFile<Record<string, CanvasSnapshotRecord>>(this.options.filePath) ?? {};
    snapshots[record.snapshotId] = record;
    writeJsonFileAtomic(this.options.filePath, snapshots);
    return record;
  }
}
