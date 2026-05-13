import clsx from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "../../../lib/i18n";
import styles from "./index.module.css";

interface CalendarGridProps {
  readonly year: number;
  readonly month: number;
  readonly selectedDate: Date | null;
  readonly minDate?: Date;
  readonly maxDate?: Date;
  readonly onDateSelect: (date: Date) => void;
  readonly onMonthChange: (year: number, month: number) => void;
}

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}

function isDateDisabled(date: Date, minDate?: Date, maxDate?: Date): boolean {
  if (minDate && date < minDate) return true;
  if (maxDate && date > maxDate) return true;
  return false;
}

export function CalendarGrid({
  year,
  month,
  selectedDate,
  minDate,
  maxDate,
  onDateSelect,
  onMonthChange,
}: CalendarGridProps) {
  const t = useTranslation();

  const daysInMonth = getDaysInMonth(year, month);
  const firstDayOfMonth = getFirstDayOfMonth(year, month);

  const handlePrevMonth = () => {
    if (month === 0) {
      onMonthChange(year - 1, 11);
    } else {
      onMonthChange(year, month - 1);
    }
  };

  const handleNextMonth = () => {
    if (month === 11) {
      onMonthChange(year + 1, 0);
    } else {
      onMonthChange(year, month + 1);
    }
  };

  const handleDateClick = (day: number) => {
    const date = new Date(year, month, day);
    if (!isDateDisabled(date, minDate, maxDate)) {
      onDateSelect(date);
    }
  };

  const days: ReactNode[] = [];

  // Empty cells for days before the first day of month
  for (let i = 0; i < firstDayOfMonth; i++) {
    days.push(<div key={`empty-${i}`} className={styles.calendarDayEmpty} />);
  }

  // Days of the month
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const isSelected = selectedDate && isSameDay(date, selectedDate);
    const isDisabled = isDateDisabled(date, minDate, maxDate);
    const isToday = isSameDay(date, new Date());

    days.push(
      <button
        key={day}
        type="button"
        disabled={isDisabled}
        className={clsx(
          styles.calendarDay,
          isSelected && styles.calendarDaySelected,
          isToday && !isSelected && styles.calendarDayToday,
          isDisabled && styles.calendarDayDisabled
        )}
        onClick={() => handleDateClick(day)}
      >
        {day}
      </button>
    );
  }

  return (
    <div className={styles.calendarGrid}>
      <div className={styles.calendarHeader}>
        <button
          type="button"
          className={styles.calendarNav}
          onClick={handlePrevMonth}
          aria-label={t("datetime.prev_month")}
        >
          <ChevronLeft size={16} />
        </button>
        <span className={styles.calendarTitle}>
          {t(`datetime.${MONTHS[month]}`)} {year}
        </span>
        <button
          type="button"
          className={styles.calendarNav}
          onClick={handleNextMonth}
          aria-label={t("datetime.next_month")}
        >
          <ChevronRight size={16} />
        </button>
      </div>
      <div className={styles.calendarWeekdays}>
        {WEEKDAYS.map((day) => (
          <div key={day} className={styles.calendarWeekday}>
            {t(`datetime.${day}`)}
          </div>
        ))}
      </div>
      <div className={styles.calendarDays}>{days}</div>
    </div>
  );
}
