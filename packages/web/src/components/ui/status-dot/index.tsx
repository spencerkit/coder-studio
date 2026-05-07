import clsx from "clsx";
import type { ComponentPropsWithoutRef, CSSProperties } from "react";
import styles from "./index.module.css";

export type StatusDotTone = "success" | "warning" | "error" | "info" | "neutral";
export type StatusDotSize = "sm" | "md" | "lg";

export interface StatusDotProps extends Omit<ComponentPropsWithoutRef<"span">, "children"> {
  readonly tone?: StatusDotTone;
  readonly size?: StatusDotSize;
  readonly pulse?: boolean;
}

const toneColorMap: Record<StatusDotTone, string> = {
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  error: "var(--color-error)",
  info: "var(--color-info)",
  neutral: "var(--text-tertiary)",
};

const sizeMap: Record<StatusDotSize, string> = {
  sm: "6px",
  md: "8px",
  lg: "10px",
};

export function StatusDot({
  className,
  pulse = false,
  size = "md",
  style,
  tone = "neutral",
  "aria-hidden": ariaHidden = true,
  ...props
}: StatusDotProps) {
  return (
    <span
      {...props}
      aria-hidden={ariaHidden}
      className={clsx(styles.dot, pulse ? styles.pulse : undefined, className)}
      style={
        {
          "--status-dot-current-color": toneColorMap[tone],
          "--status-dot-current-size": sizeMap[size],
          ...style,
        } as CSSProperties
      }
    />
  );
}
