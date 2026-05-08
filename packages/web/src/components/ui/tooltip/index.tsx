import clsx from "clsx";
import {
  Children,
  cloneElement,
  type FocusEvent,
  isValidElement,
  type MouseEvent,
  type ReactElement,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Portal } from "../_internal/portal";
import { useViewport } from "../_internal/use-viewport";
import styles from "./index.module.css";

export interface TooltipProps {
  readonly content: string;
  readonly children: ReactElement;
  readonly disabled?: boolean;
}

interface Position {
  readonly left: number;
  readonly top: number;
}

function isTriggerElement(child: unknown): child is ReactElement<{
  onBlur?: (event: FocusEvent<HTMLElement>) => void;
  onFocus?: (event: FocusEvent<HTMLElement>) => void;
  onMouseEnter?: (event: MouseEvent<HTMLElement>) => void;
  onMouseLeave?: (event: MouseEvent<HTMLElement>) => void;
  "aria-describedby"?: string;
}> {
  return isValidElement(child);
}

export function Tooltip({ content, children, disabled = false }: TooltipProps) {
  const child = Children.only(children);
  const viewport = useViewport();
  const tooltipId = useId();
  const triggerRef = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [position, setPosition] = useState<Position>({ left: 0, top: 0 });

  if (!isTriggerElement(child)) {
    return child;
  }

  const isInteractive = !disabled && viewport === "desktop";
  const open = isInteractive && (hovered || focused);
  const existingDescribedBy = child.props["aria-describedby"];
  const describedBy = useMemo(() => {
    if (!open) {
      return existingDescribedBy;
    }

    return [existingDescribedBy, tooltipId].filter(Boolean).join(" ");
  }, [existingDescribedBy, open, tooltipId]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !tooltipRef.current) {
      return;
    }

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const centeredLeft = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
    const maxLeft = Math.max(8, window.innerWidth - tooltipRect.width - 8);
    const left = Math.min(maxLeft, Math.max(8, centeredLeft));
    const top = triggerRect.top - tooltipRect.height - 8;

    setPosition({
      left,
      top: Math.max(8, top),
    });
  }, [open]);

  const trigger = cloneElement(child, {
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node;

      const childRef = child.props.ref;
      if (typeof childRef === "function") {
        childRef(node);
      } else if (childRef && typeof childRef === "object") {
        childRef.current = node;
      }
    },
    "aria-describedby": describedBy,
    onMouseEnter: (event: MouseEvent<HTMLElement>) => {
      child.props.onMouseEnter?.(event);
      if (!event.defaultPrevented && isInteractive) {
        setHovered(true);
      }
    },
    onMouseLeave: (event: MouseEvent<HTMLElement>) => {
      child.props.onMouseLeave?.(event);
      setHovered(false);
    },
    onFocus: (event: FocusEvent<HTMLElement>) => {
      child.props.onFocus?.(event);
      if (!event.defaultPrevented && isInteractive) {
        setFocused(true);
      }
    },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      child.props.onBlur?.(event);
      setFocused(false);
    },
  });

  return (
    <>
      {trigger}
      {open ? (
        <Portal>
          <div
            className={clsx(styles.tooltip)}
            id={tooltipId}
            ref={tooltipRef}
            role="tooltip"
            style={{
              left: `${position.left}px`,
              top: `${position.top}px`,
            }}
          >
            {content}
          </div>
        </Portal>
      ) : null}
    </>
  );
}
