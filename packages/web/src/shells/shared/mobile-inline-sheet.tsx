import { useEffect, useRef, type ReactNode } from 'react';

interface MobileInlineSheetProps {
  title: string;
  children: ReactNode;
  className?: string;
  onClose: () => void;
}

export function MobileInlineSheet({
  title,
  children,
  className,
  onClose,
}: MobileInlineSheetProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={rootRef}
      className={['mobile-inline-sheet', className].filter(Boolean).join(' ')}
      role="dialog"
      aria-label={title}
    >
      <div className="mobile-inline-sheet__handle" aria-hidden="true" />
      <div className="mobile-inline-sheet__header">
        <h3 className="mobile-inline-sheet__title">{title}</h3>
      </div>
      <div className="mobile-inline-sheet__body">{children}</div>
    </div>
  );
}

export default MobileInlineSheet;
