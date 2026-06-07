import type { builtInProviderIds } from "@coder-studio/providers";

import type { ResolvedWorkAnalysisTimeRange } from "../types.js";

export type BuiltInProviderId = (typeof builtInProviderIds)[number];

export type WorkLogProviderStatus =
  | "supported"
  | "no_logs"
  | "missing_root"
  | "partial"
  | "unsupported";

export interface WorkLogWarning {
  code: string;
  message: string;
  sourceRef?: string;
}

export interface WorkLogEvidenceExcerpt {
  role: "user" | "assistant" | "tool" | "system" | "unknown";
  at?: number;
  text?: string;
  toolName?: string;
  commandKind?: string;
  filePath?: string;
}

export interface WorkLogEvidence {
  providerId: BuiltInProviderId;
  sessionId: string;
  workspacePath: string;
  title?: string;
  startedAt: number;
  lastActiveAt: number;
  excerpts: WorkLogEvidenceExcerpt[];
}

export type WorkLogEventType =
  | "message"
  | "tool"
  | "command"
  | "edit"
  | "git"
  | "plan"
  | "agent"
  | "usage"
  | "unknown";

export type WorkLogCanonicalEventType =
  | "session_boundary"
  | "message_turn"
  | "tool_call"
  | "tool_result"
  | "command"
  | "edit"
  | "plan"
  | "agent_spawn"
  | "git_signal"
  | "usage";

export interface WorkLogEvent {
  eventId: string;
  providerId: BuiltInProviderId;
  sessionId: string;
  workspacePath: string;
  eventType: WorkLogEventType;
  canonicalEventType: WorkLogCanonicalEventType;
  occurredAt?: number;
  timestampQuality?: "explicit" | "file_mtime" | "mixed" | "inferred";
  role?: "user" | "assistant" | "tool" | "system" | "unknown";
  modelId?: string;
  turnIdHint?: string;
  toolName?: string;
  toolCategory?: "edit" | "read" | "bash" | "task" | "search" | "mcp" | "skill" | "other";
  skillName?: string;
  commandText?: string;
  commandKind?: string;
  text?: string;
  filePath?: string;
  tokenUsage?: WorkLogUsage;
  payload?: Record<string, unknown>;
  evidence?: string[];
  rawRefs: string[];
}

export interface WorkLogSession {
  providerId: BuiltInProviderId;
  sessionId: string;
  workspacePath: string;
  startedAt: number;
  lastActiveAt: number;
  sourceRef: string;
  title?: string;
  modelId?: string;
  gitBranch?: string;
  gitCommit?: string;
  userTurnCount: number;
  assistantTurnCount: number;
  toolUseCount: number;
  usage?: WorkLogUsage;
  usageCalls?: WorkLogUsageCall[];
  usageCoverage?: WorkLogUsageCoverage;
  parseErrorCount: number;
  timestampQuality: "explicit" | "file_mtime" | "mixed";
  evidence?: WorkLogEvidence[];
  events?: WorkLogEvent[];
}

export interface WorkLogUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  reasoningOutputTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
}

export type WorkLogUsageCallKind = "assistant_message" | "token_count" | "estimated";

export interface WorkLogUsageCall {
  callId: string;
  providerId: BuiltInProviderId;
  sessionId: string;
  workspacePath: string;
  occurredAt?: number;
  modelId?: string;
  kind: WorkLogUsageCallKind;
  isEstimated?: boolean;
  usage: WorkLogUsage;
  rawRefs: string[];
}

export interface WorkLogUsageCoverage {
  hasUsage: boolean;
  callCount: number;
  callsWithTotalTokens: number;
  estimatedCallCount: number;
}

export interface WorkLogSourceRef {
  providerId: BuiltInProviderId;
  kind: "file" | "sqlite";
  path: string;
  mtimeMs?: number;
  sizeBytes?: number;
  maxUpdatedAt?: number;
}

export interface ProviderWorkLogDiscoverInput {
  workspacePaths: string[];
  timeRange: ResolvedWorkAnalysisTimeRange;
}

export interface ProviderWorkLogDiscovery {
  providerId: BuiltInProviderId;
  status: WorkLogProviderStatus;
  sessions: WorkLogSession[];
  sourceRefs: WorkLogSourceRef[];
  parseErrorCount: number;
  warnings: WorkLogWarning[];
}

export interface ProviderWorkLogSource {
  providerId: BuiltInProviderId;
  discover(input: ProviderWorkLogDiscoverInput): Promise<ProviderWorkLogDiscovery>;
}

export interface WorkLogCollection {
  sessions: WorkLogSession[];
  providers: ProviderWorkLogDiscovery[];
  sourceDigest: string;
}

export interface WorkLogCollector {
  collect(input: ProviderWorkLogDiscoverInput): Promise<WorkLogCollection>;
}
