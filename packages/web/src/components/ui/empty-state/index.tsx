import clsx from "clsx";
import {
  type ComponentPropsWithoutRef,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import styles from "./index.module.css";

export interface EmptyStateProps
  extends Omit<ComponentPropsWithoutRef<"div">, "children" | "title"> {
  readonly action?: ReactNode;
  readonly description?: ReactNode;
  readonly icon?: ReactNode;
  readonly title: ReactNode;
}

function renderStyledSlot(node: ReactNode, className: string) {
  if (node === null || node === undefined || typeof node === "boolean") {
    return null;
  }

  if (isValidElement(node)) {
    const element = node as ReactElement<{ className?: string }>;

    return cloneElement(element, {
      className: clsx(element.props.className, className),
    });
  }

  return <div className={className}>{node}</div>;
}

export function EmptyState({
  action,
  className,
  description,
  icon,
  title,
  ...props
}: EmptyStateProps) {
  return (
    <div {...props} className={clsx(styles.root, className)}>
      {renderStyledSlot(icon, styles.icon)}
      {renderStyledSlot(title, styles.title)}
      {renderStyledSlot(description, styles.description)}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}
