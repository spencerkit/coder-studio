export interface DevBrowserSessionResponse {
  browserProxyBase: string;
  browserUrl: string;
  displayUrl?: string;
  expiresAt?: number;
  id: string;
  targetOrigin: string;
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`dev_browser_request_failed:${response.status}`);
  }
  return response.json() as Promise<T>;
}

export interface CreateDevBrowserSessionOptions {
  userAgent?: string;
}

export async function createDevBrowserSession(
  url: string,
  options: CreateDevBrowserSessionOptions = {}
): Promise<DevBrowserSessionResponse> {
  const response = await fetch("/api/dev-proxy/session", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, ...(options.userAgent ? { userAgent: options.userAgent } : {}) }),
  });

  return readJson<DevBrowserSessionResponse>(response);
}

export async function deleteDevBrowserSession(sessionId: string): Promise<void> {
  const response = await fetch(`/api/dev-proxy/session/${sessionId}`, {
    method: "DELETE",
    credentials: "include",
  });

  await readJson<{ ok: true }>(response);
}
