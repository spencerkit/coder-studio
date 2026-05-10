import type { KeyboardEvent as ReactKeyboardEvent } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  'button:not([disabled]):not([tabindex="-1"])',
  'input:not([disabled]):not([type="hidden"]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  'iframe:not([tabindex="-1"])',
  'object:not([tabindex="-1"])',
  'embed:not([tabindex="-1"])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

function isHTMLElement(node: Element | null): node is HTMLElement {
  return node instanceof HTMLElement;
}

export function getFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.hidden && element.getAttribute("aria-hidden") !== "true"
  );
}

export function resolveInitialFocusTarget(
  container: HTMLElement,
  initialFocus?: HTMLElement | null | (() => HTMLElement | null)
) {
  const requestedTarget = typeof initialFocus === "function" ? initialFocus() : initialFocus;

  if (
    requestedTarget &&
    container.contains(requestedTarget) &&
    !requestedTarget.hasAttribute("disabled")
  ) {
    return requestedTarget;
  }

  return getFocusableElements(container)[0] ?? container;
}

export function trapFocus(
  container: HTMLElement,
  event: KeyboardEvent | ReactKeyboardEvent<HTMLElement>
) {
  if (event.key !== "Tab") {
    return;
  }

  const focusableElements = getFocusableElements(container);
  if (focusableElements.length === 0) {
    event.preventDefault();
    container.focus();
    return;
  }

  const first = focusableElements[0];
  const last = focusableElements[focusableElements.length - 1];
  const activeElement = isHTMLElement(document.activeElement) ? document.activeElement : null;

  if (event.shiftKey) {
    if (!activeElement || activeElement === first || !container.contains(activeElement)) {
      event.preventDefault();
      last.focus();
    }
    return;
  }

  if (!activeElement || activeElement === last || !container.contains(activeElement)) {
    event.preventDefault();
    first.focus();
  }
}

export function restoreFocus(target: Element | null) {
  if (target instanceof HTMLElement && target.isConnected) {
    target.focus();
  }
}
