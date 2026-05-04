import type { FastifyReply, FastifyRequest } from 'fastify';
import { randomBytes } from 'node:crypto';
import type { ServerConfig } from '../config.js';
import { AuthLoginProtection, resolveClientIp } from './login-protection.js';
import type { AuthLoginBlockRepo } from '../storage/repositories/auth-login-block-repo.js';
import type { AuthSessionRepo } from '../storage/repositories/auth-session-repo.js';

const AUTH_COOKIE_NAME = 'coder_studio_auth';

const isPublicPath = (path: string) => {
  return (
    path === '/' ||
    path === '/auth' ||
    path === '/healthz' ||
    path === '/auth/status' ||
    path.startsWith('/assets/') ||
    path.startsWith('/@') ||
    path === '/favicon.ico'
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

const encodeAuthCookieValue = (value: string): string => encodeURIComponent(value);

const decodeAuthCookieValue = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

interface AuthDeps {
  config: ServerConfig;
  authSessionRepo: AuthSessionRepo;
  authLoginBlockRepo: AuthLoginBlockRepo;
}

const isFrontendNavigationRequest = (request: FastifyRequest, deps: AuthDeps): boolean => {
  if (!deps.config.webRoot) {
    return false;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return false;
  }

  const path = request.url;
  if (
    path.startsWith('/api/') ||
    path.startsWith('/auth/') ||
    path.startsWith('/internal/') ||
    path === '/ws' ||
    path.startsWith('/assets/') ||
    path.startsWith('/@') ||
    path === '/favicon.ico'
  ) {
    return false;
  }

  const accept = request.headers.accept ?? '';
  return accept.includes('text/html');
};

const isAuthenticatedRequest = (request: FastifyRequest, deps: AuthDeps): boolean => {
  if (!deps.config.auth.enabled) {
    return true;
  }

  const cookies = parseCookies(request.headers.cookie);
  const authCookie = cookies[AUTH_COOKIE_NAME];
  if (!authCookie) {
    return false;
  }

  const token = decodeAuthCookieValue(authCookie);
  return deps.authSessionRepo.touch(token, Date.now());
};

export const createAuthGuard = (deps: AuthDeps) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!deps.config.auth.enabled || isPublicPath(request.url) || request.url === '/auth/login' || request.url === '/auth/logout') {
      return;
    }

    if (isAuthenticatedRequest(request, deps)) {
      return;
    }

    if (isFrontendNavigationRequest(request, deps)) {
      return reply.redirect('/auth');
    }

    reply.status(401).send({
      ok: false,
      error: 'Authentication required',
    });
  };
};

export const registerAuthStatusRoute = (deps: AuthDeps) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      ok: true,
      authEnabled: deps.config.auth.enabled,
      authenticated: isAuthenticatedRequest(request, deps),
    });
  };
};

export const registerAuthRoutes = (deps: AuthDeps) => {
  const loginProtection = new AuthLoginProtection(deps.authLoginBlockRepo);

  return async (request: FastifyRequest<{ Body: { password?: string } }>, reply: FastifyReply) => {
    if (!deps.config.auth.enabled || !deps.config.auth.password) {
      return reply.send({ ok: true, authEnabled: false, authenticated: true });
    }

    const now = Date.now();
    const ip = resolveClientIp(request);
    const activeBlock = loginProtection.getActiveBlock(ip, now);
    if (activeBlock) {
      return reply.status(429).send({
        ok: false,
        blocked: true,
        ip,
        blockedUntil: activeBlock.blockedUntil,
        error: 'Too many failed attempts',
      });
    }

    if (request.body?.password !== deps.config.auth.password) {
      loginProtection.recordFailure(ip, now);
      return reply.status(401).send({ ok: false, error: 'Invalid password' });
    }

    loginProtection.clearFailures(ip);
    const token = randomBytes(32).toString('hex');
    deps.authSessionRepo.create(token, now);

    reply.header(
      'Set-Cookie',
      `${AUTH_COOKIE_NAME}=${encodeAuthCookieValue(token)}; HttpOnly; Path=/; SameSite=Lax`
    );
    return reply.send({ ok: true, authEnabled: true, authenticated: true });
  };
};

export const registerAuthLogoutRoute = (deps: AuthDeps) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const cookies = parseCookies(request.headers.cookie);
    const authCookie = cookies[AUTH_COOKIE_NAME];

    if (authCookie) {
      deps.authSessionRepo.delete(decodeAuthCookieValue(authCookie));
    }

    reply.header(
      'Set-Cookie',
      `${AUTH_COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`
    );

    return reply.send({
      ok: true,
      authEnabled: deps.config.auth.enabled,
      authenticated: false,
    });
  };
};
