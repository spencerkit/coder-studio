// Supervisor domain types (PRD §16)

export type SupervisorState = "inactive" | "idle" | "evaluating" | "injecting" | "paused" | "error";

export type CycleStatus = "queued" | "evaluating" | "completed" | "injected" | "failed";

export type CycleTrigger = "turn_completed" | "manual";

export type EvidenceSource = "headless_snapshot" | "transcript" | "terminal_fallback";

export interface SupervisorCycle {
  id: string;
  supervisorId: string;
  sessionId: string;
  status: CycleStatus;
  trigger: CycleTrigger;
  evidenceSource: EvidenceSource;
  objective: string;
  evaluatorProviderId: string;
  turnId?: string;
  progress?: number;
  result?: string;
  injectedGuidance?: string;
  createdAt: number;
  completedAt?: number;
  errorReason?: string;
}

export interface Supervisor {
  id: string;
  sessionId: string;
  workspaceId: string;
  state: SupervisorState;
  objective: string;
  evaluatorProviderId: string;
  cycles: SupervisorCycle[];
  lastCycleAt?: number;
  lastEvaluatedTurnId?: string;
  errorReason?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SupervisorConfig {
  maxCyclesPerSession: number;
  terminalLinesForEvaluation: number;
  guidanceMaxChars: number;
  guidanceDedupeWindow: number;
}

export const DEFAULT_SUPERVISOR_EVALUATION_TIMEOUT_SEC = 600;
export const MAX_SUPERVISOR_EVALUATION_TIMEOUT_SEC = 86_400;

export function resolveSupervisorEvaluationTimeoutSec(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isSafeInteger(value)) {
    return DEFAULT_SUPERVISOR_EVALUATION_TIMEOUT_SEC;
  }

  if (value < 1 || value > MAX_SUPERVISOR_EVALUATION_TIMEOUT_SEC) {
    return DEFAULT_SUPERVISOR_EVALUATION_TIMEOUT_SEC;
  }

  return value;
}

export const DEFAULT_SUPERVISOR_CONFIG: SupervisorConfig = {
  maxCyclesPerSession: 100,
  terminalLinesForEvaluation: 500,
  guidanceMaxChars: 2000,
  guidanceDedupeWindow: 2,
};
