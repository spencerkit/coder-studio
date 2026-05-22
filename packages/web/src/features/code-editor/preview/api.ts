export type PreviewKind = "markdown" | "html";

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`preview_request_failed:${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function createPreviewSession(input: {
  workspaceId: string;
  entryPath: string;
  kind: PreviewKind;
  content: string;
  allowScripts?: boolean;
}) {
  const response = await fetch("/api/preview/session", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return readJson<{ id: string; previewUrl: string; revision: number }>(response);
}

export async function updatePreviewSession(
  sessionId: string,
  input: { content?: string; allowScripts?: boolean }
) {
  const response = await fetch(`/api/preview/session/${sessionId}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  return readJson<{ revision: number }>(response);
}

export async function deletePreviewSession(sessionId: string): Promise<void> {
  const response = await fetch(`/api/preview/session/${sessionId}`, {
    method: "DELETE",
    credentials: "include",
  });

  await readJson<{ ok: true }>(response);
}
