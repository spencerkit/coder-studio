import clsx from "clsx";
import { ChevronDown } from "lucide-react";
import {
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { MobileSelectSheet } from "../../../features/mobile-select";
import { isEscapeKey } from "../_internal/dismiss";
import { useViewport } from "../_internal/use-viewport";
import styles from "./index.module.css";

export type SelectForceMode = "auto" | "desktop" | "mobile" | "dropdown" | "sheet";

export interface SelectOption {
  readonly label: string;
  readonly value: string;
  readonly disabled?: boolean;
}

export interface SelectProps
  extends Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    "children" | "onChange" | "type" | "value"
  > {
  readonly options: readonly SelectOption[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly forceMode?: SelectForceMode;
  readonly valueClassName?: string;
  readonly iconClassName?: string;
}

function findFirstEnabledIndex(options: readonly SelectOption[]) {
  return options.findIndex((option) => !option.disabled);
}

function resolveSelectedIndex(options: readonly SelectOption[], value: string) {
  const selectedIndex = options.findIndex((option) => option.value === value);
  if (selectedIndex >= 0) {
    return selectedIndex;
  }

  return findFirstEnabledIndex(options);
}

function findNextEnabledIndex(
  options: readonly SelectOption[],
  currentIndex: number,
  step: 1 | -1
) {
  if (options.length === 0) {
    return -1;
  }

  let attempts = 0;
  let index = currentIndex;

  while (attempts < options.length) {
    index = (index + step + options.length) % options.length;
    if (!options[index]?.disabled) {
      return index;
    }
    attempts += 1;
  }

  return currentIndex;
}

function getTriggerAccessibleNameIds({
  ariaLabel,
  ariaLabelledBy,
  fallbackLabelId,
  valueId,
}: {
  ariaLabel?: string;
  ariaLabelledBy?: string;
  fallbackLabelId: string;
  valueId: string;
}) {
  if (ariaLabelledBy) {
    return `${ariaLabelledBy} ${valueId}`;
  }

  return `${fallbackLabelId} ${valueId}`;
}

function resolveMode(
  forceMode: SelectForceMode,
  viewport: ReturnType<typeof useViewport>
): "dropdown" | "sheet" {
  if (forceMode === "auto") {
    return viewport === "mobile" ? "sheet" : "dropdown";
  }

  if (forceMode === "desktop") {
    return "dropdown";
  }

  if (forceMode === "mobile") {
    return "sheet";
  }

  return forceMode;
}

export function Select({
  options,
  value,
  onChange,
  placeholder,
  forceMode = "auto",
  className,
  valueClassName,
  iconClassName,
  disabled = false,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  id,
  onKeyDown,
  onClick,
  ...buttonProps
}: SelectProps) {
  const viewport = useViewport();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [mobilePresentation, setMobilePresentation] = useState<"sheet" | "inline">("sheet");
  const fallbackLabelId = useId();
  const valueId = useId();
  const listboxId = useId();
  const selectedIndex = resolveSelectedIndex(options, value);
  const resolvedOption = selectedIndex >= 0 ? options[selectedIndex] : null;
  const resolvedLabel = resolvedOption?.label ?? placeholder ?? "";
  const mode = resolveMode(forceMode, viewport);
  const [highlightedIndex, setHighlightedIndex] = useState(
    selectedIndex >= 0 ? selectedIndex : findFirstEnabledIndex(options)
  );

  useEffect(() => {
    setHighlightedIndex(selectedIndex >= 0 ? selectedIndex : findFirstEnabledIndex(options));
  }, [options, selectedIndex]);

  useEffect(() => {
    if (!open || mode !== "dropdown") {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [mode, open]);

  const openSelect = () => {
    if (disabled || options.length === 0) {
      return;
    }

    setHighlightedIndex(selectedIndex >= 0 ? selectedIndex : findFirstEnabledIndex(options));
    if (mode === "sheet") {
      setMobilePresentation(triggerRef.current?.closest(".mobile-sheet") ? "inline" : "sheet");
    }
    setOpen(true);
  };

  const closeSelect = () => {
    setOpen(false);
  };

  const commitSelection = (nextIndex: number) => {
    const nextOption = options[nextIndex];
    if (!nextOption || nextOption.disabled) {
      return;
    }

    onChange(nextOption.value);
    closeSelect();
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || disabled) {
      return;
    }

    if (mode === "sheet") {
      if (
        event.key === "ArrowDown" ||
        event.key === "ArrowUp" ||
        event.key === "Enter" ||
        event.key === " "
      ) {
        event.preventDefault();
        openSelect();
      } else if (isEscapeKey(event)) {
        closeSelect();
      }
      return;
    }

    if (!open) {
      if (
        event.key === "ArrowDown" ||
        event.key === "ArrowUp" ||
        event.key === "Enter" ||
        event.key === " "
      ) {
        event.preventDefault();
        openSelect();
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((current) =>
        findNextEnabledIndex(options, current >= 0 ? current : -1, 1)
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((current) =>
        findNextEnabledIndex(options, current >= 0 ? current : options.length === 0 ? -1 : 0, -1)
      );
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (highlightedIndex >= 0) {
        commitSelection(highlightedIndex);
      }
      return;
    }

    if (isEscapeKey(event)) {
      event.preventDefault();
      closeSelect();
    }
  };

  return (
    <div className={styles.root} ref={rootRef}>
      {ariaLabel ? (
        <span className={styles.srOnly} id={fallbackLabelId}>
          {ariaLabel}
        </span>
      ) : null}
      <button
        {...buttonProps}
        aria-controls={mode === "dropdown" && open ? listboxId : undefined}
        aria-describedby={ariaDescribedBy}
        aria-expanded={open}
        aria-haspopup={mode === "dropdown" ? "listbox" : "dialog"}
        aria-labelledby={getTriggerAccessibleNameIds({
          ariaLabel,
          ariaLabelledBy,
          fallbackLabelId,
          valueId,
        })}
        className={clsx(styles.trigger, "input", className)}
        disabled={disabled}
        id={id}
        onClick={(event) => {
          onClick?.(event);
          if (event.defaultPrevented || disabled) {
            return;
          }

          if (open) {
            closeSelect();
            return;
          }

          openSelect();
        }}
        onKeyDown={handleTriggerKeyDown}
        ref={triggerRef}
        type="button"
      >
        <span className={clsx(styles.value, valueClassName)} id={valueId}>
          {resolvedLabel}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={clsx(styles.icon, iconClassName, open ? styles.iconOpen : undefined)}
          size={16}
        />
      </button>

      {mode === "dropdown" && open ? (
        <div
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          className={styles.listbox}
          id={listboxId}
          role="listbox"
        >
          {options.map((option, index) => {
            const isSelected = resolvedOption?.value === option.value;
            const isHighlighted = index === highlightedIndex;

            return (
              <button
                aria-selected={isSelected}
                className={clsx(
                  styles.option,
                  isSelected ? styles.optionSelected : undefined,
                  isHighlighted ? styles.optionHighlighted : undefined
                )}
                data-highlighted={isHighlighted ? "true" : undefined}
                disabled={option.disabled}
                key={option.value}
                onClick={() => {
                  if (!option.disabled) {
                    commitSelection(index);
                  }
                }}
                onMouseEnter={() => {
                  if (!option.disabled) {
                    setHighlightedIndex(index);
                  }
                }}
                role="option"
                tabIndex={-1}
                type="button"
              >
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {mode === "sheet" && open ? (
        <div className={mobilePresentation === "inline" ? styles.inlineSheet : undefined}>
          <MobileSelectSheet
            onClose={closeSelect}
            onSelect={(nextValue) => {
              const nextIndex = options.findIndex((option) => option.value === nextValue);
              if (nextIndex >= 0) {
                commitSelection(nextIndex);
              }
            }}
            presentation={mobilePresentation}
            sections={[
              {
                kind: "options",
                id: id ?? "select-options",
                items: options.map((option) => ({
                  id: option.value,
                  label: option.label,
                  disabled: option.disabled,
                })),
              },
            ]}
            selectedId={resolvedOption?.value ?? null}
            title={ariaLabel ?? "Select"}
          />
        </div>
      ) : null}
    </div>
  );
}
