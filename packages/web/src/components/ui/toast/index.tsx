import clsx from "clsx";
import { X } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import { IconButton } from "../icon-button";
import styles from "./index.module.css";

export type ToastTone = "success" | "error" | "warning" | "info";

export interface ToastViewportProps extends HTMLAttributes<HTMLDivElement> {
  readonly children: ReactNode;
  readonly mobile?: boolean;
}

export interface ToastProps extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "onClick"> {
  readonly actionLabel?: string;
  readonly closeLabel?: string;
  readonly description?: ReactNode;
  readonly icon?: ReactNode;
  readonly onAction?: () => void;
  readonly onClick?: () => void;
  readonly onDismiss: () => void;
  readonly title: ReactNode;
  readonly tone: ToastTone;
}

const toneClassMap: Record<ToastTone, string> = {
  success: styles.success,
  error: styles.error,
  warning: styles.warning,
  info: styles.info,
};

const legacyToneClassMap: Record<ToastTone, string> = {
  success: "toast--success",
  error: "toast--error",
  warning: "toast--warning",
  info: "toast--info",
};

export function ToastViewport({
  children,
  className,
  mobile = false,
  ...props
}: ToastViewportProps) {
  return (
    <div
      {...props}
      className={clsx(
        styles.viewport,
        mobile ? styles.mobile : undefined,
        "toast-container",
        mobile ? "toast-container--mobile" : undefined,
        className
      )}
    >
      {children}
    </div>
  );
}

export function Toast({
  actionLabel,
  className,
  closeLabel = "Dismiss",
  description,
  icon,
  onAction,
  onClick,
  onDismiss,
  title,
  tone,
  ...props
}: ToastProps) {
  const clickable = typeof onClick === "function";
  const { ["aria-live"]: ariaLive, ...restProps } = props;

  return (
    <div
      {...restProps}
      aria-live={ariaLive}
      className={clsx(
        styles.toast,
        toneClassMap[tone],
        clickable ? styles.clickable : undefined,
        "toast",
        legacyToneClassMap[tone],
        className
      )}
      onClick={onClick}
      role="alert"
    >
      {icon ? (
        <span aria-hidden="true" className={clsx(styles.icon, "toast__icon")}>
          {icon}
        </span>
      ) : null}

      <div className={clsx(styles.content, "toast__content")}>
        <span className={clsx(styles.title, "toast__title")}>{title}</span>
        {description ? (
          <span className={clsx(styles.body, "toast__body")}>{description}</span>
        ) : null}
      </div>

      {actionLabel && onAction ? (
        <button
          className={styles.action}
          onClick={(event) => {
            event.stopPropagation();
            onAction();
          }}
          type="button"
        >
          {actionLabel}
        </button>
      ) : null}

      <IconButton
        aria-label={closeLabel}
        className={clsx(styles.close, "toast__close")}
        icon={<X size={14} />}
        onClick={(event) => {
          event.stopPropagation();
          onDismiss();
        }}
        size="sm"
      />
    </div>
  );
}
