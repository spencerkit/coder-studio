import clsx from "clsx";
import { Calendar } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useId, useState } from "react";
import { formatDate, useTranslation } from "../../../lib/i18n";
import { useViewport } from "../_internal/use-viewport";
import { Popover } from "../popover";
import { Sheet } from "../sheet";
import styles from "./index.module.css";

export type DateTimePickerSize = "sm" | "md" | "lg";

export interface DateTimePickerProps {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly label: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly clearable?: boolean;
  readonly minDate?: Date;
  readonly maxDate?: Date;
  readonly className?: string;
  readonly size?: DateTimePickerSize;
  readonly invalid?: boolean;
  readonly "aria-describedby"?: string;
}

function parseLocalDateTime(value: string): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  return new Date(year, month - 1, day, hour, minute);
}

function formatLocalDateTime(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

const sizeClassMap: Record<DateTimePickerSize, string | undefined> = {
  sm: "input-sm",
  md: undefined,
  lg: "input-lg",
};

export function DateTimePicker({
  value,
  onValueChange,
  label,
  placeholder,
  disabled = false,
  clearable = false,
  minDate,
  maxDate,
  className,
  size = "md",
  invalid = false,
  "aria-describedby": ariaDescribedBy,
}: DateTimePickerProps) {
  const t = useTranslation();
  const viewport = useViewport();
  const triggerId = useId();
  const contentId = useId();
  const [open, setOpen] = useState(false);
  const [draftDate, setDraftDate] = useState<Date | null>(() => parseLocalDateTime(value));

  useEffect(() => {
    setDraftDate(parseLocalDateTime(value));
  }, [value]);

  const handleConfirm = useCallback(() => {
    if (draftDate) {
      onValueChange(formatLocalDateTime(draftDate));
    } else {
      onValueChange("");
    }
    setOpen(false);
  }, [draftDate, onValueChange]);

  const handleClear = useCallback(() => {
    setDraftDate(null);
    onValueChange("");
    setOpen(false);
  }, [onValueChange]);

  const displayValue = value
    ? formatDate(parseLocalDateTime(value)?.getTime() ?? Date.now(), "en")
    : (placeholder ?? t("datetime.select_date"));

  const isMobile = viewport === "mobile";

  const triggerClasses = clsx(
    "input",
    sizeClassMap[size],
    styles.trigger,
    invalid ? "input-invalid" : undefined,
    className
  );

  const trigger = (
    <button
      id={triggerId}
      type="button"
      disabled={disabled}
      aria-haspopup={isMobile ? "dialog" : "menu"}
      aria-expanded={open}
      aria-controls={open ? contentId : undefined}
      aria-label={label}
      aria-describedby={ariaDescribedBy}
      className={triggerClasses}
      onClick={() => setOpen(true)}
    >
      <span className={styles.value}>{displayValue}</span>
      <Calendar size={16} className={styles.icon} aria-hidden="true" />
    </button>
  );

  const content: ReactNode = (
    <div className={styles.content}>
      <div className={styles.header}>
        <span className={styles.title}>{label}</span>
      </div>
      <div className={styles.body}>
        {/* Calendar grid placeholder */}
        <div className={styles.calendar}>
          <span>Calendar Grid</span>
        </div>
        {/* Time selector placeholder */}
        <div className={styles.time}>
          <span>Time Selector</span>
        </div>
      </div>
      <div className={styles.actions}>
        {clearable ? (
          <button type="button" className={styles.action} onClick={handleClear}>
            {t("datetime.clear")}
          </button>
        ) : null}
        <button type="button" className={styles.action} onClick={handleConfirm}>
          {t("datetime.confirm")}
        </button>
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <>
        {trigger}
        {open ? (
          <Sheet
            title={label}
            body={content}
            bodyClassName={styles.sheetBody}
            onClose={() => setOpen(false)}
            fullscreen
          />
        ) : null}
      </>
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      title={label}
      content={content}
      contentClassName={styles.popoverContent}
      sheetBodyClassName={styles.sheetBody}
    >
      {trigger}
    </Popover>
  );
}
