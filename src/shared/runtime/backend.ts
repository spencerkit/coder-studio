declare global {
  interface Window {
    __CODER_STUDIO_BACKEND__?: string;
    __TAURI_INTERNALS__?: unknown;
  }
}

export const normalizeBaseUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const parsed = typeof window !== "undefined"
      ? new URL(trimmed, window.location.origin)
      : new URL(trimmed);
    return parsed.origin.replace(/\/+$/, "");
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
};

export const readConfiguredBackendBase = () => {
  if (typeof window === "undefined") return "";
  return normalizeBaseUrl(window.__CODER_STUDIO_BACKEND__ ?? "");
};

export const isLocalBrowserOrigin = () => {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
};

export const isAuthForceRequested = () => {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("auth") === "force";
  } catch {
    return false;
  }
};

export const applyRuntimeQuery = (url: URL) => {
  if (isAuthForceRequested()) {
    url.searchParams.set("auth", "force");
  }
  return url;
};

export const backendBaseUrl = () => {
  if (typeof window === "undefined") return "";
  return readConfiguredBackendBase() || normalizeBaseUrl(window.location.origin);
};

export const healthUrl = () => {
  const baseValue = backendBaseUrl();
  const base = new URL(baseValue || (typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1"));
  base.pathname = "/health";
  base.search = "";
  base.hash = "";
  return applyRuntimeQuery(base).toString();
};

export const websocketUrl = () => {
  const baseValue = backendBaseUrl();
  const base = new URL(baseValue || (typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1"));
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.pathname = "/ws";
  base.search = "";
  base.hash = "";
  return applyRuntimeQuery(base).toString();
};

export const hasTauriRuntime = () => typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
