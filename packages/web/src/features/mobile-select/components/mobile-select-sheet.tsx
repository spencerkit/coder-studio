import { type ReactNode, useId, useMemo, useState } from "react";
import { EmptyState, IconButton, Sheet, Tag } from "../../../components/ui";
import { useTranslation } from "../../../lib/i18n";
import { PageHeader } from "../../shared/components/page-header";

export interface MobileSelectItemTrailingAction {
  id: string;
  ariaLabel: string;
  icon: ReactNode;
  tone?: "default" | "danger";
  disabled?: boolean;
  onAction: () => void | Promise<void>;
}

export interface MobileSelectItem {
  id: string;
  label: string;
  description?: string;
  meta?: string;
  badge?: string;
  icon?: ReactNode;
  disabled?: boolean;
  keywords?: string[];
  tone?: "default" | "danger";
  trailingAction?: MobileSelectItemTrailingAction;
}

export interface MobileSelectActionItem {
  id: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  tone?: "default" | "danger";
  disabled?: boolean;
  onAction: () => void | Promise<void>;
}

interface MobileSelectOptionSection {
  kind: "options";
  id: string;
  title?: string;
  items: MobileSelectItem[];
}

interface MobileSelectActionSection {
  kind: "actions";
  id: string;
  title?: string;
  items: MobileSelectActionItem[];
}

export type MobileSelectSection = MobileSelectOptionSection | MobileSelectActionSection;

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
  presentation?: "sheet" | "inline";
  searchable?: boolean;
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchValueChange?: (value: string) => void;
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

const mobileSelectEmptyStateStyle = {
  minHeight: "auto",
  padding: "var(--sp-6) var(--sp-4)",
  gap: 0,
};

const mobileSelectLoadingStateStyle = {
  minHeight: "auto",
  padding: "var(--sp-6) var(--sp-4)",
  gap: 0,
};

const mobileSelectLoadingStateTitleStyle = {
  color: "var(--text-secondary)",
  fontSize: "inherit",
  fontWeight: "var(--font-normal)",
  lineHeight: "inherit",
};

const mobileSelectEmptyStateTitleStyle = {
  color: "var(--text-tertiary)",
  fontSize: "inherit",
  fontWeight: "var(--font-normal)",
  lineHeight: "inherit",
};

export function MobileSelectSheet({
  title,
  sections,
  selectedId,
  presentation = "sheet",
  searchable = false,
  searchPlaceholder,
  searchValue,
  onSearchValueChange,
  create,
  closeOnSelect = true,
  loading = false,
  loadingText,
  emptyText,
  kicker,
  onBack,
  onSelect,
  onClose,
}: MobileSelectSheetProps) {
  const t = useTranslation();
  const [uncontrolledQuery, setUncontrolledQuery] = useState("");
  const searchId = useId();
  const query = searchValue ?? uncontrolledQuery;
  const normalizedQuery = query.trim().toLowerCase();
  const resolvedLoadingText = loadingText ?? t("common.loading");
  const resolvedEmptyText = emptyText ?? t("command.no_results");
  const resolvedSearchPlaceholder = searchPlaceholder ?? t("action.search");

  const handleQueryChange = (value: string) => {
    if (searchValue === undefined) {
      setUncontrolledQuery(value);
    }

    onSearchValueChange?.(value);
  };

  const filteredSections = useMemo(() => {
    if (!normalizedQuery) {
      return sections;
    }

    return sections.map((section) => {
      if (section.kind !== "options") {
        return section;
      }

      return {
        ...section,
        items: section.items.filter((item) => {
          const haystack = [
            item.label,
            item.description ?? "",
            item.meta ?? "",
            ...(item.keywords ?? []),
          ]
            .join(" ")
            .toLowerCase();
          return haystack.includes(normalizedQuery);
        }),
      };
    });
  }, [normalizedQuery, sections]);

  const hasVisibleItems = filteredSections.some((section) => section.items.length > 0);
  const canCreate = Boolean(create?.visible && query.trim());
  const createDisabled = Boolean(canCreate && create?.disabled?.(query.trim()));

  const runAsyncHandler = (
    context: "select" | "action" | "create",
    handler: () => void | Promise<void>
  ) => {
    void Promise.resolve(handler()).catch((error: unknown) => {
      console.error(`MobileSelectSheet ${context} failed`, error);
    });
  };

  const handleOptionSelect = (id: string) => {
    runAsyncHandler("select", async () => {
      await onSelect(id);
      if (closeOnSelect) {
        onClose();
      }
    });
  };

  const handleActionSelect = (action: () => void | Promise<void>) => {
    runAsyncHandler("action", action);
  };

  const handleTrailingAction = (action: () => void | Promise<void>) => {
    runAsyncHandler("action", action);
  };

  const handleCreate = () => {
    if (!create || !query.trim()) {
      return;
    }

    runAsyncHandler("create", () => create.onCreate(query.trim()));
  };

  const content = (
    <>
      {searchable ? (
        <div className="mobile-select-sheet__search">
          <label className="mobile-select-sheet__search-label" htmlFor={searchId}>
            {t("action.search")}
          </label>
          <input
            id={searchId}
            type="text"
            className="mobile-select-sheet__search-input"
            placeholder={resolvedSearchPlaceholder}
            value={query}
            onChange={(event) => handleQueryChange(event.target.value)}
          />
        </div>
      ) : null}

      <div className="mobile-select-sheet__content">
        {loading ? (
          <EmptyState
            className="mobile-select-sheet__loading"
            role="status"
            style={mobileSelectLoadingStateStyle}
            title={<div style={mobileSelectLoadingStateTitleStyle}>{resolvedLoadingText}</div>}
          />
        ) : (
          <>
            {filteredSections.map((section) => {
              if (section.items.length === 0 && section.kind === "options") {
                return null;
              }

              return (
                <div key={section.id} className="mobile-select-sheet__section">
                  {section.title ? (
                    <div className="mobile-select-sheet__section-title">{section.title}</div>
                  ) : null}
                  <div className="mobile-select-sheet__list">
                    {section.kind === "options"
                      ? section.items.map((item) => {
                          const isSelected = item.id === selectedId;
                          const labelId = `${section.id}-${item.id}-label`;
                          const descriptionIds = [
                            item.description ? `${section.id}-${item.id}-description` : null,
                            item.meta ? `${section.id}-${item.id}-meta` : null,
                          ]
                            .filter(Boolean)
                            .join(" ");
                          const optionButton = (
                            <button
                              type="button"
                              className={`mobile-select-sheet__item ${
                                item.tone === "danger" ? "mobile-select-sheet__item--danger" : ""
                              }`}
                              aria-pressed={isSelected}
                              aria-labelledby={labelId}
                              aria-describedby={descriptionIds || undefined}
                              disabled={item.disabled}
                              onClick={() => handleOptionSelect(item.id)}
                            >
                              {item.icon ? (
                                <span className="mobile-select-sheet__item-icon" aria-hidden="true">
                                  {item.icon}
                                </span>
                              ) : null}
                              <span className="mobile-select-sheet__item-copy">
                                <span id={labelId} className="mobile-select-sheet__item-label">
                                  {item.label}
                                </span>
                                {item.description ? (
                                  <span
                                    id={`${section.id}-${item.id}-description`}
                                    className="mobile-select-sheet__item-description"
                                  >
                                    {item.description}
                                  </span>
                                ) : null}
                                {item.meta ? (
                                  <span
                                    id={`${section.id}-${item.id}-meta`}
                                    className="mobile-select-sheet__item-meta"
                                  >
                                    {item.meta}
                                  </span>
                                ) : null}
                              </span>
                              {item.badge ? (
                                <Tag
                                  color="neutral"
                                  caps={false}
                                  className="mobile-select-sheet__item-badge"
                                >
                                  {item.badge}
                                </Tag>
                              ) : null}
                            </button>
                          );

                          if (!item.trailingAction) {
                            return (
                              <div key={item.id} data-selected={isSelected ? "true" : "false"}>
                                {optionButton}
                              </div>
                            );
                          }

                          return (
                            <div
                              key={item.id}
                              className="mobile-select-sheet__item-row"
                              data-selected={isSelected ? "true" : "false"}
                            >
                              {optionButton}
                              <IconButton
                                aria-label={item.trailingAction.ariaLabel}
                                className={`mobile-select-sheet__item-side-action ${
                                  item.trailingAction.tone === "danger"
                                    ? "mobile-select-sheet__item-side-action--danger"
                                    : ""
                                }`}
                                disabled={item.disabled || item.trailingAction.disabled}
                                icon={
                                  <span className="mobile-select-sheet__item-side-action-icon">
                                    {item.trailingAction.icon}
                                  </span>
                                }
                                onClick={() => handleTrailingAction(item.trailingAction.onAction)}
                                size="lg"
                                variant="ghost"
                              />
                            </div>
                          );
                        })
                      : section.items.map((item) => {
                          const labelId = `${section.id}-${item.id}-label`;
                          const descriptionId = item.description
                            ? `${section.id}-${item.id}-description`
                            : undefined;

                          return (
                            <button
                              key={item.id}
                              type="button"
                              className={`mobile-select-sheet__item mobile-select-sheet__item--action ${
                                item.tone === "danger" ? "mobile-select-sheet__item--danger" : ""
                              }`}
                              aria-labelledby={labelId}
                              aria-describedby={descriptionId}
                              disabled={item.disabled}
                              onClick={() => handleActionSelect(item.onAction)}
                            >
                              {item.icon ? (
                                <span className="mobile-select-sheet__item-icon" aria-hidden="true">
                                  {item.icon}
                                </span>
                              ) : null}
                              <span className="mobile-select-sheet__item-copy">
                                <span id={labelId} className="mobile-select-sheet__item-label">
                                  {item.label}
                                </span>
                                {item.description ? (
                                  <span
                                    id={descriptionId}
                                    className="mobile-select-sheet__item-description"
                                  >
                                    {item.description}
                                  </span>
                                ) : null}
                              </span>
                            </button>
                          );
                        })}
                  </div>
                </div>
              );
            })}

            {canCreate ? (
              <div className="mobile-select-sheet__section">
                <div className="mobile-select-sheet__list">
                  {(() => {
                    const labelId = "mobile-select-create-label";

                    return (
                      <button
                        type="button"
                        className="mobile-select-sheet__item mobile-select-sheet__item--create"
                        aria-labelledby={labelId}
                        disabled={createDisabled}
                        onClick={handleCreate}
                      >
                        <span className="mobile-select-sheet__item-copy">
                          <span id={labelId} className="mobile-select-sheet__item-label">
                            {create?.label(query.trim())}
                          </span>
                        </span>
                      </button>
                    );
                  })()}
                </div>
              </div>
            ) : null}

            {!hasVisibleItems && !canCreate ? (
              <EmptyState
                className="mobile-select-sheet__empty"
                style={mobileSelectEmptyStateStyle}
                title={<div style={mobileSelectEmptyStateTitleStyle}>{resolvedEmptyText}</div>}
              />
            ) : null}
          </>
        )}
      </div>
    </>
  );

  if (presentation === "inline") {
    return (
      <div className="mobile-inline-sheet" role="dialog" aria-label={title}>
        <div className="mobile-inline-sheet__handle" aria-hidden="true" />
        <div className="mobile-inline-sheet__header">
          <PageHeader title={title} titleAs="h3" onBack={onBack} backLabel={t("action.back")} />
        </div>
        <div className="mobile-inline-sheet__body">
          <div className="mobile-select-sheet mobile-select-sheet--inline">{content}</div>
        </div>
      </div>
    );
  }

  return (
    <Sheet
      title={title}
      body={<div className="mobile-select-sheet">{content}</div>}
      onClose={onClose}
      kicker={kicker}
      onBack={onBack}
      bodyClassName="mobile-sheet__body--flush"
      fullscreen
    />
  );
}

export default MobileSelectSheet;
