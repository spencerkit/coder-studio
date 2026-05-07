import clsx from "clsx";
import {
  forwardRef,
  useEffect,
  useRef,
  type Ref,
  type TextareaHTMLAttributes,
} from "react";
import styles from "./index.module.css";

export type TextareaSize = "md" | "lg";

export interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "size"> {
  readonly size?: TextareaSize;
  readonly invalid?: boolean;
  readonly autoResize?: boolean;
}

const sizeClassMap: Record<TextareaSize, string | undefined> = {
  md: undefined,
  lg: styles.lg,
};

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") {
    ref(value);
    return;
  }

  if (ref) {
    ref.current = value;
  }
}

function resizeTextarea(element: HTMLTextAreaElement | null) {
  if (!element) {
    return;
  }

  element.style.height = "auto";
  element.style.height = `${element.scrollHeight}px`;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    autoResize = false,
    className,
    invalid = false,
    onChange,
    size = "md",
    "aria-invalid": ariaInvalid,
    ...props
  },
  ref
) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!autoResize || !innerRef.current) {
      return;
    }

    resizeTextarea(innerRef.current);
  }, [autoResize, props.defaultValue, props.value]);

  return (
    <textarea
      {...props}
      aria-invalid={invalid ? "true" : ariaInvalid}
      className={clsx(
        styles.input,
        styles.textarea,
        sizeClassMap[size],
        invalid ? styles.invalid : undefined,
        "input",
        "textarea",
        className
      )}
      onChange={(event) => {
        if (autoResize) {
          resizeTextarea(event.currentTarget);
        }

        onChange?.(event);
      }}
      ref={(node) => {
        innerRef.current = node;
        assignRef(ref, node);
      }}
    />
  );
});
