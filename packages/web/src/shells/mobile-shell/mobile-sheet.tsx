import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';

interface MobileSheetProps {
  title: string;
  body: ReactNode;
  onClose: () => void;
  kicker?: string;
  onBack?: () => void;
  footer?: ReactNode;
  bodyClassName?: string;
  contentClassName?: string;
  closeLabel?: string;
}

export function MobileSheet({
  title,
  body,
  onClose,
  kicker,
  onBack,
  footer,
  bodyClassName,
  contentClassName,
  closeLabel = '关闭',
}: MobileSheetProps) {
  const contentClasses = ['mobile-sheet', contentClassName].filter(Boolean).join(' ');
  const bodyClasses = ['mobile-sheet__body', bodyClassName].filter(Boolean).join(' ');

  return (
    <div className="mobile-sheet-layer">
      <button
        type="button"
        className="mobile-sheet-layer__backdrop"
        aria-label="Dismiss current sheet"
        onClick={onClose}
      />
      <section className={contentClasses} aria-label={`${title} sheet`}>
        <div className="mobile-sheet__handle" aria-hidden="true" />
        <div className="mobile-sheet__header">
          <div className="mobile-sheet__header-main">
            <div className="mobile-sheet__header-row">
              {onBack ? (
                <button
                  type="button"
                  className="mobile-sheet__back"
                  onClick={onBack}
                  aria-label="返回上一层"
                >
                  <ArrowLeft size={16} />
                  <span>返回</span>
                </button>
              ) : null}
              {kicker ? <div className="mobile-sheet__kicker">{kicker}</div> : null}
            </div>
            <h2 className="mobile-sheet__title">{title}</h2>
          </div>
          <button
            type="button"
            className="mobile-sheet__close"
            onClick={onClose}
            aria-label="Close current sheet"
          >
            {closeLabel}
          </button>
        </div>
        <div className={bodyClasses}>{body}</div>
        {footer ? <div className="mobile-sheet__footer">{footer}</div> : null}
      </section>
    </div>
  );
}
