import clsx from "clsx";
import { useId } from "react";
import { Select, type SelectOption } from "../select";
import styles from "./index.module.css";

interface TimeSelectorProps {
  readonly hour: number;
  readonly minute: number;
  readonly onHourChange: (hour: number) => void;
  readonly onMinuteChange: (minute: number) => void;
  readonly disabled?: boolean;
}

function generateHourOptions(): ReadonlyArray<SelectOption<string>> {
  return Array.from({ length: 24 }, (_, i) => ({
    value: String(i),
    label: String(i).padStart(2, "0"),
  }));
}

function generateMinuteOptions(): ReadonlyArray<SelectOption<string>> {
  return Array.from({ length: 60 }, (_, i) => ({
    value: String(i),
    label: String(i).padStart(2, "0"),
  }));
}

const HOUR_OPTIONS = generateHourOptions();
const MINUTE_OPTIONS = generateMinuteOptions();

export function TimeSelector({
  hour,
  minute,
  onHourChange,
  onMinuteChange,
  disabled = false,
}: TimeSelectorProps) {
  const hourId = useId();
  const minuteId = useId();

  return (
    <div className={styles.timeSelector}>
      <div className={styles.timeField}>
        <label htmlFor={hourId} className={styles.timeLabel}>
          Hour
        </label>
        <Select
          id={hourId}
          size="sm"
          options={HOUR_OPTIONS}
          value={String(hour)}
          onValueChange={(value) => onHourChange(Number(value))}
          disabled={disabled}
        />
      </div>
      <span className={styles.timeSeparator}>:</span>
      <div className={styles.timeField}>
        <label htmlFor={minuteId} className={styles.timeLabel}>
          Minute
        </label>
        <Select
          id={minuteId}
          size="sm"
          options={MINUTE_OPTIONS}
          value={String(minute)}
          onValueChange={(value) => onMinuteChange(Number(value))}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
