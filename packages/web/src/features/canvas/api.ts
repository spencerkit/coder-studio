import {
  type CanvasAnchorCommentDocument,
  CanvasAnchorCommentDocumentSchema,
  type CanvasDataResponse,
  CanvasDataResponseSchema,
  type CanvasInspectionResponse,
  CanvasInspectionResponseSchema,
  type CanvasOverlayDocument,
  CanvasOverlayDocumentSchema,
  type CanvasSnapshotDataResponse,
  CanvasSnapshotDataResponseSchema,
  type CompiledCanvas,
} from "@coder-studio/core";

function isRenderableCompiledCanvas(data: CompiledCanvas): boolean {
  if (data.kind !== "architecture_canvas") {
    return true;
  }

  return data.sections.some((section) => section.type === "diagram");
}

function isRenderableCanvasResponse(data: CanvasDataResponse): boolean {
  if (data.renderStatus !== "ready") {
    return true;
  }

  if (!data.compiledDocument) {
    return false;
  }

  return isRenderableCompiledCanvas(data.compiledDocument);
}

async function readJson(response: Response): Promise<CanvasDataResponse> {
  if (!response.ok) {
    throw new Error(`canvas_request_failed:${response.status}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("canvas_response_invalid");
  }

  const parsed = CanvasDataResponseSchema.safeParse(payload);

  if (!parsed.success || !isRenderableCanvasResponse(parsed.data)) {
    throw new Error("canvas_response_invalid");
  }

  return parsed.data;
}

async function readInspectionJson(response: Response): Promise<CanvasInspectionResponse> {
  if (!response.ok) {
    throw new Error(`canvas_request_failed:${response.status}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("canvas_response_invalid");
  }

  const parsed = CanvasInspectionResponseSchema.safeParse(payload);

  if (!parsed.success || !isRenderableCanvasResponse(parsed.data)) {
    throw new Error("canvas_response_invalid");
  }

  return parsed.data;
}

async function readSnapshotJson(response: Response): Promise<CanvasSnapshotDataResponse> {
  if (!response.ok) {
    throw new Error(`canvas_request_failed:${response.status}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("canvas_response_invalid");
  }

  const parsed = CanvasSnapshotDataResponseSchema.safeParse(payload);

  if (!parsed.success || !isRenderableCompiledCanvas(parsed.data.compiledDocument)) {
    throw new Error("canvas_response_invalid");
  }

  return parsed.data;
}

export async function fetchCanvasData(
  workspaceId: string,
  sourcePath: string
): Promise<CanvasDataResponse> {
  const query = new URLSearchParams({ sourcePath });
  const response = await fetch(
    `/api/canvas/${encodeURIComponent(workspaceId)}/data?${query.toString()}`,
    {
      credentials: "include",
    }
  );

  return readJson(response);
}

export async function fetchCanvasSnapshotData(
  snapshotId: string
): Promise<CanvasSnapshotDataResponse> {
  const response = await fetch(`/api/canvas-snapshots/${encodeURIComponent(snapshotId)}`, {
    credentials: "include",
  });

  return readSnapshotJson(response);
}

export async function fetchCanvasInspectionData(
  workspaceId: string,
  sourcePath: string
): Promise<CanvasInspectionResponse> {
  const query = new URLSearchParams({ sourcePath });
  const response = await fetch(
    `/api/canvas/${encodeURIComponent(workspaceId)}/inspection?${query.toString()}`,
    {
      credentials: "include",
    }
  );

  return readInspectionJson(response);
}

export async function saveCanvasOverlay(
  workspaceId: string,
  sourcePath: string,
  overlayDocument: CanvasOverlayDocument
): Promise<CanvasOverlayDocument> {
  const query = new URLSearchParams({ sourcePath });
  const response = await fetch(
    `/api/canvas/${encodeURIComponent(workspaceId)}/annotations?${query.toString()}`,
    {
      method: "PUT",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(overlayDocument),
    }
  );

  if (!response.ok) {
    throw new Error(`canvas_request_failed:${response.status}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("canvas_response_invalid");
  }

  const parsed = CanvasOverlayDocumentSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("canvas_response_invalid");
  }

  return parsed.data;
}

export async function saveCanvasAnchorComments(
  workspaceId: string,
  sourcePath: string,
  anchorCommentDocument: CanvasAnchorCommentDocument
): Promise<CanvasAnchorCommentDocument> {
  const query = new URLSearchParams({ sourcePath });
  const response = await fetch(
    `/api/canvas/${encodeURIComponent(workspaceId)}/comments?${query.toString()}`,
    {
      method: "PUT",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(anchorCommentDocument),
    }
  );

  if (!response.ok) {
    throw new Error(`canvas_request_failed:${response.status}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("canvas_response_invalid");
  }

  const parsed = CanvasAnchorCommentDocumentSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("canvas_response_invalid");
  }

  return parsed.data;
}
