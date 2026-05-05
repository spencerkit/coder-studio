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
});
