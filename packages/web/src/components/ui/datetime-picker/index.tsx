import clsx from "clsx";
import { useAtomValue } from "jotai";
import { Calendar } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useId, useState } from "react";
import { localeAtom } from "../../../atoms/app-ui";
import { formatDate, type LocaleCode, useTranslation } from "../../../lib/i18n";
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

interface DateTimeDraft {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

function parseLocalDateTime(value: string): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);

  if ([year, month, day, hour, minute].some(Number.isNaN)) {
    return null;
  }

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

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function truncateToMinute(date: Date): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getHours(),
    date.getMinutes()
  );
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function clampDay(year: number, month: number, day: number): number {
  return Math.min(day, getDaysInMonth(year, month));
}

function createDraft(date: Date): DateTimeDraft {
  return {
    year: date.getFullYear(),
    month: date.getMonth(),
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
  };
}

function createDateFromDraft(draft: DateTimeDraft): Date {
  return new Date(draft.year, draft.month, draft.day, draft.hour, draft.minute);
}

function clampDateToBounds(date: Date, minTime?: number, maxTime?: number): Date {
  const timestamp = date.getTime();

  if (minTime !== undefined && timestamp < minTime) {
    return new Date(minTime);
  }

  if (maxTime !== undefined && timestamp > maxTime) {
    return new Date(maxTime);
  }

  return date;
}

function isDateTimeDisabled(date: Date, minTime?: number, maxTime?: number): boolean {
  const timestamp = date.getTime();

  if (minTime !== undefined && timestamp < minTime) return true;
  if (maxTime !== undefined && timestamp > maxTime) return true;
  return false;
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
  const locale = useAtomValue(localeAtom) as LocaleCode;
  const viewport = useViewport();
  const triggerId = useId();
  const [open, setOpen] = useState(false);
  const effectiveMinTime = minDate ? truncateToMinute(minDate).getTime() : undefined;
  const effectiveMaxTime = maxDate ? truncateToMinute(maxDate).getTime() : undefined;

  const createInitialDraft = (currentValue: string) => {
    const parsed = parseLocalDateTime(currentValue);
    if (parsed) {
      return createDraft(parsed);
    }

    const now = truncateToMinute(new Date());
    return createDraft(clampDateToBounds(now, effectiveMinTime, effectiveMaxTime));
  };

  const [draft, setDraft] = useState(() => createInitialDraft(value));

  useEffect(() => {
    setDraft(createInitialDraft(value));
  }, [value]);

  const handleDateSelect = useCallback((date: Date) => {
    setDraft((prev) => ({
      ...prev,
      year: date.getFullYear(),
      month: date.getMonth(),
      day: date.getDate(),
    }));
  }, []);

  const handleMonthChange = useCallback((year: number, month: number) => {
    setDraft((prev) => ({
      ...prev,
      year,
      month,
      day: clampDay(year, month, prev.day),
    }));
  }, []);

  const handleHourChange = useCallback((hour: number) => {
    setDraft((prev) => ({ ...prev, hour }));
  }, []);

  const handleMinuteChange = useCallback((minute: number) => {
    setDraft((prev) => ({ ...prev, minute }));
  }, []);

  const selectedDate = createDateFromDraft(draft);
  const isConfirmDisabled = isDateTimeDisabled(selectedDate, effectiveMinTime, effectiveMaxTime);

  const handleConfirm = useCallback(() => {
    const date = createDateFromDraft(draft);
    if (isDateTimeDisabled(date, effectiveMinTime, effectiveMaxTime)) {
      return;
    }
    onValueChange(formatLocalDateTime(date));
    setOpen(false);
  }, [draft, effectiveMaxTime, effectiveMinTime, onValueChange]);

  const handleClear = useCallback(() => {
    onValueChange("");
    setOpen(false);
  }, [onValueChange]);

  const parsedValue = parseLocalDateTime(value);
  const displayValue = parsedValue
    ? formatDate(parsedValue.getTime(), locale)
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

  const calendarSelectedDate = new Date(draft.year, draft.month, draft.day);
  const calendarMinDate = minDate ? startOfDay(minDate) : undefined;
  const calendarMaxDate = maxDate ? startOfDay(maxDate) : undefined;

  const content: ReactNode = (
    <div className={styles.content}>
      <div className={styles.body}>
        <CalendarGrid
          year={draft.year}
          month={draft.month}
          selectedDate={calendarSelectedDate}
          minDate={calendarMinDate}
          maxDate={calendarMaxDate}
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
        <button
          type="button"
          className={styles.action}
          onClick={handleConfirm}
          disabled={isConfirmDisabled}
        >
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
