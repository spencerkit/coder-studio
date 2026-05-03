import { useId, useMemo, useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { MobileSheet } from '../../workspace/views/mobile/mobile-sheet';

export interface MobileSelectItem {
  id: string;
  label: string;
  description?: string;
  meta?: string;
  badge?: string;
  icon?: ReactNode;
  disabled?: boolean;
  keywords?: string[];
  tone?: 'default' | 'danger';
}

export interface MobileSelectActionItem {
  id: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  onAction: () => void | Promise<void>;
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
  disabled?: (query: string) => boolean;
  onCreate: (query: string) => void | Promise<void>;
}

export interface MobileSelectSheetProps {
  title: string;
  sections: MobileSelectSection[];
  selectedId?: string | null;
  searchable?: boolean;
  searchPlaceholder?: string;
  create?: MobileSelectCreateConfig;
  closeOnSelect?: boolean;
  loading?: boolean;
  loadingText?: string;
  emptyText?: string;
  kicker?: string;
  onBack?: () => void;
  onSelect: (id: string) => void | Promise<void>;
  onClose: () => void;
}

export function MobileSelectSheet({
  title,
  sections,
  selectedId,
  searchable = false,
  searchPlaceholder,
  create,
  closeOnSelect = true,
  loading = false,
  loadingText = 'Loading',
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
          const haystack = [
            item.label,
            item.description ?? '',
            item.meta ?? '',
            ...(item.keywords ?? []),
          ]
            .join(' ')
            .toLowerCase();
          return haystack.includes(normalizedQuery);
        }),
      };
    });
  }, [normalizedQuery, sections]);

  const hasVisibleItems = filteredSections.some((section) => section.items.length > 0);
  const canCreate = Boolean(create?.visible && query.trim());
  const createDisabled = Boolean(canCreate && create?.disabled?.(query.trim()));

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
          <div className="mobile-select-sheet__loading" role="status">
            {loadingText}
          </div>
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
                              className={`mobile-select-sheet__item ${
                                item.tone === 'danger' ? 'mobile-select-sheet__item--danger' : ''
                              }`}
                              data-selected={isSelected ? 'true' : 'false'}
                              aria-label={item.label}
                              disabled={item.disabled}
                              onClick={() => handleOptionSelect(item.id)}
                            >
                              {item.icon ? (
                                <span className="mobile-select-sheet__item-icon" aria-hidden="true">
                                  {item.icon}
                                </span>
                              ) : null}
                              <span className="mobile-select-sheet__item-copy">
                                <span className="mobile-select-sheet__item-label">{item.label}</span>
                                {item.description ? (
                                  <span className="mobile-select-sheet__item-description">
                                    {item.description}
                                  </span>
                                ) : null}
                                {item.meta ? (
                                  <span className="mobile-select-sheet__item-meta">{item.meta}</span>
                                ) : null}
                              </span>
                              {item.badge ? (
                                <span className="mobile-select-sheet__item-badge">{item.badge}</span>
                              ) : null}
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
                            className={`mobile-select-sheet__item mobile-select-sheet__item--action ${
                              item.tone === 'danger' ? 'mobile-select-sheet__item--danger' : ''
                            }`}
                            aria-label={item.label}
                            disabled={item.disabled}
                            onClick={() => handleActionSelect(item.onAction)}
                          >
                            {item.icon ? (
                              <span className="mobile-select-sheet__item-icon" aria-hidden="true">
                                {item.icon}
                              </span>
                            ) : null}
                            <span className="mobile-select-sheet__item-copy">
                              <span className="mobile-select-sheet__item-label">{item.label}</span>
                              {item.description ? (
                                <span className="mobile-select-sheet__item-description">
                                  {item.description}
                                </span>
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
                    disabled={createDisabled}
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
