import clsx from "clsx";
import type { ComponentPropsWithoutRef } from "react";
import styles from "./index.module.css";

export interface BadgeProps extends ComponentPropsWithoutRef<"span"> {
  readonly count: number;
  readonly max?: number;
}

export function Badge({ className, count, max = 99, ...props }: BadgeProps) {
  if (count <= 0) {
    return null;
  }

  const displayCount = count > max ? `${max}+` : String(count);

  return (
    <span {...props} className={clsx(styles.badge, "topbar-unread", className)}>
      {displayCount}
    </span>
  );
}
