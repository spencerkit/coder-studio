import { useId, useMemo, useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { MobileSheet } from '../../workspace/views/mobile/mobile-sheet';

export interface MobileSelectItem {
  id: string;
  label: string;
  meta?: string;
}

export interface MobileSelectActionItem {
  id: string;
  label: string;
  meta?: string;
  onAction: () => void;
}

interface MobileSelectOptionSection {
  kind: 'options';
  id: string;
  title?: string;
  items: MobileSelectItem[];
}

interface MobileSelectActionSection {
  kind: 'actions';
  id: string;
  title?: string;
  items: MobileSelectActionItem[];
}

export type MobileSelectSection =
  | MobileSelectOptionSection
  | MobileSelectActionSection;

export interface MobileSelectCreateConfig {
  visible: boolean;
  label: (query: string) => string;
  onCreate: (query: string) => void;
}

export interface MobileSelectSheetProps {
  title: string;
  sections: MobileSelectSection[];
  selectedId?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  create?: MobileSelectCreateConfig;
  closeOnSelect?: boolean;
  loading?: boolean;
  emptyText?: string;
  kicker?: string;
  onBack?: () => void;
  onSelect: (id: string) => void;
  onClose: () => void;
}

export function MobileSelectSheet({
  title,
  sections,
  selectedId,
  searchable = false,
  searchPlaceholder,
  create,
  closeOnSelect = false,
  loading = false,
  emptyText = 'No results found',
  kicker,
  onBack,
  onSelect,
  onClose,
}: MobileSelectSheetProps) {
  const [query, setQuery] = useState('');
  const searchId = useId();
  const normalizedQuery = query.trim().toLowerCase();

  const filteredSections = useMemo(() => {
    if (!normalizedQuery) {
      return sections;
    }

    return sections.map((section) => {
      if (section.kind !== 'options') {
        return section;
      }

      return {
        ...section,
        items: section.items.filter((item) => {
          const haystack = `${item.label} ${item.meta ?? ''}`.toLowerCase();
          return haystack.includes(normalizedQuery);
        }),
      };
    });
  }, [normalizedQuery, sections]);

  const hasVisibleItems = filteredSections.some((section) => section.items.length > 0);
  const canCreate = Boolean(create?.visible && query.trim());

  const handleOptionSelect = (id: string) => {
    onSelect(id);
    if (closeOnSelect) {
      onClose();
    }
  };

  const handleActionSelect = (action: () => void) => {
    action();
  };

  const body = (
    <div className="mobile-select-sheet">
      {searchable ? (
        <div className="mobile-select-sheet__search">
          <label className="mobile-select-sheet__search-label" htmlFor={searchId}>
            Search
          </label>
          <input
            id={searchId}
            type="text"
            className="mobile-select-sheet__search-input"
            placeholder={searchPlaceholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      ) : null}

      <div className="mobile-select-sheet__content">
        {loading ? (
          <div className="mobile-select-sheet__empty">{emptyText}</div>
        ) : (
          <>
            {filteredSections.map((section) => {
              if (section.items.length === 0 && section.kind === 'options') {
                return null;
              }

              return (
                <div key={section.id} className="mobile-select-sheet__section">
                  {section.title ? (
                    <div className="mobile-select-sheet__section-title">{section.title}</div>
                  ) : null}
                  <div className="mobile-select-sheet__list">
                    {section.kind === 'options'
                      ? section.items.map((item) => {
                          const isSelected = item.id === selectedId;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              className="mobile-select-sheet__item"
                              data-selected={isSelected ? 'true' : 'false'}
                              aria-label={item.label}
                              onClick={() => handleOptionSelect(item.id)}
                            >
                              <span className="mobile-select-sheet__item-copy">
                                <span className="mobile-select-sheet__item-label">{item.label}</span>
                                {item.meta ? (
                                  <span className="mobile-select-sheet__item-meta">{item.meta}</span>
                                ) : null}
                              </span>
                              <span className="mobile-select-sheet__item-check" aria-hidden="true">
                                {isSelected ? <Check size={16} /> : null}
                              </span>
                            </button>
                          );
                        })
                      : section.items.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            className="mobile-select-sheet__item mobile-select-sheet__item--action"
                            aria-label={item.label}
                            onClick={() => handleActionSelect(item.onAction)}
                          >
                            <span className="mobile-select-sheet__item-copy">
                              <span className="mobile-select-sheet__item-label">{item.label}</span>
                              {item.meta ? (
                                <span className="mobile-select-sheet__item-meta">{item.meta}</span>
                              ) : null}
                            </span>
                          </button>
                        ))}
                  </div>
                </div>
              );
            })}

            {canCreate ? (
              <div className="mobile-select-sheet__section">
                <div className="mobile-select-sheet__list">
                  <button
                    type="button"
                    className="mobile-select-sheet__item mobile-select-sheet__item--create"
                    aria-label={create?.label(query.trim())}
                    onClick={() => create?.onCreate(query.trim())}
                  >
                    <span className="mobile-select-sheet__item-copy">
                      <span className="mobile-select-sheet__item-label">
                        {create?.label(query.trim())}
                      </span>
                    </span>
                  </button>
                </div>
              </div>
            ) : null}

            {!hasVisibleItems && !canCreate ? (
              <div className="mobile-select-sheet__empty">{emptyText}</div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );

  return (
    <MobileSheet
      title={title}
      body={body}
      onClose={onClose}
      kicker={kicker}
      onBack={onBack}
      bodyClassName="mobile-sheet__body--flush"
      contentClassName="mobile-sheet--mobile-select"
      fullscreen
    />
  );
}

export default MobileSelectSheet;
