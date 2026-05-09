import clsx from "clsx";
import { ChevronDown } from "lucide-react";
import { type ButtonHTMLAttributes, type SelectHTMLAttributes, useId } from "react";
import inputStyles from "../input/index.module.css";
import styles from "./index.module.css";

export type SelectSize = "sm" | "md" | "lg";

export interface SelectOption<T extends string = string> {
  readonly value: T;
  readonly label: string;
  readonly disabled?: boolean;
}

interface SelectBaseProps<T extends string = string> {
  readonly size?: SelectSize;
  readonly invalid?: boolean;
  readonly className?: string;
  readonly options: ReadonlyArray<SelectOption<T>>;
}

interface NativeSelectProps<T extends string = string>
  extends SelectBaseProps<T>,
    Omit<
      SelectHTMLAttributes<HTMLSelectElement>,
      "children" | "defaultValue" | "multiple" | "onChange" | "size" | "value"
    > {
  readonly mobile?: false;
  readonly value?: T;
  readonly defaultValue?: T;
  readonly htmlSize?: SelectHTMLAttributes<HTMLSelectElement>["size"];
  readonly onChange?: SelectHTMLAttributes<HTMLSelectElement>["onChange"];
  readonly onValueChange?: (value: T) => void;
}

interface MobileSelectTriggerProps<T extends string = string>
  extends SelectBaseProps<T>,
    Omit<
      ButtonHTMLAttributes<HTMLButtonElement>,
      "children" | "defaultValue" | "onChange" | "type" | "value"
    > {
  readonly mobile: true;
  readonly value: T;
  readonly onOpen: () => void;
  readonly valueLabel?: string;
}

export type SelectProps<T extends string = string> =
  | NativeSelectProps<T>
  | MobileSelectTriggerProps<T>;

const sizeClassMap: Record<SelectSize, string | undefined> = {
  sm: inputStyles.sm,
  md: undefined,
  lg: inputStyles.lg,
};

const legacySizeClassMap: Record<SelectSize, string | undefined> = {
  sm: "input-sm",
  md: undefined,
  lg: "input-lg",
};

export function Select<T extends string = string>(props: SelectProps<T>) {
  const generatedId = useId();
  const size = props.size ?? "md";
  const ariaInvalid =
    props.invalid === undefined ? props["aria-invalid"] : props.invalid ? "true" : "false";

  if (props.mobile) {
    const {
      "aria-label": ariaLabel,
      "aria-labelledby": ariaLabelledBy,
      className,
      disabled,
      id,
      invalid,
      onClick,
      onOpen,
      options,
      size: _size,
      value,
      valueLabel,
      ...buttonProps
    } = props;
    const selectedLabel =
      valueLabel ?? options.find((option) => option.value === value)?.label ?? value;
    const valueId = `${id ?? generatedId}-value`;
    const resolvedAriaLabelledBy = ariaLabelledBy ? `${ariaLabelledBy} ${valueId}` : undefined;
    const resolvedAriaLabel =
      !ariaLabelledBy && ariaLabel ? `${ariaLabel} ${selectedLabel}` : ariaLabel;

    return (
      <button
        {...buttonProps}
        id={id}
        type="button"
        disabled={disabled}
        aria-invalid={ariaInvalid}
        aria-label={resolvedAriaLabel}
        aria-haspopup={buttonProps["aria-haspopup"] ?? "dialog"}
        aria-labelledby={resolvedAriaLabelledBy || undefined}
        className={clsx(
          inputStyles.input,
          sizeClassMap[size],
          "input",
          legacySizeClassMap[size],
          "mobile-select-trigger",
          styles.mobileTrigger,
          invalid ? inputStyles.invalid : undefined,
          className
        )}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented && !disabled && !event.currentTarget.disabled) {
            onOpen();
          }
        }}
      >
        <span id={valueId} className={clsx("mobile-select-trigger__value", styles.mobileValue)}>
          {selectedLabel}
        </span>
        <ChevronDown
          size={16}
          className={clsx("mobile-select-trigger__icon", styles.mobileIcon)}
          aria-hidden="true"
        />
      </button>
    );
  }

  const {
    className,
    htmlSize,
    invalid,
    onChange,
    onValueChange,
    options,
    size: _size,
    ...selectProps
  } = props;

  return (
    <select
      {...selectProps}
      size={htmlSize}
      aria-invalid={ariaInvalid}
      className={clsx(
        inputStyles.input,
        sizeClassMap[size],
        "input",
        legacySizeClassMap[size],
        styles.native,
        invalid ? inputStyles.invalid : undefined,
        className
      )}
      onChange={(event) => {
        onChange?.(event);
        onValueChange?.(event.target.value as T);
      }}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
