import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ServerConfig } from '../config.js';

const AUTH_COOKIE_NAME = 'coder_studio_auth';

const isPublicPath = (path: string) => {
  // `/internal/hooks/*` is called by the per-provider bridge scripts
  // (Claude `~/.claude/settings.json` SessionStart hook, Codex `-c notify=...`
  // payload). Those scripts don't carry the auth cookie but do authenticate
  // via the per-process token in `~/.coder-studio/runtime.json`, enforced by
  // `registerHooksEndpoint`. The endpoint is additionally bound to localhost
  // only, so skipping the cookie guard here does not widen the attack surface.
  return (
    path === '/' ||
    path === '/healthz' ||
    path === '/ws' ||
    path === '/auth/status' ||
    path.startsWith('/assets/') ||
    path.startsWith('/@') ||
    path === '/favicon.ico' ||
    path.startsWith('/internal/hooks/')
  );
};

const parseCookies = (cookieHeader?: string) => {
  if (!cookieHeader) {
    return {} as Record<string, string>;
  }

  return cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, part) => {
      const [key, ...rest] = part.split('=');
      if (!key) {
        return acc;
      }
      acc[key] = rest.join('=');
      return acc;
    }, {});
};

export const createAuthGuard = (config: ServerConfig) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!config.auth.enabled || isPublicPath(request.url) || request.url === '/auth/login') {
      return;
    }

    const cookies = parseCookies(request.headers.cookie);
    const authCookie = cookies[AUTH_COOKIE_NAME];

    if (authCookie && config.auth.password && authCookie === config.auth.password) {
      return;
    }

    reply.status(401).send({
      ok: false,
      error: 'Authentication required',
    });
  };
};

export const registerAuthStatusRoute = (config: ServerConfig) => {
  return async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      ok: true,
      authEnabled: config.auth.enabled,
    });
  };
};

export const registerAuthRoutes = (config: ServerConfig) => {
  return async (request: FastifyRequest<{ Body: { password?: string } }>, reply: FastifyReply) => {
    if (!config.auth.enabled || !config.auth.password) {
      return reply.send({ ok: true, authEnabled: false });
    }

    if (request.body?.password !== config.auth.password) {
      return reply.status(401).send({ ok: false, error: 'Invalid password' });
    }

    reply.header('Set-Cookie', `${AUTH_COOKIE_NAME}=${config.auth.password}; HttpOnly; Path=/; SameSite=Lax`);
    return reply.send({ ok: true, authEnabled: true });
  };
};
