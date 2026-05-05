/**
 * Event Bus for Domain Events
 *
 * Implements the mixed C approach from spec §4.0:
 * - Carries Service layer semantic events only
 * - Synchronous pub/sub pattern
 * - Used for session state changes, workspace metadata, git state, fs dirty
 */

import type { DomainEvent } from "@coder-studio/core";

export type Unsubscribe = () => void;
export type EventHandler<E extends DomainEvent = DomainEvent> = (event: E) => void;

export class EventBus {
  private handlers = new Map<DomainEvent["type"], Set<EventHandler>>();

  /**
   * Emit a domain event to all subscribers
   * Synchronously calls all handlers
   */
  emit(event: DomainEvent): void {
    const handlers = this.handlers.get(event.type);
    if (!handlers) return;

    for (const handler of handlers) {
      try {
        handler(event);
      } catch (error) {
        // Log error but don't break other handlers
        console.error(`Error in event handler for ${event.type}:`, error);
      }
    }
  }

  /**
   * Subscribe to a specific event type
   * Returns unsubscribe function
   */
  on<E extends DomainEvent>(type: E["type"], handler: EventHandler<E>): Unsubscribe {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }

    const handlers = this.handlers.get(type)!;
    handlers.add(handler as EventHandler);

    return () => {
      handlers.delete(handler as EventHandler);
      if (handlers.size === 0) {
        this.handlers.delete(type);
      }
    };
  }

  /**
   * Remove all handlers (used during shutdown)
   */
  clear(): void {
    this.handlers.clear();
  }
}
