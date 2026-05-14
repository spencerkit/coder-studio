// Supervisor domain types (PRD §16)

export type SupervisorState =
  | "inactive"
  | "idle"
  | "evaluating"
  | "injecting"
  | "paused"
  | "error"
  | "stopped";

export type CycleStatus =
  | "queued"
  | "evaluating"
  | "completed"
  | "injected"
  | "failed"
  | "cancelled";

export type CycleTrigger = "turn_completed" | "manual" | "scheduled";

export type SupervisorStopReason =
  | "objective_complete"
  | "max_supervision_count_reached"
  | "supervisor_uncertain"
  | "needs_user_input";

export type SupervisorPlanStepStatus = "pending" | "in_progress" | "done";

export interface SupervisorPlanStep {
  id: string;
  title: string;
  status: SupervisorPlanStepStatus;
}

export interface SupervisorTargetMemory {
  targetId: string;
  planGenerated: boolean;
  plan: SupervisorPlanStep[];
  activeStepId?: string;
  progressSummary?: string;
  lastGuidance?: string;
  stalledCount: number;
  updatedAt: number;
}

export interface SupervisorCycleStepUpdate {
  id: string;
  status: SupervisorPlanStepStatus;
}

export interface SupervisorCycleTargetRecord {
  cycleId: string;
  targetId: string;
  startedAt: number;
  completedAt: number;
  result: "continue" | "stop" | "error";
  stopReason?: "objective_complete" | "supervisor_uncertain" | "needs_user_input";
  reason?: string;
  guidance?: string;
  progressSummary?: string;
  activeStepId?: string;
  stepUpdates?: SupervisorCycleStepUpdate[];
  injected?: boolean;
  attemptCount?: number;
  errorReason?: string;
}

export type SupervisorCycleAttemptStatus = "evaluating" | "completed" | "failed" | "cancelled";

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

export interface SupervisorCycleAttempt {
  id: string;
  cycleId: string;
  attemptIndex: number;
  status: SupervisorCycleAttemptStatus;
  startedAt: number;
  completedAt?: number;
  errorReason?: string;
  providerModel?: string;
}

export interface SupervisorCycleAttemptPatch {
  status?: SupervisorCycleAttemptStatus;
  completedAt?: number | null;
  errorReason?: string | null;
  providerModel?: string | null;
}

export interface Supervisor {
  id: string;
  sessionId: string;
  workspaceId: string;
  targetId: string;
  state: SupervisorState;
  objective: string;
  evaluatorProviderId: string;
  evaluatorModel?: string;
  maxSupervisionCount: number;
  completedSupervisionCount: number;
  scheduledAt?: number;
  stopReason?: SupervisorStopReason;
  currentTargetMemory?: SupervisorTargetMemory;
  recentTargetCycles?: SupervisorCycleTargetRecord[];
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
export const DEFAULT_SUPERVISOR_RETRY_ENABLED = false;
export const DEFAULT_SUPERVISOR_RETRY_MAX_COUNT = 0;
export const MAX_SUPERVISOR_RETRY_MAX_COUNT = 20;
export const DEFAULT_SUPERVISOR_RETRY_DELAY_SEC = 10;
export const MAX_SUPERVISOR_RETRY_DELAY_SEC = 3_600;
export const DEFAULT_SUPERVISOR_RETRY_ON_TIMEOUT = true;
export const DEFAULT_SUPERVISOR_RETRY_ON_EVALUATOR_ERROR = false;

export function resolveSupervisorEvaluationTimeoutSec(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isSafeInteger(value)) {
    return DEFAULT_SUPERVISOR_EVALUATION_TIMEOUT_SEC;
  }

  if (value < 1 || value > MAX_SUPERVISOR_EVALUATION_TIMEOUT_SEC) {
    return DEFAULT_SUPERVISOR_EVALUATION_TIMEOUT_SEC;
  }

  return value;
}

export function resolveSupervisorRetryEnabled(value: unknown): boolean {
  return typeof value === "boolean" ? value : DEFAULT_SUPERVISOR_RETRY_ENABLED;
}

export function resolveSupervisorRetryMaxCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isSafeInteger(value)) {
    return DEFAULT_SUPERVISOR_RETRY_MAX_COUNT;
  }

  if (value < 0 || value > MAX_SUPERVISOR_RETRY_MAX_COUNT) {
    return DEFAULT_SUPERVISOR_RETRY_MAX_COUNT;
  }

  return value;
}

export function resolveSupervisorRetryDelaySec(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isSafeInteger(value)) {
    return DEFAULT_SUPERVISOR_RETRY_DELAY_SEC;
  }

  if (value < 1 || value > MAX_SUPERVISOR_RETRY_DELAY_SEC) {
    return DEFAULT_SUPERVISOR_RETRY_DELAY_SEC;
  }

  return value;
}

export function resolveSupervisorRetryOnTimeout(value: unknown): boolean {
  return typeof value === "boolean" ? value : DEFAULT_SUPERVISOR_RETRY_ON_TIMEOUT;
}

export function resolveSupervisorRetryOnEvaluatorError(value: unknown): boolean {
  return typeof value === "boolean" ? value : DEFAULT_SUPERVISOR_RETRY_ON_EVALUATOR_ERROR;
}

export const DEFAULT_SUPERVISOR_CONFIG: SupervisorConfig = {
  maxCyclesPerSession: 100,
  terminalLinesForEvaluation: 500,
  guidanceMaxChars: 2000,
  guidanceDedupeWindow: 2,
};
