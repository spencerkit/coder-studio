import { describe, expect, it, vi } from "vitest";
import { EventBus } from "../bus/event-bus.js";
import { SupervisorScheduler } from "./scheduler.js";

describe("SupervisorScheduler", () => {
  it("only reacts to session.lifecycle turn_completed", () => {
    const eventBus = new EventBus();
    const onTurnCompleted = vi.fn();
    const scheduler = new SupervisorScheduler({ eventBus, onTurnCompleted });

    scheduler.start();
    eventBus.emit({
      type: "session.lifecycle",
      workspaceId: "ws-1",
      sessionId: "sess-1",
      event: "started",
    });
    eventBus.emit({
      type: "session.lifecycle",
      workspaceId: "ws-1",
      sessionId: "sess-1",
      event: "turn_completed",
    });

    expect(onTurnCompleted).toHaveBeenCalledTimes(1);
    expect(onTurnCompleted).toHaveBeenCalledWith("sess-1");
  });

  it("fires the nearest scheduled supervisor once it becomes due", async () => {
    vi.useFakeTimers();
    const eventBus = new EventBus();
    const onScheduledDue = vi.fn();
    const base = Date.now();
    const scheduled = [
      { supervisorId: "sup-later", scheduledAt: base + 10_000 },
      { supervisorId: "sup-soon", scheduledAt: base + 1_000 },
    ];
    const scheduler = new SupervisorScheduler({
      eventBus,
      onTurnCompleted: vi.fn(),
      listScheduledSupervisors: () => scheduled,
      onScheduledDue,
    });

    scheduler.start();
    scheduler.refresh();

    await vi.advanceTimersByTimeAsync(1_000);

    expect(onScheduledDue).toHaveBeenCalledTimes(1);
    expect(onScheduledDue).toHaveBeenCalledWith("sup-soon");
  });

  it("recomputes the next scheduled timer on refresh", async () => {
    vi.useFakeTimers();
    const eventBus = new EventBus();
    const onScheduledDue = vi.fn();
    const base = Date.now();
    let scheduled = [{ supervisorId: "sup-later", scheduledAt: base + 10_000 }];
    const scheduler = new SupervisorScheduler({
      eventBus,
      onTurnCompleted: vi.fn(),
      listScheduledSupervisors: () => scheduled,
      onScheduledDue,
    });

    scheduler.start();
    scheduler.refresh();
    scheduled = [{ supervisorId: "sup-soon", scheduledAt: base + 500 }];
    scheduler.refresh();

    await vi.advanceTimersByTimeAsync(500);

    expect(onScheduledDue).toHaveBeenCalledTimes(1);
    expect(onScheduledDue).toHaveBeenCalledWith("sup-soon");
  });

  it("does not let an overdue supervisor block other due scheduled supervisors", async () => {
    vi.useFakeTimers();
    const eventBus = new EventBus();
    const onScheduledDue = vi.fn();
    const base = Date.now();
    let scheduled = [
      { supervisorId: "sup-overdue", scheduledAt: base - 5_000 },
      { supervisorId: "sup-future", scheduledAt: base + 500 },
    ];
    const scheduler = new SupervisorScheduler({
      eventBus,
      onTurnCompleted: vi.fn(),
      listScheduledSupervisors: () => scheduled,
      onScheduledDue,
    });

    scheduler.start();
    scheduler.refresh();

    await vi.advanceTimersByTimeAsync(0);
    expect(onScheduledDue).toHaveBeenCalledWith("sup-overdue");

    await vi.advanceTimersByTimeAsync(500);
    expect(onScheduledDue).toHaveBeenCalledWith("sup-future");

    scheduled = [{ supervisorId: "sup-overdue", scheduledAt: base - 5_000 }];
  });

  it("retries overdue supervisors with a backoff without delaying future scheduled supervisors", async () => {
    vi.useFakeTimers();
    const eventBus = new EventBus();
    const onScheduledDue = vi.fn();
    const base = Date.now();
    const scheduled = [
      { supervisorId: "sup-overdue", scheduledAt: base - 5_000 },
      { supervisorId: "sup-future", scheduledAt: base + 500 },
    ];
    const scheduler = new SupervisorScheduler({
      eventBus,
      onTurnCompleted: vi.fn(),
      listScheduledSupervisors: () => scheduled,
      onScheduledDue,
    });

    scheduler.start();
    scheduler.refresh();

    await vi.advanceTimersByTimeAsync(0);
    expect(onScheduledDue).toHaveBeenCalledTimes(1);
    expect(onScheduledDue).toHaveBeenNthCalledWith(1, "sup-overdue");

    await vi.advanceTimersByTimeAsync(500);
    expect(onScheduledDue).toHaveBeenCalledTimes(2);
    expect(onScheduledDue).toHaveBeenNthCalledWith(2, "sup-future");

    await vi.advanceTimersByTimeAsync(499);
    expect(onScheduledDue).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1);
    expect(onScheduledDue).toHaveBeenCalledTimes(3);
    expect(onScheduledDue).toHaveBeenNthCalledWith(3, "sup-overdue");
  });
});
