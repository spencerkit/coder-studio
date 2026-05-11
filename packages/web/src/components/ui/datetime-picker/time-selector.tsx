import clsx from "clsx";
import { Input } from "../input";
import styles from "./index.module.css";

interface TimeSelectorProps {
  readonly hour: number;
  readonly minute: number;
  readonly onHourChange: (hour: number) => void;
  readonly onMinuteChange: (minute: number) => void;
  readonly disabled?: boolean;
}

export function TimeSelector({
  hour,
  minute,
  onHourChange,
  onMinuteChange,
  disabled = false,
}: TimeSelectorProps) {
  const hourStr = String(hour).padStart(2, "0");
  const minuteStr = String(minute).padStart(2, "0");

  const handleHourChange = (value: string) => {
    const parsed = parseInt(value, 10);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 23) {
      onHourChange(parsed);
    }
  };

  const handleMinuteChange = (value: string) => {
    const parsed = parseInt(value, 10);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 59) {
      onMinuteChange(parsed);
    }
  };

  return (
    <div className={styles.timeSelector}>
      <div className={styles.timeField}>
        <label className={styles.timeLabel}>Hour</label>
        <Input
          type="number"
          min={0}
          max={23}
          size="sm"
          value={hourStr}
          onChange={(e) => handleHourChange(e.target.value)}
          disabled={disabled}
          className={styles.timeInput}
        />
      </div>
      <span className={styles.timeSeparator}>:</span>
      <div className={styles.timeField}>
        <label className={styles.timeLabel}>Minute</label>
        <Input
          type="number"
          min={0}
          max={59}
          size="sm"
          value={minuteStr}
          onChange={(e) => handleMinuteChange(e.target.value)}
          disabled={disabled}
          className={styles.timeInput}
        />
      </div>
    </div>
  );
}
