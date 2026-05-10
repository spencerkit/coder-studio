import clsx from "clsx";
import type { HTMLAttributes, ReactNode } from "react";
import { Tab, TabList, Tabs } from "../tabs";
import styles from "./index.module.css";

export type SegmentedControlSize = "sm" | "md";

export interface SegmentedControlOption {
  readonly label: ReactNode;
  readonly value: string;
  readonly disabled?: boolean;
}

export interface SegmentedControlProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "onChange"> {
  readonly options: readonly SegmentedControlOption[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly size?: SegmentedControlSize;
  readonly className?: string;
  readonly optionClassName?: string;
}

export function SegmentedControl({
  options,
  value,
  onChange,
  size = "md",
  className,
  optionClassName,
  ...props
}: SegmentedControlProps) {
  const resolvedValue = options.some((option) => option.value === value)
    ? value
    : (options.find((option) => !option.disabled)?.value ?? value);

  return (
    <Tabs onValueChange={onChange} value={resolvedValue}>
      <TabList {...props} className={clsx(styles.segmentedControl, className)} data-size={size}>
        {options.map((option) => (
          <Tab
            key={option.value}
            className={clsx(styles.segmentedControlOption, optionClassName)}
            data-size={size}
            disabled={option.disabled}
            value={option.value}
          >
            {option.label}
          </Tab>
        ))}
      </TabList>
    </Tabs>
  );
}
