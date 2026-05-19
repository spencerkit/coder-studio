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
import { lockBodyScroll } from "../_internal/body-scroll-lock";
import { isEscapeKey, isOverlayClick } from "../_internal/dismiss";
import { resolveInitialFocusTarget, restoreFocus, trapFocus } from "../_internal/focus-trap";
import { Portal } from "../_internal/portal";
import styles from "./index.module.css";

interface DrawerContextValue {
  readonly titleId: string;
}

const DrawerContext = createContext<DrawerContextValue | null>(null);

export interface DrawerProps {
  readonly children: ReactNode;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title?: ReactNode;
  readonly footer?: ReactNode;
  readonly className?: string;
  readonly dismissible?: boolean;
  readonly backdropDismiss?: boolean;
  readonly initialFocus?: HTMLElement | null | (() => HTMLElement | null);
  readonly headerActions?: ReactNode;
  readonly ariaLabel?: string;
}

export function Drawer({
  children,
  open,
  onOpenChange,
  title,
  footer,
  className,
  dismissible = true,
  backdropDismiss = false,
  initialFocus,
  headerActions,
  ariaLabel,
}: DrawerProps) {
  const panelRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef<Element | null>(null);
  const titleId = useId();
  const contextValue = useMemo(() => ({ titleId }), [titleId]);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    restoreFocusRef.current = document.activeElement;
    const panel = panelRef.current;
    const unlockBodyScroll = lockBodyScroll();

    if (!panel) {
      return unlockBodyScroll;
    }

    const target = resolveInitialFocusTarget(panel, initialFocus);
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
        className={clsx(styles.backdrop, "drawer-backdrop")}
        onClick={(event) => {
          if (dismissible && backdropDismiss && isOverlayClick(event)) {
            onOpenChange(false);
          }
        }}
      >
        <DrawerContext.Provider value={contextValue}>
          <section
            aria-label={title ? undefined : ariaLabel}
            aria-labelledby={title ? titleId : undefined}
            aria-modal="true"
            className={clsx(styles.panel, "drawer-panel", className)}
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
            ref={panelRef}
            role="dialog"
            tabIndex={-1}
          >
            {title || headerActions ? (
              <header className={clsx(styles.header, "drawer-header")}>
                {title ? <DrawerTitle>{title}</DrawerTitle> : <div />}
                {headerActions ? (
                  <div className={clsx(styles.headerActions, "drawer-header-actions")}>
                    {headerActions}
                  </div>
                ) : null}
              </header>
            ) : null}
            <div className={clsx(styles.body, "drawer-body")}>{children}</div>
            {footer ? (
              <footer className={clsx(styles.footer, "drawer-footer")}>{footer}</footer>
            ) : null}
          </section>
        </DrawerContext.Provider>
      </div>
    </Portal>
  );
}

export function DrawerTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  const context = useContext(DrawerContext);
  const fallbackId = useId();
  const titleId = context?.titleId ?? fallbackId;

  return <h2 {...props} className={clsx(styles.title, "drawer-title", className)} id={titleId} />;
}
