import clsx from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./index.module.css";

export type IconButtonVariant = "ghost" | "filled";
export type IconButtonSize = "sm" | "md" | "lg";

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children"> {
  readonly "aria-label": string;
  readonly className?: string;
  readonly icon: ReactNode;
  readonly size?: IconButtonSize;
  readonly variant?: IconButtonVariant;
}

const variantClassMap: Record<IconButtonVariant, string> = {
  ghost: styles.ghost,
  filled: styles.filled,
};

const sizeClassMap: Record<IconButtonSize, string | undefined> = {
  sm: styles.sm,
  md: undefined,
  lg: styles.lg,
};

const legacyVariantClassMap: Record<IconButtonVariant, string> = {
  ghost: "btn-ghost",
  filled: "btn-secondary",
};

const legacySizeClassMap: Record<IconButtonSize, string | undefined> = {
  sm: "btn-sm",
  md: undefined,
  lg: "btn-lg",
};

export const IconButton = ({
  "aria-label": ariaLabel,
  className,
  icon,
  size = "md",
  type,
  variant = "ghost",
  ...buttonProps
}: IconButtonProps) => {
  return (
    <button
      {...buttonProps}
      aria-label={ariaLabel}
      className={clsx(
        styles.root,
        variantClassMap[variant],
        sizeClassMap[size],
        "btn",
        legacyVariantClassMap[variant],
        legacySizeClassMap[size],
        className
      )}
      type={type ?? "button"}
    >
      <span aria-hidden="true" className={styles.icon}>
        {icon}
      </span>
    </button>
  );
};
