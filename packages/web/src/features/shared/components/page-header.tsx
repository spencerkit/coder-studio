import clsx from "clsx";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

type PageHeaderTitleElement = "div" | "h1" | "h2" | "h3" | "span";
type PageHeaderLevel = "primary" | "secondary";

export interface PageHeaderProps {
  title: string;
  onBack?: () => void;
  backLabel?: string;
  backAriaLabel?: string;
  kicker?: ReactNode;
  rightSlot?: ReactNode;
  titleAs?: PageHeaderTitleElement;
  level?: PageHeaderLevel;
  className?: string;
}

export function PageHeader({
  title,
  onBack,
  backLabel = "Back",
  backAriaLabel,
  kicker,
  rightSlot,
  titleAs = "h2",
  level = "secondary",
  className,
}: PageHeaderProps) {
  const TitleTag = titleAs;

  return (
    <div className={clsx("page-header", `page-header--${level}`, className)} data-level={level}>
      <div className="page-header__leading">
        {onBack ? (
          <button
            type="button"
            className="page-header__back"
            onClick={onBack}
            aria-label={backAriaLabel ?? backLabel}
          >
            <ArrowLeft size={16} />
            <span>{backLabel}</span>
          </button>
        ) : null}
        <div className="page-header__copy">
          {kicker ? <div className="page-header__kicker">{kicker}</div> : null}
          <TitleTag className="page-header__title">{title}</TitleTag>
        </div>
      </div>
      {rightSlot ? <div className="page-header__actions">{rightSlot}</div> : null}
    </div>
  );
}
