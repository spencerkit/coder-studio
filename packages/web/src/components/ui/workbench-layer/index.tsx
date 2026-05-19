import clsx from "clsx";
import { type ReactNode, useLayoutEffect, useRef } from "react";
import { lockBodyScroll } from "../_internal/body-scroll-lock";
import { isEscapeKey, isOverlayClick } from "../_internal/dismiss";
import { resolveInitialFocusTarget, restoreFocus, trapFocus } from "../_internal/focus-trap";
import { Portal } from "../_internal/portal";
import styles from "./index.module.css";

export interface WorkbenchLayerProps {
  readonly children: ReactNode;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly className?: string;
  readonly dismissible?: boolean;
  readonly initialFocus?: HTMLElement | null | (() => HTMLElement | null);
  readonly ariaLabel?: string;
  readonly ariaLabelledBy?: string;
}

export function WorkbenchLayer({
  children,
  open,
  onOpenChange,
  className,
  dismissible = true,
  initialFocus,
  ariaLabel,
  ariaLabelledBy,
}: WorkbenchLayerProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<Element | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    restoreFocusRef.current = document.activeElement;
    const surface = surfaceRef.current;
    const unlockBodyScroll = lockBodyScroll();

    if (!surface) {
      return unlockBodyScroll;
    }

    const target = resolveInitialFocusTarget(surface, initialFocus);
    target.focus();

    return () => {
      unlockBodyScroll();
      restoreFocus(restoreFocusRef.current);
      restoreFocusRef.current = null;
    };
  }, [initialFocus, open]);

  if (!open) {
    return null;
  }

  return (
    <Portal>
      <div
        className={clsx(styles.backdrop, "workbench-layer-backdrop")}
        onClick={(event) => {
          if (dismissible && isOverlayClick(event)) {
            onOpenChange(false);
          }
        }}
      >
        <div
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-modal="true"
          className={clsx(styles.surface, "workbench-layer", className)}
          onClick={(event) => {
            event.stopPropagation();
          }}
          onKeyDown={(event) => {
            if (isEscapeKey(event)) {
              if (dismissible) {
                event.preventDefault();
                event.stopPropagation();
                onOpenChange(false);
              }
              return;
            }

            trapFocus(event.currentTarget, event);
          }}
          ref={surfaceRef}
          role="dialog"
          tabIndex={-1}
        >
          {children}
        </div>
      </div>
    </Portal>
  );
}
