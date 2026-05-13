import clsx from "clsx";
import type { ButtonHTMLAttributes, CSSProperties } from "react";
import styles from "./index.module.css";

export type SwitchSize = "sm" | "md";

export interface SwitchProps
  extends Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    "aria-checked" | "children" | "onChange" | "role" | "size" | "type"
  > {
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
  readonly disabled?: boolean;
  readonly size?: SwitchSize;
}

const sizeMap: Record<
  SwitchSize,
  {
    readonly trackWidth: string;
    readonly trackHeight: string;
    readonly thumbSize: string;
    readonly offset: string;
  }
> = {
  sm: {
    trackWidth: "32px",
    trackHeight: "18px",
    thumbSize: "14px",
    offset: "2px",
  },
  md: {
    trackWidth: "36px",
    trackHeight: "20px",
    thumbSize: "16px",
    offset: "2px",
  },
};

export function Switch({
  checked,
  className,
  disabled = false,
  onCheckedChange,
  onClick,
  size = "md",
  style,
  ...props
}: SwitchProps) {
  const dimensions = sizeMap[size];

  return (
    <button
      {...props}
      aria-checked={checked}
      className={clsx(styles.switch, checked ? styles.checked : undefined, className)}
      disabled={disabled}
      onClick={(event) => {
        onClick?.(event);
        if (disabled || event.defaultPrevented) {
          return;
        }
        onCheckedChange(!checked);
      }}
      role="switch"
      style={
        {
          "--switch-track-width": dimensions.trackWidth,
          "--switch-track-height": dimensions.trackHeight,
          "--switch-thumb-size": dimensions.thumbSize,
          "--switch-thumb-offset": dimensions.offset,
          ...style,
        } as CSSProperties
      }
      type="button"
    >
      <span aria-hidden="true" className={styles.track}>
        <span className={styles.thumb} />
      </span>
    </button>
  );
}
