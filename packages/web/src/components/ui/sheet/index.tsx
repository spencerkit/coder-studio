import clsx from "clsx";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "../../../lib/i18n";

interface SheetHeaderProps {
  readonly title: string;
  readonly kicker?: string;
  readonly onBack: () => void;
  readonly backLabel: string;
  readonly headerAction?: ReactNode;
}

export interface SheetProps {
  readonly title: string;
  readonly body: ReactNode;
  readonly onClose: () => void;
  readonly kicker?: string;
  readonly onBack?: () => void;
  readonly footer?: ReactNode;
  readonly headerAction?: ReactNode;
  readonly bodyClassName?: string;
  readonly contentClassName?: string;
  readonly fullscreen?: boolean;
  readonly backLabel?: string;
}

function SheetHeader({ title, kicker, onBack, backLabel, headerAction }: SheetHeaderProps) {
  return (
    <div className="page-header">
      <div className="page-header__leading">
        <button type="button" className="page-header__back" onClick={onBack} aria-label={backLabel}>
          <ArrowLeft size={16} />
          <span>{backLabel}</span>
        </button>
        <div className="page-header__copy">
          {kicker ? <div className="page-header__kicker">{kicker}</div> : null}
          <h2 className="page-header__title">{title}</h2>
        </div>
      </div>
      {headerAction ? <div className="page-header__actions">{headerAction}</div> : null}
    </div>
  );
}

export function Sheet({
  title,
  body,
  onClose,
  kicker,
  onBack,
  footer,
  headerAction,
  bodyClassName,
  contentClassName,
  fullscreen = false,
  backLabel,
}: SheetProps) {
  const t = useTranslation();
  const handleBack = onBack ?? onClose;
  const resolvedBackLabel = backLabel ?? t("action.back");

  return (
    <div className="mobile-sheet-layer">
      <button
        type="button"
        className="mobile-sheet-layer__backdrop"
        aria-label={t("mobile.sheet.dismiss")}
        onClick={onClose}
      />
      <section
        className={clsx(
          "mobile-sheet",
          fullscreen ? "mobile-sheet--fullscreen" : null,
          contentClassName
        )}
        aria-label={t("mobile.sheet.region", { title })}
        role="region"
      >
        {fullscreen ? null : <div className="mobile-sheet__handle" aria-hidden="true" />}
        <div className="mobile-sheet__header">
          <SheetHeader
            title={title}
            kicker={kicker}
            onBack={handleBack}
            backLabel={resolvedBackLabel}
            headerAction={headerAction}
          />
        </div>
        <div className={clsx("mobile-sheet__body", bodyClassName)}>{body}</div>
        {footer ? <div className="mobile-sheet__footer">{footer}</div> : null}
      </section>
    </div>
  );
}
