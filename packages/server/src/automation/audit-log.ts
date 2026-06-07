import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export interface AutomationAuditRecordInput {
  workspaceId?: string;
  sessionId?: string;
  providerId?: string;
  commandName: string;
  riskLevel: "read" | "write" | "dangerous";
  decision: "allowed" | "denied" | "approval_required";
  success: boolean;
  args?: Record<string, unknown>;
}

export interface AutomationAuditLogDeps {
  filePath: string;
  now?: () => number;
}

export class AutomationAuditLog {
  constructor(private readonly deps: AutomationAuditLogDeps) {}

  async append(input: AutomationAuditRecordInput): Promise<void> {
    await mkdir(dirname(this.deps.filePath), { recursive: true });
    const record = {
      timestamp: this.deps.now?.() ?? Date.now(),
      ...input,
      args: sanitizeArgs(input.args ?? {}),
    };
    await appendFile(this.deps.filePath, `${JSON.stringify(record)}\n`, "utf8");
  }
}

function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => [
      key,
      /token|password|secret|apiKey|apikey|authorization/i.test(key) ? "[redacted]" : value,
    ])
  );
}
