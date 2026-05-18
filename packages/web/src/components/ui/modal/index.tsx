import clsx from "clsx";
import {
  createContext,
  type HTMLAttributes,
  type ReactNode,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { isEscapeKey, isOverlayClick } from "../_internal/dismiss";
import { resolveInitialFocusTarget, restoreFocus, trapFocus } from "../_internal/focus-trap";
import { Portal } from "../_internal/portal";
import styles from "./index.module.css";

export type ModalSize = "sm" | "md" | "lg" | "full";

interface ModalContextValue {
  readonly titleId: string;
}

const ModalContext = createContext<ModalContextValue | null>(null);

export interface ModalProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly dismissible?: boolean;
  readonly initialFocus?: HTMLElement | null | (() => HTMLElement | null);
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
  readonly size?: ModalSize;
}

const sizeClassMap: Record<ModalSize, string | undefined> = {
  sm: styles.sm,
  md: styles.md,
  lg: styles.lg,
  full: styles.full,
};

const legacySizeClassMap: Record<ModalSize, string | undefined> = {
  sm: undefined,
  md: undefined,
  lg: "modal-card-lg",
  full: undefined,
};

export function Modal({
  children,
  className,
  dismissible = true,
  initialFocus,
  onOpenChange,
  open,
  size = "md",
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<Element | null>(null);
  const titleId = useId();
  const contextValue = useMemo(() => ({ titleId }), [titleId]);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    restoreFocusRef.current = document.activeElement;
    const dialog = dialogRef.current;

    if (!dialog) {
      return;
    }

    const target = resolveInitialFocusTarget(dialog, initialFocus);
    target.focus();

    return () => {
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
        className={clsx(styles.overlay, "modal-overlay")}
        onClick={(event) => {
          if (dismissible && isOverlayClick(event)) {
            onOpenChange(false);
          }
        }}
      >
        <ModalContext.Provider value={contextValue}>
          <div
            aria-labelledby={titleId}
            aria-modal="true"
            className={clsx(
              styles.card,
              sizeClassMap[size],
              "modal-card",
              legacySizeClassMap[size],
              className
            )}
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
            ref={dialogRef}
            role="dialog"
            tabIndex={-1}
          >
            {children}
          </div>
        </ModalContext.Provider>
      </div>
    </Portal>
  );
}

export function ModalHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={clsx(styles.header, "modal-header", className)} />;
}

export function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={clsx(
        styles.header,
        styles.dialogHeader,
        "modal-header",
        "dialog-header",
        className
      )}
    />
  );
}

export function ModalTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  const context = useContext(ModalContext);
  const fallbackId = useId();
  const titleId = context?.titleId ?? fallbackId;

  return <h2 {...props} className={clsx(styles.title, "modal-title", className)} id={titleId} />;
}

export function ModalBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={clsx(styles.body, "modal-body", className)} />;
}

export function ModalFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={clsx(styles.footer, "modal-footer", className)} />;
}
