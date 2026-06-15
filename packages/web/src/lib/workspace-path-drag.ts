export const WORKSPACE_PATH_DRAG_MIME = "application/x-coder-studio-workspace-path";
export const WORKSPACE_PATH_DRAG_START_EVENT = "coder-studio:workspace-path-drag-start";
export const WORKSPACE_PATH_DRAG_END_EVENT = "coder-studio:workspace-path-drag-end";

export interface WorkspacePathDragPayload {
  workspaceId: string;
  path: string;
  kind: "file" | "dir";
}

let clearWorkspacePathDragEndListeners: (() => void) | null = null;

export function isWorkspacePathDragPayload(value: unknown): value is WorkspacePathDragPayload {
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
  announceWorkspacePathDragStart(payload);
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

export function announceWorkspacePathDragStart(payload: WorkspacePathDragPayload): void {
  if (typeof window === "undefined" || typeof CustomEvent === "undefined") {
    return;
  }

  clearWorkspacePathDragEndListeners?.();
  window.dispatchEvent(new CustomEvent(WORKSPACE_PATH_DRAG_START_EVENT, { detail: payload }));

  const finishDrag = () => announceWorkspacePathDragEnd();
  window.addEventListener("dragend", finishDrag, { once: true });
  window.addEventListener("drop", finishDrag, { once: true });
  clearWorkspacePathDragEndListeners = () => {
    window.removeEventListener("dragend", finishDrag);
    window.removeEventListener("drop", finishDrag);
  };
}

export function announceWorkspacePathDragEnd(): void {
  if (typeof window === "undefined") {
    return;
  }

  clearWorkspacePathDragEndListeners?.();
  clearWorkspacePathDragEndListeners = null;
  window.dispatchEvent(new Event(WORKSPACE_PATH_DRAG_END_EVENT));
}
