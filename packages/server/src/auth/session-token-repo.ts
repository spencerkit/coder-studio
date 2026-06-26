import { randomBytes } from "node:crypto";
import type { AutomationPermission } from "@coder-studio/core";

export interface SessionAutomationTokenRecord {
  token: string;
  sessionId: string;
  workspaceId: string;
  providerId: string;
  permissions: readonly AutomationPermission[];
  createdAt: number;
}

export interface IssueSessionAutomationTokenInput {
  sessionId: string;
  workspaceId: string;
  providerId: string;
  permissions: readonly AutomationPermission[];
}

export class SessionTokenRepo {
  private readonly recordsByToken = new Map<string, SessionAutomationTokenRecord>();
  private readonly tokensBySessionId = new Map<string, Set<string>>();

  issue(input: IssueSessionAutomationTokenInput): SessionAutomationTokenRecord {
    const record: SessionAutomationTokenRecord = {
      token: randomBytes(32).toString("hex"),
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      providerId: input.providerId,
      permissions: [...input.permissions],
      createdAt: Date.now(),
    };

    this.recordsByToken.set(record.token, record);
    const tokens = this.tokensBySessionId.get(record.sessionId) ?? new Set<string>();
    tokens.add(record.token);
    this.tokensBySessionId.set(record.sessionId, tokens);
    return record;
  }

  get(token: string): SessionAutomationTokenRecord | undefined {
    return this.recordsByToken.get(token);
  }

  listBySessionId(sessionId: string): SessionAutomationTokenRecord[] {
    const tokens = this.tokensBySessionId.get(sessionId);
    if (!tokens) {
      return [];
    }

    return Array.from(tokens)
      .map((token) => this.recordsByToken.get(token))
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
    return true;
  }

  revokeBySessionId(sessionId: string): void {
    const tokens = this.tokensBySessionId.get(sessionId);
    if (!tokens) {
      return;
    }

    for (const token of tokens) {
      this.recordsByToken.delete(token);
    }
    this.tokensBySessionId.delete(sessionId);
  }
}
