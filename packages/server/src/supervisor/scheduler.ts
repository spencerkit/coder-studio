import type { DomainEvent } from "@coder-studio/core";
import type { EventBus } from "../bus/event-bus.js";

type SessionLifecycleEvent = Extract<DomainEvent, { type: "session.lifecycle" }>;

export class SupervisorScheduler {
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly deps: {
      eventBus: EventBus;
      onTurnCompleted: (sessionId: string) => void;
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

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}
