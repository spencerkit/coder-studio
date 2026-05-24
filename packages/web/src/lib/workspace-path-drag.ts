export const WORKSPACE_PATH_DRAG_MIME = "application/x-coder-studio-workspace-path";

export interface WorkspacePathDragPayload {
  workspaceId: string;
  path: string;
  kind: "file" | "dir";
}

function isWorkspacePathDragPayload(value: unknown): value is WorkspacePathDragPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Record<string, unknown>;

  return (
    typeof payload.workspaceId === "string" &&
    payload.workspaceId.length > 0 &&
    typeof payload.path === "string" &&
    payload.path.length > 0 &&
    (payload.kind === "file" || payload.kind === "dir")
  );
}

export function hasWorkspacePathDragType(
  dataTransfer: Pick<DataTransfer, "types"> | null | undefined
): boolean {
  return Array.from(dataTransfer?.types ?? []).includes(WORKSPACE_PATH_DRAG_MIME);
}

export function setWorkspacePathDragData(
  dataTransfer: Pick<DataTransfer, "setData" | "effectAllowed">,
  payload: WorkspacePathDragPayload
): void {
  dataTransfer.effectAllowed = "copy";
  dataTransfer.setData(WORKSPACE_PATH_DRAG_MIME, JSON.stringify(payload));
  dataTransfer.setData("text/plain", payload.path);
}

export function getWorkspacePathDragPayload(
  dataTransfer: Pick<DataTransfer, "types" | "getData"> | null | undefined
): WorkspacePathDragPayload | null {
  if (!hasWorkspacePathDragType(dataTransfer)) {
    return null;
  }

  try {
    const raw = dataTransfer?.getData(WORKSPACE_PATH_DRAG_MIME) ?? "";
    const parsed: unknown = JSON.parse(raw);
    return isWorkspacePathDragPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
