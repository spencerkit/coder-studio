import type { ReactNode } from 'react';

interface MobileSheetProps {
  title: string;
  body: ReactNode;
  onClose: () => void;
}

export function MobileSheet({ title, body, onClose }: MobileSheetProps) {
  return (
    <div className="mobile-sheet-layer">
      <button
        type="button"
        className="mobile-sheet-layer__backdrop"
        aria-label="Dismiss current sheet"
        onClick={onClose}
      />
      <section className="mobile-sheet" aria-label={`${title} sheet`}>
        <div className="mobile-sheet__handle" aria-hidden="true" />
        <div className="mobile-sheet__header">
          <div>
            <div className="mobile-sheet__kicker">Phase 1</div>
            <h2 className="mobile-sheet__title">{title}</h2>
          </div>
          <button
            type="button"
            className="mobile-sheet__close"
            onClick={onClose}
            aria-label="Close current sheet"
          >
            关闭
          </button>
        </div>
        <div className="mobile-sheet__body">{body}</div>
      </section>
    </div>
  );
}
