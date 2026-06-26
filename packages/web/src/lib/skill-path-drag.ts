import { toSkillEditorPath } from "../features/code-editor/skill-editor-path";

export const SKILL_PATH_DRAG_MIME = "application/x-coder-studio-skill-path";
export const SKILL_PATH_DRAG_START_EVENT = "coder-studio:skill-path-drag-start";
export const SKILL_PATH_DRAG_END_EVENT = "coder-studio:skill-path-drag-end";

export interface SkillPathDragPayload {
  skillSlug: string;
  path: string;
  absolutePath: string;
  kind: "file" | "dir";
}

let clearSkillPathDragEndListeners: (() => void) | null = null;

export function isSkillPathDragPayload(value: unknown): value is SkillPathDragPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Record<string, unknown>;

  return (
    typeof payload.skillSlug === "string" &&
    payload.skillSlug.length > 0 &&
    typeof payload.path === "string" &&
    payload.path.length > 0 &&
    typeof payload.absolutePath === "string" &&
    payload.absolutePath.length > 0 &&
    (payload.kind === "file" || payload.kind === "dir")
  );
}

export function hasSkillPathDragType(
  dataTransfer: Pick<DataTransfer, "types"> | null | undefined
): boolean {
  return Array.from(dataTransfer?.types ?? []).includes(SKILL_PATH_DRAG_MIME);
}

export function setSkillPathDragData(
  dataTransfer: Pick<DataTransfer, "setData" | "effectAllowed">,
  payload: SkillPathDragPayload
): void {
  dataTransfer.effectAllowed = "copy";
  dataTransfer.setData(SKILL_PATH_DRAG_MIME, JSON.stringify(payload));
  dataTransfer.setData("text/plain", payload.absolutePath);
  announceSkillPathDragStart(payload);
}

export function getSkillPathDragPayload(
  dataTransfer: Pick<DataTransfer, "types" | "getData"> | null | undefined
): SkillPathDragPayload | null {
  if (!hasSkillPathDragType(dataTransfer)) {
    return null;
  }

  try {
    const raw = dataTransfer?.getData(SKILL_PATH_DRAG_MIME) ?? "";
    const parsed: unknown = JSON.parse(raw);
    return isSkillPathDragPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function toSkillDragEditorPath(payload: SkillPathDragPayload): string | null {
  if (payload.kind !== "file") {
    return null;
  }

  return toSkillEditorPath(payload.skillSlug, payload.path);
}

export function announceSkillPathDragStart(payload: SkillPathDragPayload): void {
  if (typeof window === "undefined" || typeof CustomEvent === "undefined") {
    return;
  }

  clearSkillPathDragEndListeners?.();
  window.dispatchEvent(new CustomEvent(SKILL_PATH_DRAG_START_EVENT, { detail: payload }));

  const finishDrag = () => announceSkillPathDragEnd();
  window.addEventListener("dragend", finishDrag, { once: true });
  window.addEventListener("drop", finishDrag, { once: true });
  clearSkillPathDragEndListeners = () => {
    window.removeEventListener("dragend", finishDrag);
    window.removeEventListener("drop", finishDrag);
  };
}

export function announceSkillPathDragEnd(): void {
  if (typeof window === "undefined") {
    return;
  }

  clearSkillPathDragEndListeners?.();
  clearSkillPathDragEndListeners = null;
  window.dispatchEvent(new Event(SKILL_PATH_DRAG_END_EVENT));
}
