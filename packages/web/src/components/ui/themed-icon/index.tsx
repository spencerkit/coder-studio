import clsx from "clsx";
import { useAtomValue } from "jotai";
import type { ComponentPropsWithoutRef } from "react";
import { themeAtom } from "../../../atoms/app-ui";
import { getIconPresentation, type IconSemantic } from "../../../theme";
import styles from "./index.module.css";

export interface ThemedIconProps extends Omit<ComponentPropsWithoutRef<"span">, "children"> {
  readonly decorative?: boolean;
  readonly semantic: IconSemantic;
  readonly size?: number;
}

export function ThemedIcon({
  className,
  decorative = true,
  role,
  semantic,
  size = 14,
  ...spanProps
}: ThemedIconProps) {
  const themeId = useAtomValue(themeAtom);
  const presentation = getIconPresentation(themeId, semantic);
  const Icon = presentation.Icon;

  return (
    <span
      {...spanProps}
      aria-hidden={decorative ? true : undefined}
      className={clsx(
        styles.root,
        "themed-icon",
        `themed-icon--tone-${presentation.tone}`,
        `themed-icon--surface-${presentation.surface}`,
        className
      )}
      data-icon-semantic={semantic}
      data-testid={spanProps["data-testid"] ?? "themed-icon"}
      role={decorative ? undefined : (role ?? "img")}
    >
      <Icon size={size} strokeWidth={presentation.strokeWidth} />
    </span>
  );
}
