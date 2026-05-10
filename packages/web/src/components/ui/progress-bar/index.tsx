import clsx from "clsx";
import type { ComponentPropsWithoutRef, CSSProperties } from "react";
import styles from "./index.module.css";

export type ProgressBarTone = "success" | "warning" | "error" | "info" | "neutral";

export interface ProgressBarProps extends Omit<ComponentPropsWithoutRef<"div">, "children"> {
  readonly fillClassName?: string;
  readonly indeterminate?: boolean;
  readonly max: number;
  readonly tone: ProgressBarTone;
  readonly value: number;
}

const toneClassMap: Record<ProgressBarTone, string> = {
  success: styles.success,
  warning: styles.warning,
  error: styles.error,
  info: styles.info,
  neutral: styles.neutral,
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function ProgressBar({
  className,
  fillClassName,
  indeterminate = false,
  max,
  style,
  tone,
  value,
  ...props
}: ProgressBarProps) {
  const decorative = props["aria-hidden"] === true || props["aria-hidden"] === "true";
  const safeMax = max > 0 ? max : 0;
  const clampedValue = clamp(value, 0, safeMax);
  const width = safeMax > 0 ? clamp((clampedValue / safeMax) * 100, 0, 100) : 0;

  return (
    <div
      {...props}
      aria-valuemax={decorative ? undefined : safeMax}
      aria-valuemin={decorative ? undefined : 0}
      aria-valuenow={decorative || indeterminate ? undefined : clampedValue}
      className={clsx(styles.root, indeterminate ? styles.indeterminate : undefined, className)}
      role={decorative ? undefined : "progressbar"}
      style={style}
    >
      <div
        className={clsx(styles.fill, toneClassMap[tone], fillClassName)}
        style={
          indeterminate
            ? undefined
            : ({
                "--progress-bar-width": `${width}%`,
              } as CSSProperties)
        }
      />
    </div>
  );
}
