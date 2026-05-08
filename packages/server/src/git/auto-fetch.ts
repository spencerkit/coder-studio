import type { EventBus } from "../bus/event-bus.js";
import type { SettingsRepo } from "../storage/repositories/settings-repo.js";
import type { WorkspaceManager } from "../workspace/manager.js";

const PERIOD_SETTING_KEY = "git.autofetchPeriodSec";
const DEFAULT_PERIOD_SEC = 180;
const TICK_INTERVAL_MS = 1_000;
const OPEN_TIME_COOLDOWN_MS = 5 * 60 * 1_000;
const MAX_CONSECUTIVE_FAILURES = 3;
const JITTER_RATIO = 0.1;

export interface AutoFetchRuntime {
  registerViewer(clientId: string, workspaceId: string): void;
  unregisterViewer(clientId: string): void;
  triggerOpenTimeFetch(workspaceId: string): void;
  recordSuccess(workspaceId: string): void;
  recordFailure(workspaceId: string): void;
  getLastFetchAt(workspaceId: string): number | undefined;
  runExclusive?<T>(workspaceId: string, op: () => Promise<T>): Promise<T>;
  start(): void;
  stop(): void;
}

export interface AutoFetchDeps {
  workspaceMgr: Pick<WorkspaceManager, "get">;
  eventBus: EventBus;
  settingsRepo: Pick<SettingsRepo, "get">;
  runFetch: (workspaceId: string) => Promise<void>;
  now?: () => number;
  random?: () => number;
  setTimeout?: typeof globalThis.setTimeout;
  setInterval?: typeof globalThis.setInterval;
  clearInterval?: typeof globalThis.clearInterval;
  clearTimeout?: typeof globalThis.clearTimeout;
}

interface WorkspaceFetchState {
  viewerCount: number;
  lastFetchAt?: number;
  consecutiveFailures: number;
  inFlight: boolean;
  blocked: boolean;
  nextFetchAt?: number;
  waiters: Array<() => void>;
}

export class AutoFetchScheduler implements AutoFetchRuntime {
  private readonly clientWorkspaceMap = new Map<string, string>();
  private readonly workspaceStateMap = new Map<string, WorkspaceFetchState>();
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly setTimeoutFn: typeof globalThis.setTimeout;
  private readonly setIntervalFn: typeof globalThis.setInterval;
  private readonly clearIntervalFn: typeof globalThis.clearInterval;
  private readonly clearTimeoutFn: typeof globalThis.clearTimeout;
  private readonly pendingTimeouts = new Set<ReturnType<typeof setTimeout>>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(private readonly deps: AutoFetchDeps) {
    this.now = deps.now ?? Date.now;
    this.random = deps.random ?? (() => 0.5);
    this.setTimeoutFn = deps.setTimeout ?? globalThis.setTimeout;
    this.setIntervalFn = deps.setInterval ?? globalThis.setInterval;
    this.clearIntervalFn = deps.clearInterval ?? globalThis.clearInterval;
    this.clearTimeoutFn = deps.clearTimeout ?? globalThis.clearTimeout;
    this.start();
  }

  registerViewer(clientId: string, workspaceId: string): void {
    const previousWorkspaceId = this.clientWorkspaceMap.get(clientId);
    if (previousWorkspaceId === workspaceId) {
      return;
    }

    if (previousWorkspaceId) {
      this.unregisterViewer(clientId);
    }

    this.clientWorkspaceMap.set(clientId, workspaceId);

    const state = this.getOrCreateState(workspaceId);
    state.viewerCount += 1;
    if (state.viewerCount === 1) {
      state.blocked = false;
      state.consecutiveFailures = 0;
    }

    this.ensureNextPeriodicFetch(state, false);
  }

  unregisterViewer(clientId: string): void {
    const workspaceId = this.clientWorkspaceMap.get(clientId);
    if (!workspaceId) {
      return;
    }

    this.clientWorkspaceMap.delete(clientId);

    const state = this.workspaceStateMap.get(workspaceId);
    if (!state) {
      return;
    }

    state.viewerCount = Math.max(0, state.viewerCount - 1);
    if (state.viewerCount === 0) {
      state.blocked = false;
      state.consecutiveFailures = 0;
      state.nextFetchAt = undefined;
    }
  }

  triggerOpenTimeFetch(workspaceId: string): void {
    const state = this.getOrCreateState(workspaceId);
    const lastFetchAt = state.lastFetchAt;

    if (this.stopped || state.inFlight) {
      return;
    }

    if (lastFetchAt !== undefined && this.now() - lastFetchAt < OPEN_TIME_COOLDOWN_MS) {
      return;
    }

    const timer = this.setTimeoutFn(() => {
      this.pendingTimeouts.delete(timer);
      if (this.stopped) {
        return;
      }
      void this.fetchWorkspace(workspaceId, "open");
    }, 0);
    this.pendingTimeouts.add(timer);
  }

  recordSuccess(workspaceId: string): void {
    const state = this.getOrCreateState(workspaceId);
    state.lastFetchAt = this.now();
    state.consecutiveFailures = 0;
    state.blocked = false;
    state.nextFetchAt = undefined;
    this.ensureNextPeriodicFetch(state, true);
  }

  recordFailure(workspaceId: string): void {
    const state = this.getOrCreateState(workspaceId);
    state.consecutiveFailures += 1;
    state.nextFetchAt = undefined;

    if (state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      state.blocked = true;
      return;
    }

    this.ensureNextPeriodicFetch(state, true);
  }

  getLastFetchAt(workspaceId: string): number | undefined {
    return this.workspaceStateMap.get(workspaceId)?.lastFetchAt;
  }

  async runExclusive<T>(workspaceId: string, op: () => Promise<T>): Promise<T> {
    const release = await this.acquireWorkspaceOperation(workspaceId);
    try {
      return await op();
    } finally {
      release();
    }
  }

  start(): void {
    if (this.tickTimer) {
      return;
    }

    this.stopped = false;
    this.tickTimer = this.setIntervalFn(() => {
      this.evaluateDueFetches();
    }, TICK_INTERVAL_MS);
  }

  stop(): void {
    if (this.tickTimer) {
      this.clearIntervalFn(this.tickTimer);
      this.tickTimer = null;
    }

    this.stopped = true;
    for (const timer of this.pendingTimeouts) {
      this.clearTimeoutFn(timer);
    }
    this.pendingTimeouts.clear();
  }

  private evaluateDueFetches(): void {
    const now = this.now();

    for (const [workspaceId, state] of this.workspaceStateMap) {
      if (!this.shouldCheckWorkspace(state)) {
        continue;
      }

      if (state.nextFetchAt === undefined) {
        this.ensureNextPeriodicFetch(state, false);
      }

      if (state.nextFetchAt === undefined || state.nextFetchAt > now) {
        continue;
      }

      void this.fetchWorkspace(workspaceId, "periodic", state.nextFetchAt);
    }
  }

  private shouldCheckWorkspace(state: WorkspaceFetchState): boolean {
    return this.getPeriodMs() > 0 && state.viewerCount > 0 && !state.inFlight && !state.blocked;
  }

  private ensureNextPeriodicFetch(state: WorkspaceFetchState, resetSchedule: boolean): void {
    const periodMs = this.getPeriodMs();
    if (periodMs <= 0 || state.viewerCount <= 0 || state.blocked || state.inFlight) {
      return;
    }

    if (!resetSchedule && state.nextFetchAt !== undefined) {
      return;
    }

    if (state.lastFetchAt === undefined) {
      state.nextFetchAt = this.now();
      return;
    }

    const nextFetchAt = state.lastFetchAt + this.getJitteredPeriodMs(periodMs);
    state.nextFetchAt = Math.max(this.now(), nextFetchAt);
  }

  private getPeriodMs(): number {
    const configuredPeriodSec = this.deps.settingsRepo.get<number>(PERIOD_SETTING_KEY);
    const periodSec = configuredPeriodSec ?? DEFAULT_PERIOD_SEC;
    return Math.max(0, periodSec) * 1_000;
  }

  private getJitteredPeriodMs(periodMs: number): number {
    const jitterScale = 1 + (this.random() - 0.5) * 2 * JITTER_RATIO;
    return Math.round(periodMs * jitterScale);
  }

  private getOrCreateState(workspaceId: string): WorkspaceFetchState {
    const existingState = this.workspaceStateMap.get(workspaceId);
    if (existingState) {
      return existingState;
    }

    const state: WorkspaceFetchState = {
      viewerCount: 0,
      consecutiveFailures: 0,
      inFlight: false,
      blocked: false,
      waiters: [],
    };
    this.workspaceStateMap.set(workspaceId, state);
    return state;
  }

  private async fetchWorkspace(
    workspaceId: string,
    mode: "open" | "periodic",
    scheduledAt?: number
  ): Promise<void> {
    if (this.stopped) {
      return;
    }

    const state = this.getOrCreateState(workspaceId);
    if (state.inFlight || state.blocked) {
      return;
    }

    if (!this.deps.workspaceMgr.get(workspaceId)) {
      state.nextFetchAt = undefined;
      return;
    }

    await this.runExclusive(workspaceId, async () => {
      const currentState = this.getOrCreateState(workspaceId);
      if (this.stopped || currentState.blocked) {
        return;
      }

      if (!this.deps.workspaceMgr.get(workspaceId)) {
        currentState.nextFetchAt = undefined;
        return;
      }

      if (mode === "open") {
        const lastFetchAt = currentState.lastFetchAt;
        if (lastFetchAt !== undefined && this.now() - lastFetchAt < OPEN_TIME_COOLDOWN_MS) {
          return;
        }
      } else if (
        scheduledAt !== undefined &&
        currentState.lastFetchAt !== undefined &&
        currentState.lastFetchAt >= scheduledAt
      ) {
        return;
      }

      try {
        await this.deps.runFetch(workspaceId);
        this.recordSuccess(workspaceId);
      } catch {
        this.recordFailure(workspaceId);
      }
    });
  }

  private acquireWorkspaceOperation(workspaceId: string): Promise<() => void> {
    const state = this.getOrCreateState(workspaceId);

    return new Promise((resolve) => {
      const grant = () => {
        state.inFlight = true;
        state.nextFetchAt = undefined;

        let released = false;
        resolve(() => {
          if (released) {
            return;
          }
          released = true;

          const next = state.waiters.shift();
          if (next) {
            next();
            return;
          }

          state.inFlight = false;
          this.ensureNextPeriodicFetch(state, true);
        });
      };

      if (state.inFlight) {
        state.waiters.push(grant);
        return;
      }

      grant();
    });
  }
}
