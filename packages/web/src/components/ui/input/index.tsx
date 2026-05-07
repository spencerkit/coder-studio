import clsx from "clsx";
import { forwardRef, type InputHTMLAttributes } from "react";
import styles from "./index.module.css";

export type InputSize = "sm" | "md" | "lg";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  readonly size?: InputSize;
  readonly invalid?: boolean;
}

const sizeClassMap: Record<InputSize, string | undefined> = {
  sm: styles.sm,
  md: undefined,
  lg: styles.lg,
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid = false, size = "md", "aria-invalid": ariaInvalid, ...props },
  ref
) {
  return (
    <input
      {...props}
      aria-invalid={invalid ? "true" : ariaInvalid}
      className={clsx(
        styles.input,
        sizeClassMap[size],
        invalid ? styles.invalid : undefined,
        "input",
        className
      )}
      ref={ref}
    />
  );
});
