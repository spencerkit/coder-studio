import clsx from "clsx";
import { forwardRef, type TextareaHTMLAttributes } from "react";
import styles from "./index.module.css";

export type TextareaSize = "md" | "lg";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  readonly size?: TextareaSize;
  readonly invalid?: boolean;
}

const sizeClassMap: Record<TextareaSize, string | undefined> = {
  md: undefined,
  lg: styles.lg,
};

const legacySizeClassMap: Record<TextareaSize, string | undefined> = {
  md: undefined,
  lg: "textarea-lg",
};

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, size = "md", invalid, ...props },
  ref
) {
  const ariaInvalid = invalid === undefined ? props["aria-invalid"] : invalid ? "true" : "false";

  return (
    <textarea
      {...props}
      ref={ref}
      aria-invalid={ariaInvalid}
      className={clsx(
        styles.textarea,
        sizeClassMap[size],
        "input",
        "textarea",
        legacySizeClassMap[size],
        invalid ? styles.invalid : undefined,
        className
      )}
    />
  );
});
