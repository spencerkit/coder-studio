import clsx from "clsx";
import { Calendar } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useId, useState } from "react";
import { formatDate, useTranslation } from "../../../lib/i18n";
import { useViewport } from "../_internal/use-viewport";
import { Popover } from "../popover";
import { Sheet } from "../sheet";
import { CalendarGrid } from "./calendar-grid";
import styles from "./index.module.css";
import { TimeSelector } from "./time-selector";

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
  const [open, setOpen] = useState(false);

  // Initialize draft from value
  const getInitialDraft = useCallback(() => {
    const parsed = parseLocalDateTime(value);
    if (parsed) {
      return {
        year: parsed.getFullYear(),
        month: parsed.getMonth(),
        day: parsed.getDate(),
        hour: parsed.getHours(),
        minute: parsed.getMinutes(),
      };
    }
    const now = new Date();
    return {
      year: now.getFullYear(),
      month: now.getMonth(),
      day: now.getDate(),
      hour: now.getHours(),
      minute: 0,
    };
  }, [value]);

  const [draft, setDraft] = useState(getInitialDraft);

  // Update draft when value changes externally
  useEffect(() => {
    setDraft(getInitialDraft());
  }, [value, getInitialDraft]);

  const handleDateSelect = useCallback((date: Date) => {
    setDraft((prev) => ({
      ...prev,
      year: date.getFullYear(),
      month: date.getMonth(),
      day: date.getDate(),
    }));
  }, []);

  const handleMonthChange = useCallback((year: number, month: number) => {
    setDraft((prev) => ({ ...prev, year, month }));
  }, []);

  const handleHourChange = useCallback((hour: number) => {
    setDraft((prev) => ({ ...prev, hour }));
  }, []);

  const handleMinuteChange = useCallback((minute: number) => {
    setDraft((prev) => ({ ...prev, minute }));
  }, []);

  const handleConfirm = useCallback(() => {
    const date = new Date(draft.year, draft.month, draft.day, draft.hour, draft.minute);
    onValueChange(formatLocalDateTime(date));
    setOpen(false);
  }, [draft, onValueChange]);

  const handleClear = useCallback(() => {
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
      aria-label={label}
      aria-describedby={ariaDescribedBy}
      className={triggerClasses}
      onClick={() => setOpen(true)}
    >
      <span className={styles.value}>{displayValue}</span>
      <Calendar size={16} className={styles.icon} aria-hidden="true" />
    </button>
  );

  const selectedDate = value ? parseLocalDateTime(value) : null;
  const calendarMinDate = minDate
    ? new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate())
    : undefined;

  const content: ReactNode = (
    <div className={styles.content}>
      <div className={styles.body}>
        <CalendarGrid
          year={draft.year}
          month={draft.month}
          selectedDate={selectedDate}
          minDate={calendarMinDate}
          maxDate={maxDate}
          onDateSelect={handleDateSelect}
          onMonthChange={handleMonthChange}
        />
        <div className={styles.timeSection}>
          <span className={styles.timeLabel}>{t("datetime.select_time")}</span>
          <TimeSelector
            hour={draft.hour}
            minute={draft.minute}
            onHourChange={handleHourChange}
            onMinuteChange={handleMinuteChange}
          />
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
