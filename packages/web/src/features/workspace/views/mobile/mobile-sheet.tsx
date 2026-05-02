import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from '../../../../lib/i18n';

interface MobileSheetProps {
  title: string;
  body: ReactNode;
  onClose: () => void;
  kicker?: string;
  onBack?: () => void;
  footer?: ReactNode;
  headerAction?: ReactNode;
  bodyClassName?: string;
  contentClassName?: string;
  fullscreen?: boolean;
  backLabel?: string;
}

export function MobileSheet({
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
}: MobileSheetProps) {
  const t = useTranslation();
  const contentClasses = ['mobile-sheet', fullscreen ? 'mobile-sheet--fullscreen' : null, contentClassName]
    .filter(Boolean)
    .join(' ');
  const bodyClasses = ['mobile-sheet__body', bodyClassName].filter(Boolean).join(' ');
  const handleBack = onBack ?? onClose;
  const resolvedBackLabel = backLabel ?? t('action.back');
  const backAriaLabel = onBack ? resolvedBackLabel : t('action.back');

  return (
    <div className="mobile-sheet-layer">
      <button
        type="button"
        className="mobile-sheet-layer__backdrop"
        aria-label={t('mobile.sheet.dismiss')}
        onClick={onClose}
      />
      <section
        className={contentClasses}
        aria-label={t('mobile.sheet.region', { title })}
        role="region"
      >
        {fullscreen ? null : <div className="mobile-sheet__handle" aria-hidden="true" />}
        <div className="mobile-sheet__header">
          {fullscreen ? (
            <>
              <button
                type="button"
                className="mobile-sheet__back"
                onClick={handleBack}
                aria-label={backAriaLabel}
              >
                <ArrowLeft size={16} />
                <span>{t('action.back')}</span>
              </button>
              <div className="mobile-sheet__header-main">
                {kicker ? <div className="mobile-sheet__kicker">{kicker}</div> : null}
                <h2 className="mobile-sheet__title">{title}</h2>
              </div>
              {headerAction ? (
                headerAction
              ) : (
                <div className="mobile-sheet__header-spacer" aria-hidden="true" />
              )}
            </>
          ) : (
            <>
              <div className="mobile-sheet__header-main">
                <div className="mobile-sheet__header-row">
                  <button
                    type="button"
                    className="mobile-sheet__back"
                    onClick={handleBack}
                    aria-label={backAriaLabel}
                  >
                    <ArrowLeft size={16} />
                    <span>{t('action.back')}</span>
                  </button>
                  {kicker ? <div className="mobile-sheet__kicker">{kicker}</div> : null}
                </div>
                <h2 className="mobile-sheet__title">{title}</h2>
              </div>
              {headerAction}
            </>
          )}
        </div>
        <div className={bodyClasses}>{body}</div>
        {footer ? <div className="mobile-sheet__footer">{footer}</div> : null}
      </section>
    </div>
  );
}
