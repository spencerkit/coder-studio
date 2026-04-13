import {
  applyRuntimeQuery,
  backendBaseUrl,
  hasTauriRuntime,
  isAuthForceRequested,
  isLocalBrowserOrigin,
} from "../../shared/runtime/backend";
import type { AuthStatus } from "../../types/app";

type AuthEnvelope<T> = {
  ok?: boolean;
  data?: T;
  error?: string;
  blocked_until?: string;
};

const DEFAULT_AUTH_STATUS: AuthStatus = {
  public_mode: false,
  authenticated: true,
  password_configured: true,
  local_host: false,
  secure_transport_required: false,
  secure_transport_ok: true,
  session_idle_minutes: 15,
  session_max_hours: 12,
  allowed_roots: []
};

const authListeners = new Set<(status: AuthStatus) => void>();
const unauthorizedListeners = new Set<(reason: string) => void>();

let authStatus: AuthStatus = DEFAULT_AUTH_STATUS;
let authInitialized = false;
let lastAuthReason: string | null = null;

export class AuthRequestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly blockedUntil?: string;

  constructor(code: string, status: number, blockedUntil?: string) {
    super(code);
    this.name = "AuthRequestError";
    this.code = code;
    this.status = status;
    this.blockedUntil = blockedUntil;
  }
}

const isHttpOrigin = () => {
  if (typeof window === "undefined") return false;
  return window.location.protocol === "http:" || window.location.protocol === "https:";
};

const isLocalHttpOrigin = () => isHttpOrigin() && isLocalBrowserOrigin();

const runtimePublicModeHint = () => {
  if (!isHttpOrigin()) return isAuthForceRequested();
  return !isLocalHttpOrigin() || isAuthForceRequested();
};

const authEndpoint = (path: string) => applyRuntimeQuery(new URL(path, `${backendBaseUrl()}/`)).toString();

const emitAuthStatus = () => {
  authListeners.forEach((listener) => listener(authStatus));
};

const setAuthStatus = (next: AuthStatus) => {
  authStatus = next;
  authInitialized = true;
  emitAuthStatus();
};

const makePrivateFallbackStatus = (): AuthStatus => ({
  ...DEFAULT_AUTH_STATUS,
  public_mode: false,
  authenticated: true,
  local_host: false,
});

const shouldAssumePrivateMode = () => hasTauriRuntime() && !runtimePublicModeHint();

const requestAuth = async <T = AuthStatus>(
  path: string,
  init?: RequestInit,
): Promise<T> => {
  const response = await fetch(authEndpoint(path), {
    cache: "no-store",
    credentials: "include",
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  let body: AuthEnvelope<T> = {};
  try {
    body = await response.json();
  } catch {
    // Leave the parsed envelope empty and fail below.
  }

  if (!response.ok || body.ok === false) {
    throw new AuthRequestError(body.error || `HTTP ${response.status}`, response.status, body.blocked_until);
  }

  return body.data as T;
};

export const getAuthStatusSnapshot = () => authStatus;

export const isPublicModeActive = () => {
  if (authInitialized) return authStatus.public_mode;
  return runtimePublicModeHint();
};

export const isAuthenticated = () => {
  if (!isPublicModeActive()) return true;
  return authInitialized ? authStatus.authenticated : false;
};

export const getLastAuthReason = () => lastAuthReason;

export const clearLastAuthReason = () => {
  lastAuthReason = null;
};

export const subscribeAuthStatus = (listener: (status: AuthStatus) => void) => {
  authListeners.add(listener);
  return () => {
    authListeners.delete(listener);
  };
};

export const subscribeUnauthorized = (listener: (reason: string) => void) => {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
};

export const markUnauthorized = (reason: string) => {
  if (!isPublicModeActive()) return;
  lastAuthReason = reason;
  setAuthStatus({
    ...authStatus,
    public_mode: true,
    authenticated: false,
  });
  unauthorizedListeners.forEach((listener) => listener(reason));
};

export const fetchAuthStatus = async () => {
  try {
    const next = await requestAuth<AuthStatus>("/api/auth/status", {
      method: "GET"
    });
    setAuthStatus(next);
    return next;
  } catch (error) {
    if (shouldAssumePrivateMode()) {
      const fallback = makePrivateFallbackStatus();
      setAuthStatus(fallback);
      return fallback;
    }
    setAuthStatus({
      ...authStatus,
      public_mode: true,
      authenticated: false,
    });
    throw error;
  }
};

export const loginWithPassword = async (password: string) => {
  const next = await requestAuth<AuthStatus>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ password })
  });
  lastAuthReason = null;
  setAuthStatus(next);
  return next;
};

export const logoutCurrentSession = async () => {
  const next = await requestAuth<AuthStatus>("/api/auth/logout", {
    method: "POST",
    body: JSON.stringify({})
  });
  setAuthStatus(next);
  return next;
};

export const lockCurrentSession = async () => {
  const next = await requestAuth<AuthStatus>("/api/auth/lock", {
    method: "POST",
    body: JSON.stringify({})
  });
  setAuthStatus(next);
  return next;
};
