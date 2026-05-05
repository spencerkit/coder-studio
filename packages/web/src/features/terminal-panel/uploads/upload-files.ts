export interface UploadedFileMeta {
  path: string;
  originalName: string;
  size: number;
}

export class UploadError extends Error {
  override name = "UploadError";

  constructor(
    public readonly code: string,
    public readonly status: number,
    message?: string
  ) {
    super(message ?? code);
  }
}

export interface UploadFilesInput {
  workspaceId: string;
  files: File[];
}

export async function uploadFiles(input: UploadFilesInput): Promise<UploadedFileMeta[]> {
  const form = new FormData();
  form.append("workspaceId", input.workspaceId);
  for (const file of input.files) {
    form.append("files", file, file.name);
  }

  let response: Response;
  try {
    response = await fetch("/api/uploads", {
      method: "POST",
      body: form,
      credentials: "include",
    });
  } catch (error) {
    throw new UploadError("network_error", 0, (error as Error).message);
  }

  let body: { ok?: boolean; files?: UploadedFileMeta[]; error?: string };
  try {
    body = await response.json();
  } catch {
    body = {};
  }

  if (!response.ok || !body.ok) {
    throw new UploadError(body.error ?? `http_${response.status}`, response.status);
  }

  return body.files ?? [];
}
