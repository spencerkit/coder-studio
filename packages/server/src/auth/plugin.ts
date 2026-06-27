import { randomBytes } from "node:crypto";
import { isIP } from "node:net";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { ServerConfig } from "../config.js";
import type { AuthLoginBlockRepo } from "../storage/repositories/auth-login-block-repo.js";
import type { AuthSessionRepo } from "../storage/repositories/auth-session-repo.js";
import {
  getRequestPathname,
  isFrontendNavigationRequest as isFrontendNavigationRequestForWebUi,
  isPublicStaticPath,
} from "../web-ui-routing.js";
import { AuthLoginProtection, resolveClientIp } from "./login-protection.js";
import type { SessionAutomationTokenRecord, SessionTokenRepo } from "./session-token-repo.js";

const AUTH_COOKIE_NAME = "coder_studio_auth";

const isPublicPath = (path: string) => {
  const pathname = getRequestPathname(path);

  return (
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/healthz" ||
    pathname === "/auth/status" ||
    pathname === "/auth/login" ||
    pathname === "/auth/logout" ||
    pathname.startsWith("/@") ||
    isPublicStaticPath(pathname)
  );
};

const parseCookies = (cookieHeader?: string) => {
  if (!cookieHeader) {
    return {} as Record<string, string>;
  }

  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, part) => {
      const [key, ...rest] = part.split("=");
      if (!key) {
        return acc;
      }
      acc[key] = rest.join("=");
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
  sessionTokenRepo?: SessionTokenRepo;
}

export type RequestAuthContext =
  | { mode: "browser" }
  | ({
      mode: "session_token";
      tokenMode: SessionAutomationTokenRecord["mode"];
    } & Omit<SessionAutomationTokenRecord, "mode">);

declare module "fastify" {
  interface FastifyRequest {
    coderStudioAuthContext?: RequestAuthContext;
  }
}

const isFrontendNavigationRequest = (request: FastifyRequest, deps: AuthDeps): boolean => {
  if (!deps.config.webRoot) {
    return false;
  }
  return isFrontendNavigationRequestForWebUi(request);
};

function getBearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header) {
    return null;
  }

  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return null;
  }

  const token = match[1]?.trim();
  return token ? token : null;
}

function getTrustedClientIp(request: FastifyRequest): string | null {
  const ip = resolveClientIp({
    headers: request.headers,
    ip: request.ip ?? "",
  }).trim();

  return ip ? ip.toLowerCase() : null;
}

function normalizeClientIp(ip: string): string {
  const withoutZone = ip.split("%")[0] ?? ip;
  return withoutZone.startsWith("::ffff:") ? withoutZone.slice("::ffff:".length) : withoutZone;
}

function isLoopbackIp(ip: string): boolean {
  const normalized = normalizeClientIp(ip);
  return normalized === "::1" || normalized.startsWith("127.");
}

function isPrivateIpv4(ip: string): boolean {
  const parts = normalizeClientIp(ip)
    .split(".")
    .map((part) => Number.parseInt(part, 10));

  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return false;
  }

  const [first = -1, second = -1] = parts;
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isLinkLocalIp(ip: string): boolean {
  const normalized = normalizeClientIp(ip);
  if (isIP(normalized) === 4) {
    return normalized.startsWith("169.254.");
  }

  return /^fe[89ab]/i.test(normalized);
}

function isLoopbackRequest(request: FastifyRequest): boolean {
  const ip = getTrustedClientIp(request);
  if (!ip) {
    return false;
  }

  return isLoopbackIp(ip);
}

function isPrivateOrLoopbackRequest(request: FastifyRequest): boolean {
  const ip = getTrustedClientIp(request);
  if (!ip) {
    return false;
  }

  return isLoopbackIp(ip) || isPrivateIpv4(ip) || isLinkLocalIp(ip);
}

function authenticateSessionToken(
  request: FastifyRequest,
  deps: AuthDeps
): SessionAutomationTokenRecord | null {
  if (getRequestPathname(request.url) !== "/ws") {
    return null;
  }

  const token = getBearerToken(request);
  if (!token) {
    return null;
  }

  const tokenRecord = deps.sessionTokenRepo?.get(token) ?? null;
  if (!tokenRecord) {
    return null;
  }

  if (tokenRecord.mode === "remote_runtime") {
    return isPrivateOrLoopbackRequest(request) ? tokenRecord : null;
  }

  return isLoopbackRequest(request) ? tokenRecord : null;
}

function decorateSessionTokenAuth(request: FastifyRequest, deps: AuthDeps): boolean {
  const tokenRecord = authenticateSessionToken(request, deps);
  if (tokenRecord) {
    const { mode: tokenMode, ...tokenFields } = tokenRecord;
    request.coderStudioAuthContext = {
      mode: "session_token",
      tokenMode,
      ...tokenFields,
    };
    return true;
  }

  return false;
}

const isAuthenticatedRequest = (request: FastifyRequest, deps: AuthDeps): boolean => {
  if (decorateSessionTokenAuth(request, deps)) {
    return true;
  }

  if (!deps.config.auth.enabled) {
    return true;
  }

  const cookies = parseCookies(request.headers.cookie);
  const authCookie = cookies[AUTH_COOKIE_NAME];
  if (!authCookie) {
    return false;
  }

  const token = decodeAuthCookieValue(authCookie);
  const authenticated = deps.authSessionRepo.touch(token, Date.now());
  if (authenticated) {
    request.coderStudioAuthContext = { mode: "browser" };
  }
  return authenticated;
};

export const createAuthGuard = (deps: AuthDeps) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (decorateSessionTokenAuth(request, deps)) {
      return;
    }

    if (
      !deps.config.auth.enabled ||
      isPublicPath(request.url) ||
      request.url === "/auth/login" ||
      request.url === "/auth/logout"
    ) {
      return;
    }

    if (isAuthenticatedRequest(request, deps)) {
      return;
    }

    if (isFrontendNavigationRequest(request, deps)) {
      return reply.redirect("/login");
    }

    reply.status(401).send({
      ok: false,
      error: "Authentication required",
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
        error: "Too many failed attempts",
      });
    }

    if (request.body?.password !== deps.config.auth.password) {
      loginProtection.recordFailure(ip, now);
      return reply.status(401).send({ ok: false, error: "Invalid password" });
    }

    loginProtection.clearFailures(ip);
    const token = randomBytes(32).toString("hex");
    deps.authSessionRepo.create(token, now);

    reply.header(
      "Set-Cookie",
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

    reply.header("Set-Cookie", `${AUTH_COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);

    return reply.send({
      ok: true,
      authEnabled: deps.config.auth.enabled,
      authenticated: false,
    });
  };
};
