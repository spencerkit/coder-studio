import { useId } from "react";
import { useTranslation } from "../../../lib/i18n";
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
  const t = useTranslation();
  const hourId = useId();
  const minuteId = useId();
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
        <label htmlFor={hourId} className={styles.timeLabel}>
          {t("datetime.hour")}
        </label>
        <Input
          id={hourId}
          type="number"
          min={0}
          max={23}
          aria-label={t("datetime.hour")}
          size="sm"
          value={hourStr}
          onChange={(e) => handleHourChange(e.target.value)}
          disabled={disabled}
          className={styles.timeInput}
        />
      </div>
      <span className={styles.timeSeparator}>:</span>
      <div className={styles.timeField}>
        <label htmlFor={minuteId} className={styles.timeLabel}>
          {t("datetime.minute")}
        </label>
        <Input
          id={minuteId}
          type="number"
          min={0}
          max={59}
          aria-label={t("datetime.minute")}
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
