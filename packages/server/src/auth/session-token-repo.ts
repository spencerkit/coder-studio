import { randomBytes } from "node:crypto";
import type { AutomationPermission } from "@coder-studio/core";

export type SessionAutomationTokenMode = "loopback_runtime" | "remote_runtime";

export interface SessionAutomationTokenRecord {
  token: string;
  sessionId: string;
  workspaceId: string;
  providerId: string;
  permissions: readonly AutomationPermission[];
  mode: SessionAutomationTokenMode;
  runtimeId?: string;
  createdAt: number;
  expiresAt?: number;
}

export interface IssueSessionAutomationTokenInput {
  sessionId: string;
  workspaceId: string;
  providerId: string;
  permissions: readonly AutomationPermission[];
  mode?: SessionAutomationTokenMode;
  runtimeId?: string;
  ttlMs?: number;
}

export class SessionTokenRepo {
  private readonly recordsByToken = new Map<string, SessionAutomationTokenRecord>();
  private readonly tokensBySessionId = new Map<string, Set<string>>();
  private readonly tokensByRuntimeId = new Map<string, Set<string>>();

  issue(input: IssueSessionAutomationTokenInput): SessionAutomationTokenRecord {
    if (input.mode === "remote_runtime" && !input.runtimeId) {
      throw new Error("runtimeId is required for remote_runtime session tokens");
    }

    const createdAt = Date.now();
    const record: SessionAutomationTokenRecord = {
      token: randomBytes(32).toString("hex"),
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      providerId: input.providerId,
      permissions: [...input.permissions],
      mode: input.mode ?? "loopback_runtime",
      runtimeId: input.runtimeId,
      createdAt,
      expiresAt: typeof input.ttlMs === "number" ? Math.max(0, input.ttlMs) + createdAt : undefined,
    };

    this.recordsByToken.set(record.token, record);
    const tokens = this.tokensBySessionId.get(record.sessionId) ?? new Set<string>();
    tokens.add(record.token);
    this.tokensBySessionId.set(record.sessionId, tokens);
    if (record.runtimeId) {
      const runtimeTokens = this.tokensByRuntimeId.get(record.runtimeId) ?? new Set<string>();
      runtimeTokens.add(record.token);
      this.tokensByRuntimeId.set(record.runtimeId, runtimeTokens);
    }
    return record;
  }

  get(token: string): SessionAutomationTokenRecord | undefined {
    const record = this.recordsByToken.get(token);
    if (!record) {
      return undefined;
    }

    if (record.expiresAt !== undefined && record.expiresAt <= Date.now()) {
      this.revoke(token);
      return undefined;
    }

    return record;
  }

  listBySessionId(sessionId: string): SessionAutomationTokenRecord[] {
    const tokens = this.tokensBySessionId.get(sessionId);
    if (!tokens) {
      return [];
    }

    return Array.from(tokens)
      .map((token) => this.get(token))
      .filter((record): record is SessionAutomationTokenRecord => record !== undefined);
  }

  revoke(token: string): boolean {
    const record = this.recordsByToken.get(token);
    if (!record) {
      return false;
    }

    this.recordsByToken.delete(token);
    const tokens = this.tokensBySessionId.get(record.sessionId);
    if (!tokens) {
      return true;
    }

    tokens.delete(token);
    if (tokens.size === 0) {
      this.tokensBySessionId.delete(record.sessionId);
    }
    if (record.runtimeId) {
      const runtimeTokens = this.tokensByRuntimeId.get(record.runtimeId);
      runtimeTokens?.delete(token);
      if (runtimeTokens?.size === 0) {
        this.tokensByRuntimeId.delete(record.runtimeId);
      }
    }
    return true;
  }

  revokeBySessionId(sessionId: string): void {
    const tokens = this.tokensBySessionId.get(sessionId);
    if (!tokens) {
      return;
    }

    for (const token of tokens) {
      this.revoke(token);
    }
  }

  revokeByRuntimeId(runtimeId: string): void {
    const tokens = this.tokensByRuntimeId.get(runtimeId);
    if (!tokens) {
      return;
    }

    for (const token of tokens) {
      this.revoke(token);
    }
  }
}
