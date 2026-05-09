import clsx from "clsx";
import { forwardRef, type InputHTMLAttributes } from "react";
import styles from "./index.module.css";

export type InputSize = "sm" | "md" | "lg";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  readonly size?: InputSize;
  readonly htmlSize?: InputHTMLAttributes<HTMLInputElement>["size"];
  readonly invalid?: boolean;
}

const sizeClassMap: Record<InputSize, string | undefined> = {
  sm: styles.sm,
  md: undefined,
  lg: styles.lg,
};

const legacySizeClassMap: Record<InputSize, string | undefined> = {
  sm: "input-sm",
  md: undefined,
  lg: "input-lg",
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, size = "md", htmlSize, invalid, ...props },
  ref
) {
  const ariaInvalid = invalid === undefined ? props["aria-invalid"] : invalid ? "true" : "false";

  return (
    <input
      {...props}
      ref={ref}
      size={htmlSize}
      aria-invalid={ariaInvalid}
      className={clsx(
        styles.input,
        sizeClassMap[size],
        "input",
        legacySizeClassMap[size],
        invalid ? styles.invalid : undefined,
        className
      )}
    />
  );
});
