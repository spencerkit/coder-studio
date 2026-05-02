import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { registerHooksEndpoint } from './endpoint.js';
import type { RuntimeConfig } from './runtime-json.js';

describe('endpoint', () => {
  let app: ReturnType<typeof Fastify>;
  let runtime: RuntimeConfig;
  let receivedEvents: Array<{ event: string; payload: unknown }>;

  beforeEach(async () => {
    app = Fastify();
    runtime = {
      host: '127.0.0.1',
      port: 3000,
      pid: 1,
      token: 'test-token-123',
      serverInstanceId: 'server-abc',
      startedAt: Date.now(),
    };
    receivedEvents = [];

    registerHooksEndpoint(app, runtime, (event, payload) => {
      receivedEvents.push({ event, payload });
    });

    await app.ready();
  });

  describe('POST /internal/hooks/:event', () => {
    it('should accept valid localhost request with correct token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/hooks/SessionStart?token=test-token-123',
        payload: { session_id: 'session-123' },
        headers: {
          'content-type': 'application/json',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });
      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].event).toBe('SessionStart');
      expect(receivedEvents[0].payload).toEqual({ session_id: 'session-123' });
    });

    it('should reject requests with invalid token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/hooks/SessionStart?token=invalid-token',
        payload: { session_id: 'session-123' },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: 'invalid_token' });
      expect(receivedEvents).toHaveLength(0);
    });

    it('should reject requests without token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/hooks/SessionStart',
        payload: { session_id: 'session-123' },
      });

      expect(response.statusCode).toBe(403);
      expect(receivedEvents).toHaveLength(0);
    });

    it('should accept different event types', async () => {
      const events = ['SessionStart', 'Stop', 'Progress'];

      for (const event of events) {
        const response = await app.inject({
          method: 'POST',
          url: `/internal/hooks/${event}?token=test-token-123`,
          payload: { test: true },
        });

        expect(response.statusCode).toBe(200);
      }

      expect(receivedEvents).toHaveLength(3);
      expect(receivedEvents.map(e => e.event)).toEqual(events);
    });

    it('should handle empty payload', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/hooks/SessionStart?token=test-token-123',
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].payload).toEqual({});
    });

    it('should handle complex payloads', async () => {
      const complexPayload = {
        session_id: 'session-123',
        transcript_path: '/path/to/transcript',
        metadata: {
          nested: {
            data: [1, 2, 3],
          },
        },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/internal/hooks/SessionStart?token=test-token-123',
        payload: complexPayload,
      });

      expect(response.statusCode).toBe(200);
      expect(receivedEvents[0].payload).toEqual(complexPayload);
    });

    it('should handle handler errors gracefully', async () => {
      // Register endpoint with throwing handler
      const errorApp = Fastify();
      registerHooksEndpoint(errorApp, runtime, () => {
        throw new Error('Handler error');
      });
      await errorApp.ready();

      const response = await errorApp.inject({
        method: 'POST',
        url: '/internal/hooks/SessionStart?token=test-token-123',
        payload: {},
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: 'internal_error' });
    });

    it('should URL-decode event names', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/hooks/Session%20Start?token=test-token-123',
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      expect(receivedEvents[0].event).toBe('Session Start');
    });
  });
});
