import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";

export function isOverlayClick(
  event:
    | Pick<MouseEvent, "target" | "currentTarget">
    | Pick<ReactMouseEvent<HTMLElement>, "target" | "currentTarget">
) {
  return event.target === event.currentTarget;
}

export function isEscapeKey(
  event: Pick<KeyboardEvent, "key"> | Pick<ReactKeyboardEvent<HTMLElement>, "key">
) {
  return event.key === "Escape";
}
