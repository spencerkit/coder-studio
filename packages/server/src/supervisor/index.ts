/**
 * Supervisor module exports (Phase 3)
 */

export { SupervisorManager } from './manager.js';
export type { SupervisorManagerDeps, CreateSupervisorRequest, UpdateSupervisorRequest } from './manager.js';
export { evaluateProgress, type EvaluationResult } from './evaluator.js';
export { injectGuidance } from './injector.js';
export { SupervisorScheduler } from './scheduler.js';
