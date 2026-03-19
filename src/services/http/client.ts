import { backendBaseUrl, hasTauriRuntime } from "../../shared/runtime/backend";

export const invokeRpc = async <T = unknown>(command: string, payload: Record<string, unknown> = {}): Promise<T> => {
  const errors: string[] = [];
  const candidates = [backendBaseUrl()];

  for (const base of candidates) {
    try {
      const endpoint = new URL(`/api/rpc/${command}`, `${base}/`).toString();
      const response = await fetch(endpoint, {
        method: "POST",
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
        throw new Error(body.error || `HTTP ${response.status}`);
      }

      return body.data as T;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      errors.push(`${base || "unknown_base"}: ${reason}`);
    }
  }

  if (hasTauriRuntime()) {
    try {
      const tauriCore = await import("@tauri-apps/api/core");
      return await tauriCore.invoke<T>(command, payload);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      errors.push(`tauri_invoke: ${reason}`);
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
