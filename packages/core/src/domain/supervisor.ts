// Supervisor domain types (PRD §16)

export type SupervisorState =
  | 'inactive'
  | 'idle'
  | 'evaluating'
  | 'injecting'
  | 'paused'
  | 'error';

export type CycleStatus =
  | 'queued'
  | 'evaluating'
  | 'completed'
  | 'injected'
  | 'failed';

export interface SupervisorCycle {
  id: string;
  sessionId: string;
  supervisorId: string;
  status: CycleStatus;
  objective: string;
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
  cycles: SupervisorCycle[];
  lastCycleAt?: number;
  errorReason?: string;
  createdAt: number;
  updatedAt: number;
  intervalMs?: number;
}

export interface SupervisorConfig {
  defaultIntervalMs: number;
  maxCyclesPerSession: number;
  terminalLinesForEvaluation: number;
}

export const DEFAULT_SUPERVISOR_CONFIG: SupervisorConfig = {
  defaultIntervalMs: 60000, // 1 minute
  maxCyclesPerSession: 100,
  terminalLinesForEvaluation: 500,
};