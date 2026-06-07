import clsx from "clsx";
import {
  Children,
  cloneElement,
  type FocusEvent,
  isValidElement,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
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
  readonly children: ReactElement;
  readonly content: ReactNode;
  readonly disabled?: boolean;
}

interface Position {
  readonly left: number;
  readonly top: number;
}

interface TooltipOutsideEvent {
  readonly target: EventTarget | null;
}

type TooltipOutsideSubscriber = (event: TooltipOutsideEvent) => void;

type TriggerProps = {
  "aria-describedby"?: string;
  disabled?: boolean;
  onBlur?: (event: FocusEvent<HTMLElement>) => void;
  onFocus?: (event: FocusEvent<HTMLElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  onMouseEnter?: (event: MouseEvent<HTMLElement>) => void;
  onMouseLeave?: (event: MouseEvent<HTMLElement>) => void;
  onPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void;
};

const tooltipOutsideSubscribers = new Set<TooltipOutsideSubscriber>();
let removeTooltipPointerDownListener: (() => void) | null = null;

function ensureTooltipPointerDownListener() {
  if (removeTooltipPointerDownListener || typeof document === "undefined") {
    return;
  }

  const handlePointerDown = (event: globalThis.PointerEvent) => {
    for (const subscriber of tooltipOutsideSubscribers) {
      subscriber({ target: event.target });
    }
  };

  document.addEventListener("pointerdown", handlePointerDown, true);
  removeTooltipPointerDownListener = () => {
    document.removeEventListener("pointerdown", handlePointerDown, true);
    removeTooltipPointerDownListener = null;
  };
}

function subscribeTooltipOutsidePointerDown(subscriber: TooltipOutsideSubscriber) {
  ensureTooltipPointerDownListener();
  tooltipOutsideSubscribers.add(subscriber);

  return () => {
    tooltipOutsideSubscribers.delete(subscriber);

    if (tooltipOutsideSubscribers.size === 0) {
      removeTooltipPointerDownListener?.();
    }
  };
}

function isTriggerElement(child: unknown): child is ReactElement<TriggerProps> {
  return isValidElement(child);
}

export function Tooltip({ children, content, disabled = false }: TooltipProps) {
  const child = Children.only(children);
  const viewport = useViewport();
  const tooltipId = useId();
  const triggerRef = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const pointerFocusRef = useRef(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [position, setPosition] = useState<Position>({ left: 0, top: 0 });

  if (!isTriggerElement(child)) {
    return child;
  }

  const isInteractive = !disabled && viewport === "desktop";
  const open = isInteractive && (hovered || focused);
  const isDisabledTrigger = child.props.disabled === true;
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
    const viewportPadding = 8;
    const centeredLeft = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
    const maxLeft = Math.max(
      viewportPadding,
      window.innerWidth - tooltipRect.width - viewportPadding
    );
    const left = Math.min(maxLeft, Math.max(viewportPadding, centeredLeft));
    const aboveTop = triggerRect.top - tooltipRect.height - viewportPadding;
    const belowTop = triggerRect.bottom + viewportPadding;
    const maxTop = Math.max(
      viewportPadding,
      window.innerHeight - tooltipRect.height - viewportPadding
    );
    const top = aboveTop >= viewportPadding ? aboveTop : Math.min(maxTop, belowTop);

    setPosition({
      left,
      top: Math.max(viewportPadding, top),
    });
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    return subscribeTooltipOutsidePointerDown(({ target }) => {
      if (!(target instanceof Node)) {
        setHovered(false);
        setFocused(false);
        return;
      }

      if (triggerRef.current?.contains(target)) {
        return;
      }

      setHovered(false);
      setFocused(false);
    });
  }, [open]);

  const trigger = isDisabledTrigger
    ? cloneElement(child, {
        "aria-describedby": describedBy,
      })
    : cloneElement(child, {
        "aria-describedby": describedBy,
        onBlur: (event: FocusEvent<HTMLElement>) => {
          child.props.onBlur?.(event);
          pointerFocusRef.current = false;
          setFocused(false);
        },
        onFocus: (event: FocusEvent<HTMLElement>) => {
          child.props.onFocus?.(event);
          if (!event.defaultPrevented && isInteractive) {
            triggerRef.current = event.currentTarget;
            setFocused(!pointerFocusRef.current);
          }
        },
        onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
          child.props.onKeyDown?.(event);
          pointerFocusRef.current = false;
        },
        onMouseEnter: (event: MouseEvent<HTMLElement>) => {
          child.props.onMouseEnter?.(event);
          if (!event.defaultPrevented && isInteractive) {
            triggerRef.current = event.currentTarget;
            setHovered(true);
          }
        },
        onMouseLeave: (event: MouseEvent<HTMLElement>) => {
          child.props.onMouseLeave?.(event);
          setHovered(false);
        },
        onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
          child.props.onPointerDown?.(event);
          if (!event.defaultPrevented) {
            pointerFocusRef.current = true;
          }
        },
      });

  const renderedTrigger = isDisabledTrigger ? (
    <span
      className={styles.disabledTriggerWrapper}
      onMouseEnter={(event: MouseEvent<HTMLSpanElement>) => {
        if (!event.defaultPrevented && isInteractive) {
          triggerRef.current = event.currentTarget;
          setHovered(true);
        }
      }}
      onMouseLeave={() => {
        setHovered(false);
      }}
    >
      {trigger}
    </span>
  ) : (
    trigger
  );

  return (
    <>
      {renderedTrigger}
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
