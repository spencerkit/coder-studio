import type { DomainEvent } from "@coder-studio/core";
import type { EventBus } from "../bus/event-bus.js";

type SessionLifecycleEvent = Extract<DomainEvent, { type: "session.lifecycle" }>;

export class SupervisorScheduler {
  private unsubscribe: (() => void) | null = null;
  private scheduledTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly scheduledRetryDelayMs = 1_000;
  private readonly retryAtBySupervisorId = new Map<string, number>();

  constructor(
    private readonly deps: {
      eventBus: EventBus;
      onTurnCompleted: (sessionId: string) => void;
      listScheduledSupervisors?: () => Array<{ supervisorId: string; scheduledAt: number }>;
      onScheduledDue?: (supervisorId: string) => void;
    }
  ) {}

  start(): void {
    this.unsubscribe?.();
    this.unsubscribe = this.deps.eventBus.on(
      "session.lifecycle",
      (event: SessionLifecycleEvent) => {
        if (event.event !== "turn_completed") {
          return;
        }
        this.deps.onTurnCompleted(event.sessionId);
      }
    );
  }

  refresh(): void {
    this.clearScheduledTimer();

    const scheduled = this.deps.listScheduledSupervisors?.() ?? [];
    this.pruneRetryState(scheduled);
    if (scheduled.length === 0) {
      return;
    }

    const now = Date.now();
    const nextAt = scheduled.reduce((earliest, item) => {
      const candidate = this.getNextAttemptAt(item, now);
      return candidate < earliest ? candidate : earliest;
    }, Number.POSITIVE_INFINITY);
    if (!Number.isFinite(nextAt)) {
      return;
    }

    const delayMs = Math.max(nextAt - now, 0);
    this.scheduledTimer = setTimeout(() => {
      this.scheduledTimer = null;
      const current = this.deps.listScheduledSupervisors?.() ?? [];
      this.pruneRetryState(current);

      const dueAt = Date.now();
      const due = current.filter(
        (item) =>
          item.scheduledAt <= dueAt &&
          (this.retryAtBySupervisorId.get(item.supervisorId) ?? Number.NEGATIVE_INFINITY) <= dueAt
      );
      for (const item of due) {
        this.retryAtBySupervisorId.set(item.supervisorId, dueAt + this.scheduledRetryDelayMs);
        this.deps.onScheduledDue?.(item.supervisorId);
      }
      this.refresh();
    }, delayMs);
    this.scheduledTimer.unref?.();
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.clearScheduledTimer();
    this.retryAtBySupervisorId.clear();
  }

  private clearScheduledTimer(): void {
    if (this.scheduledTimer) {
      clearTimeout(this.scheduledTimer);
      this.scheduledTimer = null;
    }
  }

  private getNextAttemptAt(
    item: { supervisorId: string; scheduledAt: number },
    now: number
  ): number {
    if (item.scheduledAt > now) {
      return item.scheduledAt;
    }

    const retryAt = this.retryAtBySupervisorId.get(item.supervisorId);
    return retryAt && retryAt > now ? retryAt : item.scheduledAt;
  }

  private pruneRetryState(scheduled: Array<{ supervisorId: string; scheduledAt: number }>): void {
    const scheduledIds = new Set(scheduled.map((item) => item.supervisorId));
    for (const supervisorId of this.retryAtBySupervisorId.keys()) {
      if (!scheduledIds.has(supervisorId)) {
        this.retryAtBySupervisorId.delete(supervisorId);
      }
    }
  }
}
