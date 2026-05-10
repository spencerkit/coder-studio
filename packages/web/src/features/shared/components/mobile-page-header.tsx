import clsx from "clsx";
import { PageHeader, type PageHeaderProps } from "./page-header";

export interface MobilePageHeaderProps extends PageHeaderProps {
  showKicker?: boolean;
}

export function MobilePageHeader({
  className,
  kicker,
  showKicker = false,
  ...props
}: MobilePageHeaderProps) {
  return (
    <PageHeader
      {...props}
      kicker={showKicker ? kicker : undefined}
      className={clsx("mobile-page-header", className)}
    />
  );
}
