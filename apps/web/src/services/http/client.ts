import { applyRuntimeQuery, backendBaseUrl } from "../../shared/runtime/backend";
import { isPublicModeActive, markUnauthorized } from "./auth.service";

export const invokeRpc = async <T = unknown>(command: string, payload: Record<string, unknown> = {}): Promise<T> => {
  const errors: string[] = [];
  const candidates = [backendBaseUrl()];

  for (const base of candidates) {
    try {
      const endpoint = applyRuntimeQuery(new URL(`/api/rpc/${command}`, `${base}/`)).toString();
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      let body: { ok?: boolean; data?: T; error?: string } = {};
      try {
        body = await response.json();
      } catch {
        // Leave empty and fail below.
      }

      if (!response.ok || body.ok === false) {
        const code = body.error || `HTTP ${response.status}`;
        if (response.status === 401 || code === "session_missing" || code === "session_expired") {
          markUnauthorized(code);
        }
        throw new Error(code);
      }

      return body.data as T;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      errors.push(`${base || "unknown_base"}: ${reason}`);
    }
  }

  throw new Error(errors.join(" | "));
};

export const withFallback = async <T>(operation: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await operation();
  } catch {
    return fallback;
  }
};
