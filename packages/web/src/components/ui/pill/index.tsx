import clsx from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./index.module.css";

export interface PillProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "type"> {
  readonly children: ReactNode;
  readonly active?: boolean;
  readonly selected?: boolean;
  readonly leadingIcon?: ReactNode;
}

export function Pill({
  active = false,
  children,
  className,
  disabled = false,
  leadingIcon,
  selected = false,
  ...props
}: PillProps) {
  const isActive = active || selected;

  return (
    <button
      {...props}
      aria-pressed={isActive}
      className={clsx(
        styles.pill,
        isActive ? styles.active : undefined,
        "settings-pill",
        isActive ? "settings-pill-active" : undefined,
        disabled ? "settings-pill-disabled" : undefined,
        className
      )}
      disabled={disabled}
      type="button"
    >
      {leadingIcon ? (
        <span aria-hidden="true" className={styles.icon}>
          {leadingIcon}
        </span>
      ) : null}
      <span>{children}</span>
    </button>
  );
}
