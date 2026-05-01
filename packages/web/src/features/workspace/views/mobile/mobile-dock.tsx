interface MobileDockProps {
  activeSheet: 'files' | 'terminal' | 'supervisor' | null;
  onSelectSheet: (sheet: 'files' | 'terminal') => void;
}

export function MobileDock({ activeSheet, onSelectSheet }: MobileDockProps) {
  return (
    <nav className="mobile-dock" aria-label="Mobile dock">
      <button
        type="button"
        className={`mobile-dock__item ${activeSheet === 'files' ? 'mobile-dock__item--active' : ''}`}
        onClick={() => onSelectSheet('files')}
        aria-label="Open Files sheet"
      >
        <span className="mobile-dock__icon">📂</span>
        <span className="mobile-dock__label">Files</span>
      </button>

      <button
        type="button"
        className={`mobile-dock__item ${activeSheet === 'terminal' ? 'mobile-dock__item--active' : ''}`}
        onClick={() => onSelectSheet('terminal')}
        aria-label="Open Terminal sheet"
      >
        <span className="mobile-dock__icon">💻</span>
        <span className="mobile-dock__label">Terminal</span>
      </button>
    </nav>
  );
}
