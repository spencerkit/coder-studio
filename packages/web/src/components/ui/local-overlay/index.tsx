import clsx from "clsx";
import type { ReactNode } from "react";
import { isOverlayClick } from "../_internal/dismiss";
import styles from "./index.module.css";

export interface LocalOverlayProps {
  readonly open: boolean;
  readonly children: ReactNode;
  readonly className?: string;
  readonly surfaceClassName?: string;
  readonly mode?: "status" | "dialog";
  readonly interactive?: boolean;
  readonly onDismiss?: () => void;
  readonly ariaLabelledBy?: string;
}

export function LocalOverlay({
  open,
  children,
  className,
  surfaceClassName,
  mode = "status",
  interactive,
  onDismiss,
  ariaLabelledBy,
}: LocalOverlayProps) {
  if (!open) {
    return null;
  }

  const isInteractive = interactive ?? mode === "dialog";

  return (
    <div
      aria-labelledby={ariaLabelledBy}
      aria-live={mode === "status" ? "polite" : undefined}
      aria-modal={mode === "dialog" ? "true" : undefined}
      className={clsx(styles.overlay, "local-overlay", className)}
      data-interactive={isInteractive ? "true" : "false"}
      onClick={(event) => {
        if (isInteractive && onDismiss && isOverlayClick(event)) {
          onDismiss();
        }
      }}
      role={mode === "dialog" ? "dialog" : "status"}
    >
      <div className={clsx(styles.card, "local-overlay__card", surfaceClassName)}>{children}</div>
    </div>
  );
}
