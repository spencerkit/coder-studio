import type {
  AgentSessionMetadata,
  AgentSessionVerificationRun,
  SessionActivityEntry,
} from "@coder-studio/core";
import {
  resolveWorkspaceStateFilePath,
  SESSION_METADATA_FILE_NAME,
} from "../../workspace/workspace-state.js";
import { readJsonFile, writeJsonFileAtomic } from "./json-file-store.js";

interface SessionMetadataFileRecord {
  version: 1;
  metadata: Record<string, AgentSessionMetadata>;
}

interface SessionMetadataWorkspace {
  id: string;
  path: string;
}

interface SessionMetadataWorkspaceLookup {
  list(): SessionMetadataWorkspace[];
  get(workspaceId: string): SessionMetadataWorkspace | undefined;
}

export interface SessionMetadataRepoOptions {
  workspaceLookup?: SessionMetadataWorkspaceLookup;
  workspaceRepo?: {
    list(): SessionMetadataWorkspace[];
    findById(id: string): SessionMetadataWorkspace | undefined;
  };
}

interface SessionMetadataLocation {
  workspace: SessionMetadataWorkspace;
  fileMetadata: Record<string, AgentSessionMetadata>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeRun(run: AgentSessionVerificationRun): AgentSessionVerificationRun {
  return {
    ...run,
  };
}

function normalizeActivityEntry(entry: SessionActivityEntry): SessionActivityEntry {
  return {
    ...entry,
  };
}

function normalizeMetadata(metadata: AgentSessionMetadata): AgentSessionMetadata {
  return {
    sessionId: metadata.sessionId,
    workspaceId: metadata.workspaceId,
    providerId: metadata.providerId,
    ...(metadata.objective !== undefined ? { objective: metadata.objective } : {}),
    ...(metadata.baselineGitHead !== undefined
      ? { baselineGitHead: metadata.baselineGitHead }
      : {}),
    ...(metadata.baselineCapturedAt !== undefined
      ? { baselineCapturedAt: metadata.baselineCapturedAt }
      : {}),
    verificationRuns: metadata.verificationRuns.map(normalizeRun),
    activityEntries: (metadata.activityEntries ?? []).map(normalizeActivityEntry),
    ...(metadata.attachedAgentInstructions
      ? {
          attachedAgentInstructions: {
            effectiveHash: metadata.attachedAgentInstructions.effectiveHash,
            mode: metadata.attachedAgentInstructions.mode,
            attachedAt: metadata.attachedAgentInstructions.attachedAt,
          },
        }
      : {}),
  };
}

function normalizeFileMetadata(value: unknown): Record<string, AgentSessionMetadata> {
  if (isRecord(value) && value.version === 1 && isRecord(value.metadata)) {
    return Object.fromEntries(
      Object.entries(value.metadata).map(([sessionId, metadata]) => [
        sessionId,
        normalizeMetadata(metadata as AgentSessionMetadata),
      ])
    );
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([sessionId, metadata]) => [
        sessionId,
        normalizeMetadata(metadata as AgentSessionMetadata),
      ])
    );
  }

  return {};
}

export class SessionMetadataRepo {
  private readonly workspaceLookup: SessionMetadataWorkspaceLookup;

  constructor(input: SessionMetadataRepoOptions) {
    if (input.workspaceLookup) {
      this.workspaceLookup = input.workspaceLookup;
      return;
    }

    if (input.workspaceRepo) {
      this.workspaceLookup = {
        list: () => input.workspaceRepo!.list(),
        get: (workspaceId: string) => input.workspaceRepo!.findById(workspaceId),
      };
      return;
    }

    throw new Error("SessionMetadataRepo requires workspaceLookup or workspaceRepo");
  }

  upsert(metadata: AgentSessionMetadata): AgentSessionMetadata {
    const normalized = normalizeMetadata(metadata);
    const workspace = this.workspaceLookup.get(normalized.workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found for session metadata: ${normalized.workspaceId}`);
    }

    const existing = this.findSessionLocation(normalized.sessionId);
    if (existing && existing.workspace.id !== workspace.id) {
      delete existing.fileMetadata[normalized.sessionId];
      this.saveWorkspaceFileMetadata(existing.workspace.path, existing.fileMetadata);
    }

    const next =
      existing && existing.workspace.id === workspace.id
        ? existing.fileMetadata
        : this.loadWorkspaceFileMetadata(workspace.path);
    next[normalized.sessionId] = normalized;
    this.saveWorkspaceFileMetadata(workspace.path, next);
    return next[normalized.sessionId]!;
  }

  get(sessionId: string): AgentSessionMetadata | undefined {
    return this.findSessionLocation(sessionId)?.fileMetadata[sessionId];
  }

  addVerificationRun(sessionId: string, run: AgentSessionVerificationRun): AgentSessionMetadata {
    const existing = this.findSessionLocation(sessionId);
    if (!existing) {
      throw new Error(`Session metadata not found: ${sessionId}`);
    }

    existing.fileMetadata[sessionId] = normalizeMetadata({
      ...existing.fileMetadata[sessionId]!,
      verificationRuns: [...existing.fileMetadata[sessionId]!.verificationRuns, normalizeRun(run)],
    });
    this.saveWorkspaceFileMetadata(existing.workspace.path, existing.fileMetadata);
    return existing.fileMetadata[sessionId]!;
  }

  addActivityEntry(sessionId: string, entry: SessionActivityEntry): AgentSessionMetadata {
    const existing = this.findSessionLocation(sessionId);
    if (!existing) {
      throw new Error(`Session metadata not found: ${sessionId}`);
    }

    existing.fileMetadata[sessionId] = normalizeMetadata({
      ...existing.fileMetadata[sessionId]!,
      activityEntries: [
        ...existing.fileMetadata[sessionId]!.activityEntries,
        normalizeActivityEntry(entry),
      ],
    });
    this.saveWorkspaceFileMetadata(existing.workspace.path, existing.fileMetadata);
    return existing.fileMetadata[sessionId]!;
  }

  delete(sessionId: string): void {
    this.deleteFromAnyWorkspace(sessionId);
  }

  private findSessionLocation(sessionId: string): SessionMetadataLocation | undefined {
    for (const workspace of this.workspaceLookup.list()) {
      const fileMetadata = this.loadWorkspaceFileMetadata(workspace.path);
      if (Object.prototype.hasOwnProperty.call(fileMetadata, sessionId)) {
        return {
          workspace,
          fileMetadata,
        };
      }
    }

    return undefined;
  }

  deleteFromAnyWorkspace(sessionId: string): boolean {
    const existing = this.findSessionLocation(sessionId);
    if (!existing) {
      return false;
    }

    delete existing.fileMetadata[sessionId];
    this.saveWorkspaceFileMetadata(existing.workspace.path, existing.fileMetadata);
    return true;
  }

  private loadWorkspaceFileMetadata(workspacePath: string): Record<string, AgentSessionMetadata> {
    const parsed = readJsonFile<SessionMetadataFileRecord | Record<string, AgentSessionMetadata>>(
      resolveWorkspaceStateFilePath(workspacePath, SESSION_METADATA_FILE_NAME)
    );
    if (parsed !== undefined) {
      return normalizeFileMetadata(parsed);
    }

    return {};
  }

  private saveWorkspaceFileMetadata(
    workspacePath: string,
    metadata: Record<string, AgentSessionMetadata>
  ): void {
    const payload: SessionMetadataFileRecord = {
      version: 1,
      metadata,
    };
    writeJsonFileAtomic(
      resolveWorkspaceStateFilePath(workspacePath, SESSION_METADATA_FILE_NAME),
      payload
    );
  }
}
