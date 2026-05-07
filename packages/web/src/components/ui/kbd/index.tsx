import clsx from "clsx";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import styles from "./index.module.css";

export interface KbdProps extends Omit<ComponentPropsWithoutRef<"kbd">, "children"> {
  readonly children: ReactNode;
  readonly size?: "sm" | "md";
  readonly interactive?: boolean;
}

const sizeClassMap: Record<NonNullable<KbdProps["size"]>, string | undefined> = {
  sm: styles.sm,
  md: undefined,
};

export const Kbd = ({
  children,
  className,
  interactive = false,
  onKeyDown,
  size = "md",
  tabIndex,
  ...props
}: KbdProps) => {
  return (
    <kbd
      {...props}
      className={clsx(
        styles.kbd,
        sizeClassMap[size],
        interactive ? styles.interactive : undefined,
        "shortcuts-key",
        className
      )}
      onKeyDown={(event) => {
        if (interactive && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          event.currentTarget.click();
        }
        onKeyDown?.(event);
      }}
      role={interactive ? "button" : props.role}
      tabIndex={interactive ? (tabIndex ?? 0) : tabIndex}
    >
      {children}
    </kbd>
  );
};
