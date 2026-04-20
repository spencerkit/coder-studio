import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { RuntimeConfig } from './runtime-json';

/**
 * Context passed from endpoint to the hook event handler.
 * Carries metadata extracted from the query string.
 */
export interface HookEventContext {
  coderStudioSessionId?: string;
}

/**
 * Hook event payload received from bridge script
 */
export interface HookEventPayload {
  session_id?: string;
  [key: string]: unknown;
}

/**
 * Registers the internal hooks endpoint
 * POST /internal/hooks/:event
 *
 * Security constraints:
 * 1. Only accepts connections from 127.0.0.1 or ::1
 * 2. Requires valid token from runtime.json
 * 3. No external auth needed (localhost only)
 */
export function registerHooksEndpoint(
  app: FastifyInstance,
  runtime: RuntimeConfig,
  onHookEvent: (event: string, payload: unknown, ctx: HookEventContext) => void
): void {
  app.post<{
    Params: { event: string };
    Querystring: { token: string; coder_studio_session_id?: string };
    Body: unknown;
  }>('/internal/hooks/:event', async (request: FastifyRequest, reply: FastifyReply) => {
    // 1. Only accept localhost connections
    if (!isLocalhost(request.ip)) {
      return reply.code(403).send({ error: 'forbidden' });
    }

    // 2. Validate token
    const query = request.query as { token?: string; coder_studio_session_id?: string };
    if (!query.token || query.token !== runtime.token) {
      return reply.code(403).send({ error: 'invalid_token' });
    }

    // 3. Extract event name and payload
    const params = request.params as { event: string };
    const event = params.event;
    const payload = request.body;

    // 4. Delegate to handler with context
    try {
      onHookEvent(event, payload, {
        coderStudioSessionId: query.coder_studio_session_id,
      });
      return reply.send({ ok: true });
    } catch (error) {
      console.error('Hook event handler error:', error);
      return reply.code(500).send({ error: 'internal_error' });
    }
  });
}

/**
 * Checks if an IP address is localhost
 * Accepts both IPv4 (127.0.0.1) and IPv6 (::1)
 */
function isLocalhost(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}
