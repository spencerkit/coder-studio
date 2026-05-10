import clsx from "clsx";
import type { ReactNode } from "react";
import { MobilePageHeader } from "../../../features/shared/components/mobile-page-header";
import { useTranslation } from "../../../lib/i18n";

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
          <MobilePageHeader
            title={title}
            kicker={kicker}
            onBack={handleBack}
            backLabel={resolvedBackLabel}
            rightSlot={headerAction}
            titleAs="h2"
          />
        </div>
        <div className={clsx("mobile-sheet__body", bodyClassName)}>{body}</div>
        {footer ? <div className="mobile-sheet__footer">{footer}</div> : null}
      </section>
    </div>
  );
}
