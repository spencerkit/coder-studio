export interface ManagedProcessRoot {
  ownerId: string;
  rootPid: number;
  kind: "server" | "terminal" | "session_helper" | "lsp" | "installer" | "background";
  label: string;
  workspaceId?: string;
  sessionId?: string;
  terminalId?: string;
  providerId?: string;
  startedAt: number;
}

export interface MonitoringCollectorTelemetry {
  processRowCount: number;
  subprocessGroupCount: number;
  historyTrimmed: boolean;
  degraded: boolean;
  failureReason?: string;
}

export interface ProcessStatRow {
  pid: number;
  ppid: number;
  cpuPercent: number | null;
  rssBytes: number | null;
  elapsedSec?: number;
  command?: string;
  executable?: string;
}
