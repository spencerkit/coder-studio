import { randomUUID } from "node:crypto";

export type PreviewKind = "markdown" | "html";

export interface PreviewSessionRecord {
  id: string;
  workspaceId: string;
  entryPath: string;
  kind: PreviewKind;
  content: string;
  revision: number;
  updatedAt: number;
  allowScripts: boolean;
}

export interface CreatePreviewSessionInput {
  workspaceId: string;
  entryPath: string;
  kind: PreviewKind;
  content: string;
  allowScripts?: boolean;
}

export interface UpdatePreviewSessionInput {
  content?: string;
  allowScripts?: boolean;
}

export class PreviewSessionStore {
  #sessions = new Map<string, PreviewSessionRecord>();

  create(input: CreatePreviewSessionInput): PreviewSessionRecord {
    const record: PreviewSessionRecord = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      entryPath: input.entryPath,
      kind: input.kind,
      content: input.content,
      revision: 1,
      updatedAt: Date.now(),
      allowScripts: input.allowScripts ?? false,
    };

    this.#sessions.set(record.id, record);
    return record;
  }

  get(id: string): PreviewSessionRecord | null {
    return this.#sessions.get(id) ?? null;
  }

  update(id: string, patch: UpdatePreviewSessionInput): PreviewSessionRecord | null {
    const current = this.#sessions.get(id);
    if (!current) {
      return null;
    }

    const next: PreviewSessionRecord = {
      ...current,
      content: patch.content ?? current.content,
      allowScripts: patch.allowScripts ?? current.allowScripts,
      revision: current.revision + 1,
      updatedAt: Date.now(),
    };

    this.#sessions.set(id, next);
    return next;
  }

  delete(id: string): boolean {
    return this.#sessions.delete(id);
  }

  cleanupExpiredSessions(now = Date.now(), maxAgeMs = 30 * 60 * 1000): number {
    let removed = 0;

    for (const [id, session] of this.#sessions) {
      if (now - session.updatedAt > maxAgeMs) {
        this.#sessions.delete(id);
        removed += 1;
      }
    }

    return removed;
  }
}
