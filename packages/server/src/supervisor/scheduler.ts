export type SchedulerCallback = (supervisorId: string) => void;

export class SupervisorScheduler {
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly onTick: SchedulerCallback) {}

  start(supervisorId: string, intervalMs: number): void {
    // Stop existing schedule first to prevent duplicates
    this.stop(supervisorId);

    const timer = setInterval(() => {
      this.onTick(supervisorId);
    }, intervalMs);

    this.timers.set(supervisorId, timer);
  }

  stop(supervisorId: string): void {
    const timer = this.timers.get(supervisorId);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(supervisorId);
    }
  }

  stopAll(): void {
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }
    this.timers.clear();
  }

  isRunning(supervisorId: string): boolean {
    return this.timers.has(supervisorId);
  }
}