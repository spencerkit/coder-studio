import clsx from "clsx";
import type { ComponentPropsWithoutRef, CSSProperties } from "react";
import styles from "./index.module.css";

export type SpinnerSize = "sm" | "md" | "lg";

export interface SpinnerProps extends Omit<ComponentPropsWithoutRef<"span">, "children"> {
  readonly label: string;
  readonly size?: SpinnerSize;
}

const sizeMap: Record<SpinnerSize, string> = {
  sm: "12px",
  md: "16px",
  lg: "20px",
};

export function Spinner({ className, label, size = "md", style, ...props }: SpinnerProps) {
  return (
    <span
      {...props}
      aria-label={label}
      className={clsx(styles.spinner, "animate-spin", className)}
      role="status"
      style={
        {
          "--spinner-size": sizeMap[size],
          ...style,
        } as CSSProperties
      }
    />
  );
}
