import clsx from "clsx";
import {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { isEscapeKey } from "../_internal/dismiss";
import { restoreFocus } from "../_internal/focus-trap";
import { Portal } from "../_internal/portal";
import { useViewport } from "../_internal/use-viewport";
import { Sheet } from "../sheet";
import styles from "./index.module.css";

export type PopoverForceMode = "auto" | "desktop" | "mobile";
export type PopoverPlacement = "bottom-start" | "bottom-end";

type TriggerProps = {
  "aria-controls"?: string;
  "aria-expanded"?: boolean;
  "aria-haspopup"?: "dialog";
  onClick?: (event: ReactMouseEvent<HTMLElement>) => void;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLElement>) => void;
};

interface Position {
  readonly left: number;
  readonly top: number;
  readonly visibility: "hidden" | "visible";
}

export interface PopoverProps {
  readonly children: ReactElement;
  readonly content: ReactNode;
  readonly title: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly forceMode?: PopoverForceMode;
  readonly placement?: PopoverPlacement;
  readonly contentClassName?: string;
  readonly sheetBodyClassName?: string;
}

const VIEWPORT_PADDING = 8;
const CONTENT_OFFSET = 8;

function isTriggerElement(child: unknown): child is ReactElement<TriggerProps> {
  return isValidElement(child);
}

export function Popover({
  children,
  content,
  title,
  open,
  onOpenChange,
  forceMode = "auto",
  placement = "bottom-start",
  contentClassName,
  sheetBodyClassName,
}: PopoverProps) {
  const viewport = useViewport();
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<Element | null>(null);
  const contentId = useId();
  const resolvedMode =
    forceMode === "desktop" ? "desktop" : forceMode === "mobile" ? "mobile" : viewport;
  const desktopOpen = open && resolvedMode === "desktop";
  const mobileOpen = open && resolvedMode === "mobile";
  const [position, setPosition] = useState<Position>({
    left: VIEWPORT_PADDING,
    top: VIEWPORT_PADDING,
    visibility: "hidden",
  });
  const child = Children.only(children);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    restoreFocusRef.current = document.activeElement;

    return () => {
      restoreFocus(restoreFocusRef.current);
      restoreFocusRef.current = null;
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!desktopOpen || !triggerRef.current || !contentRef.current) {
      setPosition((current) =>
        current.visibility === "hidden"
          ? current
          : {
              ...current,
              visibility: "hidden",
            }
      );
      return;
    }

    const updatePosition = () => {
      if (!triggerRef.current || !contentRef.current) {
        return;
      }

      const triggerRect = triggerRef.current.getBoundingClientRect();
      const contentRect = contentRef.current.getBoundingClientRect();
      const preferredLeft =
        placement === "bottom-end" ? triggerRect.right - contentRect.width : triggerRect.left;
      const maxLeft = Math.max(
        VIEWPORT_PADDING,
        window.innerWidth - contentRect.width - VIEWPORT_PADDING
      );
      const left = Math.min(maxLeft, Math.max(VIEWPORT_PADDING, preferredLeft));
      const bottomTop = triggerRect.bottom + CONTENT_OFFSET;
      const top =
        bottomTop + contentRect.height <= window.innerHeight - VIEWPORT_PADDING
          ? bottomTop
          : Math.max(VIEWPORT_PADDING, triggerRect.top - contentRect.height - CONTENT_OFFSET);

      setPosition({
        left,
        top,
        visibility: "visible",
      });
    };

    updatePosition();

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [desktopOpen, placement]);

  useLayoutEffect(() => {
    if (!desktopOpen || !contentRef.current) {
      return;
    }

    contentRef.current.focus();
  }, [desktopOpen]);

  useEffect(() => {
    if (!desktopOpen) {
      return;
    }

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      if (!(event.target instanceof Node)) {
        return;
      }

      if (
        triggerRef.current?.contains(event.target) ||
        contentRef.current?.contains(event.target)
      ) {
        return;
      }

      onOpenChange(false);
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!isEscapeKey(event)) {
        return;
      }

      event.preventDefault();
      onOpenChange(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [desktopOpen, onOpenChange]);

  if (!isTriggerElement(child)) {
    throw new Error("Popover requires a single trigger React element.");
  }

  const renderedTrigger = cloneElement(child, {
    "aria-controls": desktopOpen ? contentId : undefined,
    "aria-expanded": open,
    "aria-haspopup": "dialog",
    onClick: (event: ReactMouseEvent<HTMLElement>) => {
      child.props.onClick?.(event);
      if (!event.defaultPrevented) {
        onOpenChange(!open);
      }
    },
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
      child.props.onKeyDown?.(event);
      if (event.defaultPrevented) {
        return;
      }

      if (event.key === "ArrowDown" && !open) {
        event.preventDefault();
        onOpenChange(true);
        return;
      }

      if (isEscapeKey(event) && open) {
        event.preventDefault();
        onOpenChange(false);
      }
    },
  });

  return (
    <>
      <span className={styles.triggerWrapper} ref={triggerRef}>
        {renderedTrigger}
      </span>

      {desktopOpen ? (
        <Portal>
          <div
            aria-label={title}
            aria-modal="false"
            className={clsx(styles.content, contentClassName)}
            id={contentId}
            onKeyDown={(event) => {
              if (isEscapeKey(event)) {
                event.preventDefault();
                event.stopPropagation();
                onOpenChange(false);
              }
            }}
            ref={contentRef}
            role="dialog"
            style={{
              left: `${position.left}px`,
              top: `${position.top}px`,
              visibility: position.visibility,
            }}
            tabIndex={-1}
          >
            {content}
          </div>
        </Portal>
      ) : null}

      {mobileOpen ? (
        <Sheet
          body={<div>{content}</div>}
          bodyClassName={sheetBodyClassName}
          onClose={() => onOpenChange(false)}
          title={title}
        />
      ) : null}
    </>
  );
}

export default Popover;
