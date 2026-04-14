/**
 * Tests for EventBus
 */

import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../bus/event-bus.js';
import type { DomainEvent } from '@coder-studio/core';

describe('EventBus', () => {
  it('should emit and receive events', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on('session.state.changed', handler);

    const event: DomainEvent = {
      type: 'session.state.changed',
      sessionId: 'session-1',
      from: 'idle',
      to: 'running',
    };

    bus.emit(event);

    expect(handler).toHaveBeenCalledWith(event);
  });

  it('should support multiple handlers for same event', () => {
    const bus = new EventBus();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    bus.on('session.state.changed', handler1);
    bus.on('session.state.changed', handler2);

    const event: DomainEvent = {
      type: 'session.state.changed',
      sessionId: 'session-1',
      from: 'idle',
      to: 'running',
    };

    bus.emit(event);

    expect(handler1).toHaveBeenCalledWith(event);
    expect(handler2).toHaveBeenCalledWith(event);
  });

  it('should unsubscribe correctly', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    const unsub = bus.on('session.state.changed', handler);
    unsub();

    const event: DomainEvent = {
      type: 'session.state.changed',
      sessionId: 'session-1',
      from: 'idle',
      to: 'running',
    };

    bus.emit(event);

    expect(handler).not.toHaveBeenCalled();
  });

  it('should not break when emitting to no subscribers', () => {
    const bus = new EventBus();

    const event: DomainEvent = {
      type: 'session.state.changed',
      sessionId: 'session-1',
      from: 'idle',
      to: 'running',
    };

    expect(() => bus.emit(event)).not.toThrow();
  });

  it('should continue calling handlers after error', () => {
    const bus = new EventBus();
    const errorHandler = vi.fn(() => {
      throw new Error('Handler error');
    });
    const goodHandler = vi.fn();

    bus.on('session.state.changed', errorHandler);
    bus.on('session.state.changed', goodHandler);

    const event: DomainEvent = {
      type: 'session.state.changed',
      sessionId: 'session-1',
      from: 'idle',
      to: 'running',
    };

    bus.emit(event);

    expect(errorHandler).toHaveBeenCalled();
    expect(goodHandler).toHaveBeenCalled();
  });

  it('should clear all handlers', () => {
    const bus = new EventBus();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    bus.on('session.state.changed', handler1);
    bus.on('session.lifecycle', handler2);

    bus.clear();

    const event1: DomainEvent = {
      type: 'session.state.changed',
      sessionId: 'session-1',
      from: 'idle',
      to: 'running',
    };

    const event2: DomainEvent = {
      type: 'session.lifecycle',
      sessionId: 'session-1',
      event: 'started',
    };

    bus.emit(event1);
    bus.emit(event2);

    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).not.toHaveBeenCalled();
  });

  it('should handle all event types', () => {
    const bus = new EventBus();
    const handlers = {
      'session.state.changed': vi.fn(),
      'session.lifecycle': vi.fn(),
      'workspace.meta.changed': vi.fn(),
      'git.state.changed': vi.fn(),
      'fs.dirty': vi.fn(),
    };

    // Subscribe to all event types
    for (const [type, handler] of Object.entries(handlers)) {
      bus.on(type as any, handler);
    }

    // Emit each event type
    const events: DomainEvent[] = [
      {
        type: 'session.state.changed',
        sessionId: 's1',
        from: 'idle',
        to: 'running',
      },
      {
        type: 'session.lifecycle',
        sessionId: 's1',
        event: 'started',
      },
      {
        type: 'workspace.meta.changed',
        workspaceId: 'w1',
        patch: { name: 'test' },
      },
      {
        type: 'git.state.changed',
        workspaceId: 'w1',
      },
      {
        type: 'fs.dirty',
        workspaceId: 'w1',
        reason: 'file saved',
      },
    ];

    for (const event of events) {
      bus.emit(event);
    }

    // Verify all handlers were called
    for (const handler of Object.values(handlers)) {
      expect(handler).toHaveBeenCalled();
    }
  });
});
