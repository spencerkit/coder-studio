import clsx from "clsx";
import type { ComponentPropsWithoutRef } from "react";
import styles from "./index.module.css";

export type TagColor = "blue" | "green" | "amber" | "pink" | "purple" | "neutral";
export type TagSize = "sm" | "md";

export interface TagProps extends ComponentPropsWithoutRef<"span"> {
  readonly color?: TagColor;
  readonly size?: TagSize;
  readonly caps?: boolean;
}

const colorClassMap: Record<TagColor, string> = {
  blue: styles.blue,
  green: styles.green,
  amber: styles.amber,
  pink: styles.pink,
  purple: styles.purple,
  neutral: styles.neutral,
};

const legacyColorClassMap: Record<TagColor, string> = {
  blue: "badge-blue",
  green: "badge-green",
  amber: "badge-amber",
  pink: "badge-pink",
  purple: "badge-purple",
  neutral: "badge-gray",
};

const sizeClassMap: Record<TagSize, string | undefined> = {
  sm: styles.sm,
  md: undefined,
};

export function Tag({
  caps = true,
  className,
  color = "neutral",
  size = "md",
  ...props
}: TagProps) {
  return (
    <span
      {...props}
      className={clsx(
        styles.tag,
        colorClassMap[color],
        sizeClassMap[size],
        !caps ? styles.noCaps : undefined,
        "badge",
        legacyColorClassMap[color],
        className
      )}
    />
  );
}
