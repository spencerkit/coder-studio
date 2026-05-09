import clsx from "clsx";
import type { HTMLAttributes, ReactNode } from "react";
import styles from "./index.module.css";

export type NoticeTone = "info" | "success" | "warning" | "error";

export interface NoticeProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  readonly actionLabel?: string;
  readonly message?: ReactNode;
  readonly onAction?: () => void;
  readonly title?: ReactNode;
  readonly tone?: NoticeTone;
}

const toneClassMap: Record<NoticeTone, string | undefined> = {
  info: styles.info,
  success: styles.success,
  warning: styles.warning,
  error: styles.error,
};

const legacyToneClassMap: Record<NoticeTone, string | undefined> = {
  info: undefined,
  success: undefined,
  warning: undefined,
  error: "settings-page__notice--error",
};

export function Notice({
  actionLabel,
  className,
  message,
  onAction,
  title,
  tone = "info",
  ...props
}: NoticeProps) {
  return (
    <div
      {...props}
      className={clsx(
        styles.notice,
        toneClassMap[tone],
        "settings-page__notice",
        legacyToneClassMap[tone],
        className
      )}
    >
      {title || message ? (
        <div className={clsx(styles.copy, "settings-page__notice-copy")}>
          {title ? (
            <span className={clsx(styles.title, "settings-page__notice-title")}>{title}</span>
          ) : null}
          {message ? (
            <span className={clsx(styles.message, "settings-page__notice-message")}>{message}</span>
          ) : null}
        </div>
      ) : null}

      {actionLabel && onAction ? (
        <button
          className={clsx(styles.action, "settings-page__notice-action")}
          onClick={onAction}
          type="button"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
