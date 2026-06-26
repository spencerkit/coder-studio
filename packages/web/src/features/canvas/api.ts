import { type CanvasDataResponse, CanvasDataResponseSchema } from "@coder-studio/core";

function isRenderableCanvasResponse(data: CanvasDataResponse): boolean {
  if (data.renderStatus !== "ready") {
    return true;
  }

  if (data.compiledDocument.kind !== "architecture_canvas") {
    return true;
  }

  return data.compiledDocument.sections.some((section) => section.type === "diagram");
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
