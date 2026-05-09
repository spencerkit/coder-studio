import clsx from "clsx";
import { ChevronDown } from "lucide-react";
import {
  type ButtonHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type SelectHTMLAttributes,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { MobileSelectSheet } from "../../../features/mobile-select";
import { useViewport } from "../_internal/use-viewport";
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
  readonly desktopMode?: "native";
  readonly mobileSheetTitle?: never;
  readonly mobileSheetPresentation?: never;
  readonly value?: T;
  readonly defaultValue?: T;
  readonly htmlSize?: SelectHTMLAttributes<HTMLSelectElement>["size"];
  readonly onChange?: SelectHTMLAttributes<HTMLSelectElement>["onChange"];
  readonly onValueChange?: (value: T) => void;
}

interface ListboxSelectProps<T extends string = string>
  extends SelectBaseProps<T>,
    Omit<
      ButtonHTMLAttributes<HTMLButtonElement>,
      "children" | "defaultValue" | "onChange" | "type" | "value"
    > {
  readonly mobile?: false;
  readonly desktopMode: "listbox";
  readonly value: T;
  readonly onValueChange?: (value: T) => void;
  readonly mobileSheetTitle: string;
  readonly mobileSheetPresentation?: "sheet" | "inline";
}

interface MobileSelectTriggerProps<T extends string = string>
  extends SelectBaseProps<T>,
    Omit<
      ButtonHTMLAttributes<HTMLButtonElement>,
      "children" | "defaultValue" | "onChange" | "type" | "value"
    > {
  readonly mobile: true;
  readonly desktopMode?: never;
  readonly mobileSheetTitle?: never;
  readonly mobileSheetPresentation?: never;
  readonly value: T;
  readonly onOpen: () => void;
  readonly valueLabel?: string;
  readonly includeValueInAriaLabel?: boolean;
}

export type SelectProps<T extends string = string> =
  | NativeSelectProps<T>
  | ListboxSelectProps<T>
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

function getSelectedLabel<T extends string>(
  options: ReadonlyArray<SelectOption<T>>,
  value: T | undefined,
  valueLabel?: string
) {
  if (valueLabel) {
    return valueLabel;
  }

  if (value === undefined) {
    return "";
  }

  return options.find((option) => option.value === value)?.label ?? value;
}

function getTriggerClasses({
  className,
  invalid,
  size,
}: {
  className?: string;
  invalid?: boolean;
  size: SelectSize;
}) {
  return clsx(
    inputStyles.input,
    sizeClassMap[size],
    "input",
    legacySizeClassMap[size],
    "mobile-select-trigger",
    styles.mobileTrigger,
    invalid ? inputStyles.invalid : undefined,
    className
  );
}

function getTriggerAccessibility({
  ariaLabel,
  ariaLabelledBy,
  includeValueInAriaLabel,
  selectedLabel,
  valueId,
}: {
  ariaLabel?: string;
  ariaLabelledBy?: string;
  includeValueInAriaLabel: boolean;
  selectedLabel: string;
  valueId: string;
}) {
  const resolvedAriaLabelledBy = ariaLabelledBy ? `${ariaLabelledBy} ${valueId}` : undefined;
  const resolvedAriaLabel =
    !ariaLabelledBy && ariaLabel
      ? includeValueInAriaLabel
        ? `${ariaLabel} ${selectedLabel}`
        : ariaLabel
      : ariaLabel;

  return {
    resolvedAriaLabel,
    resolvedAriaLabelledBy,
  };
}

export function Select<T extends string = string>(props: SelectProps<T>) {
  const viewport = useViewport();
  const generatedId = useId();
  const [interactiveOpen, setInteractiveOpen] = useState(false);
  const interactiveRootRef = useRef<HTMLDivElement | null>(null);
  const interactiveTriggerRef = useRef<HTMLButtonElement | null>(null);
  const interactiveListboxRef = useRef<HTMLDivElement | null>(null);
  const interactiveFocusStrategyRef = useRef<"selected" | "first" | "last">("selected");
  const size = props.size ?? "md";
  const ariaInvalid =
    props.invalid === undefined ? props["aria-invalid"] : props.invalid ? "true" : "false";
  const isInteractiveSelect = props.mobile !== true && props.desktopMode === "listbox";
  const resolvedInteractiveMode = isInteractiveSelect ? viewport : "desktop";
  const isDesktopListbox = isInteractiveSelect && resolvedInteractiveMode === "desktop";

  useEffect(() => {
    if (!interactiveOpen || !isDesktopListbox) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) {
        return;
      }

      if (!interactiveRootRef.current?.contains(event.target)) {
        setInteractiveOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [interactiveOpen, isDesktopListbox]);

  useEffect(() => {
    if (!interactiveOpen || !isDesktopListbox) {
      return;
    }

    const enabledOptions = Array.from(
      interactiveListboxRef.current?.querySelectorAll<HTMLElement>(
        '[role="option"]:not([aria-disabled="true"])'
      ) ?? []
    );

    if (enabledOptions.length === 0) {
      return;
    }

    const selectedOption =
      interactiveFocusStrategyRef.current === "last"
        ? enabledOptions.at(-1)
        : (interactiveListboxRef.current?.querySelector<HTMLElement>(
            '[role="option"][aria-selected="true"]:not([aria-disabled="true"])'
          ) ?? enabledOptions[0]);

    selectedOption?.focus();
  }, [interactiveOpen, isDesktopListbox, props.options, props.value]);

  useEffect(() => {
    setInteractiveOpen(false);
  }, [isInteractiveSelect, resolvedInteractiveMode]);

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
      includeValueInAriaLabel = true,
      ...buttonProps
    } = props;
    const selectedLabel = getSelectedLabel(options, value, valueLabel);
    const valueId = `${id ?? generatedId}-value`;
    const { resolvedAriaLabel, resolvedAriaLabelledBy } = getTriggerAccessibility({
      ariaLabel,
      ariaLabelledBy,
      includeValueInAriaLabel,
      selectedLabel,
      valueId,
    });

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
        className={getTriggerClasses({ className, invalid, size })}
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

  if (props.desktopMode === "listbox") {
    const {
      "aria-label": ariaLabel,
      "aria-labelledby": ariaLabelledBy,
      className,
      desktopMode: _desktopMode,
      disabled,
      id,
      invalid,
      mobileSheetPresentation = "sheet",
      mobileSheetTitle,
      onClick,
      onKeyDown,
      onValueChange,
      options,
      size: _size,
      value,
      ...buttonProps
    } = props;
    const selectedLabel = getSelectedLabel(options, value);
    const listboxId = `${id ?? generatedId}-listbox`;
    const valueId = `${id ?? generatedId}-value`;
    const { resolvedAriaLabel, resolvedAriaLabelledBy } = getTriggerAccessibility({
      ariaLabel,
      ariaLabelledBy,
      includeValueInAriaLabel: true,
      selectedLabel,
      valueId,
    });

    const closeInteractiveSelect = (focusTrigger = false) => {
      setInteractiveOpen(false);
      if (focusTrigger) {
        interactiveTriggerRef.current?.focus();
      }
    };

    const handleValueChange = (nextValue: T) => {
      onValueChange?.(nextValue);
      closeInteractiveSelect(true);
    };

    const getEnabledDesktopOptions = () =>
      Array.from(
        interactiveListboxRef.current?.querySelectorAll<HTMLElement>(
          '[role="option"]:not([aria-disabled="true"])'
        ) ?? []
      );

    const handleDesktopListboxKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Tab") {
        closeInteractiveSelect(false);
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        closeInteractiveSelect(true);
        return;
      }

      const optionElements = getEnabledDesktopOptions();
      if (optionElements.length === 0) {
        return;
      }

      const currentIndex = optionElements.findIndex(
        (element) => element === document.activeElement
      );

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const fallbackIndex = event.key === "ArrowUp" ? optionElements.length - 1 : 0;
        const nextIndex =
          currentIndex === -1
            ? fallbackIndex
            : (currentIndex + (event.key === "ArrowDown" ? 1 : -1) + optionElements.length) %
              optionElements.length;
        optionElements[nextIndex]?.focus();
        return;
      }

      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        optionElements[event.key === "Home" ? 0 : optionElements.length - 1]?.focus();
        return;
      }

      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      const activeOption =
        event.target instanceof HTMLElement
          ? event.target.closest<HTMLElement>('[role="option"][data-option-value]')
          : null;
      const nextValue = activeOption?.dataset.optionValue as T | undefined;

      if (!nextValue || activeOption?.getAttribute("aria-disabled") === "true") {
        return;
      }

      event.preventDefault();
      handleValueChange(nextValue);
    };

    const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      onKeyDown?.(event);
      if (event.defaultPrevented || disabled || event.currentTarget.disabled) {
        return;
      }

      if (event.key === "Escape") {
        closeInteractiveSelect(true);
        return;
      }

      if (resolvedInteractiveMode !== "desktop") {
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        interactiveFocusStrategyRef.current = event.key === "ArrowUp" ? "last" : "selected";
        setInteractiveOpen(true);
      }
    };

    const resolvedMobileSheetOnBack =
      mobileSheetPresentation === "inline" ? () => setInteractiveOpen(false) : undefined;

    return (
      <div ref={interactiveRootRef} className={styles.root}>
        <button
          {...buttonProps}
          ref={interactiveTriggerRef}
          id={id}
          type="button"
          disabled={disabled}
          aria-controls={isDesktopListbox && interactiveOpen ? listboxId : undefined}
          aria-expanded={interactiveOpen}
          aria-invalid={ariaInvalid}
          aria-label={resolvedAriaLabel}
          aria-haspopup={resolvedInteractiveMode === "mobile" ? "dialog" : "listbox"}
          aria-labelledby={resolvedAriaLabelledBy || undefined}
          className={getTriggerClasses({ className, invalid, size })}
          onClick={(event) => {
            onClick?.(event);
            if (!event.defaultPrevented && !disabled && !event.currentTarget.disabled) {
              if (!interactiveOpen) {
                interactiveFocusStrategyRef.current = "selected";
              }
              setInteractiveOpen((open) => !open);
            }
          }}
          onKeyDown={handleTriggerKeyDown}
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

        {isDesktopListbox && interactiveOpen ? (
          <div
            id={listboxId}
            ref={interactiveListboxRef}
            role="listbox"
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            className={styles.listbox}
            onKeyDown={handleDesktopListboxKeyDown}
          >
            {options.map((option) => {
              const isSelected = option.value === value;

              return (
                <div
                  key={option.value}
                  role="option"
                  id={`${listboxId}-${option.value}`}
                  aria-disabled={option.disabled ? "true" : undefined}
                  aria-selected={isSelected}
                  className={clsx(
                    styles.option,
                    isSelected ? styles.optionSelected : undefined,
                    option.disabled ? styles.optionDisabled : undefined
                  )}
                  data-option-value={option.value}
                  tabIndex={-1}
                  onClick={() => {
                    if (!option.disabled) {
                      handleValueChange(option.value);
                    }
                  }}
                >
                  {option.label}
                </div>
              );
            })}
          </div>
        ) : null}

        {resolvedInteractiveMode === "mobile" && interactiveOpen ? (
          <MobileSelectSheet
            title={mobileSheetTitle}
            presentation={mobileSheetPresentation}
            sections={[
              {
                kind: "options",
                id: `${id ?? generatedId}-options`,
                items: options.map((option) => ({
                  id: option.value,
                  label: option.label,
                  disabled: option.disabled,
                })),
              },
            ]}
            selectedId={value}
            onBack={resolvedMobileSheetOnBack}
            onClose={() => setInteractiveOpen(false)}
            onSelect={(nextValue) => {
              onValueChange?.(nextValue as T);
            }}
          />
        ) : null}
      </div>
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
