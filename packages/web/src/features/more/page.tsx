import { useAtomValue } from "jotai";
import { ChevronRight } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { resolvedActiveWorkspaceIdAtom } from "../../atoms/workspaces";
import { ThemedIcon } from "../../components/ui";
import { useViewport } from "../../hooks/use-viewport";
import { useTranslation } from "../../lib/i18n";
import { DiagnosticsPage } from "../diagnostics";
import { SettingsPage } from "../settings";
import { MobilePageHeader } from "../shared/components/mobile-page-header";
import { PageHeader } from "../shared/components/page-header";
import { WorkAnalyticsSettingsSection } from "../work-analysis";
import {
  buildMorePath,
  MORE_CATEGORIES,
  type MoreCategoryDefinition,
  type MoreCategoryId,
  type MoreSectionDefinition,
  parseMoreRoute,
} from "./routes";

const MORE_CATEGORY_LIST = Object.values(MORE_CATEGORIES) as MoreCategoryDefinition[];
const FALLBACK_CATEGORY = MORE_CATEGORIES.settings;
type EmbeddedMoreSettingsSection =
  | "general"
  | "providers"
  | "terminal"
  | "appearance"
  | "shortcuts"
  | "monitoring";
type MoreAboutSectionId = "product" | "update-status" | "auto-update";

const ABOUT_VIEW_BY_SECTION: Record<MoreAboutSectionId, MoreAboutSectionId> = {
  product: "product",
  "update-status": "update-status",
  "auto-update": "auto-update",
};

function resolveDefaultSection(category: MoreCategoryDefinition): MoreSectionDefinition {
  const section =
    category.sections.find((candidate) => candidate.id === category.defaultSection) ??
    category.sections[0];

  if (!section) {
    throw new Error(`More category "${category.id}" is missing section metadata.`);
  }

  return section;
}

function resolveDesktopMoreState(pathname: string) {
  const fallbackSection = resolveDefaultSection(FALLBACK_CATEGORY);
  const fallbackPath = buildMorePath(FALLBACK_CATEGORY.id, fallbackSection.id);
  const routeState = parseMoreRoute(pathname);

  if (!routeState.isValid || !routeState.category) {
    return {
      activeCategory: FALLBACK_CATEGORY,
      activeSection: fallbackSection,
      canonicalPath: fallbackPath,
    };
  }

  const category = MORE_CATEGORIES[routeState.category];
  const defaultSection = resolveDefaultSection(category);

  if (!routeState.section) {
    return {
      activeCategory: category,
      activeSection: defaultSection,
      canonicalPath: buildMorePath(category.id, defaultSection.id),
    };
  }

  const section = category.sections.find((candidate) => candidate.id === routeState.section);

  if (!section) {
    return {
      activeCategory: category,
      activeSection: defaultSection,
      canonicalPath: buildMorePath(category.id, defaultSection.id),
    };
  }

  return {
    activeCategory: category,
    activeSection: section,
    canonicalPath: buildMorePath(category.id, section.id),
  };
}

function resolveMobileMoreState(pathname: string) {
  const routeState = parseMoreRoute(pathname);

  if (!routeState.isValid) {
    return {
      activeCategory: null,
      activeSection: null,
      canonicalPath: "/more",
    };
  }

  if (!routeState.category) {
    return {
      activeCategory: null,
      activeSection: null,
      canonicalPath: "/more",
    };
  }

  const activeCategory = MORE_CATEGORIES[routeState.category];

  if (!routeState.section) {
    return {
      activeCategory,
      activeSection: null,
      canonicalPath: buildMorePath(activeCategory.id),
    };
  }

  const activeSection = activeCategory.sections.find(
    (candidate) => candidate.id === routeState.section
  );

  if (!activeSection) {
    return {
      activeCategory,
      activeSection: null,
      canonicalPath: buildMorePath(activeCategory.id),
    };
  }

  return {
    activeCategory,
    activeSection,
    canonicalPath: buildMorePath(activeCategory.id, activeSection.id),
  };
}

function isEmbeddedSettingsSection(sectionId: string): sectionId is EmbeddedMoreSettingsSection {
  return (
    sectionId === "general" ||
    sectionId === "providers" ||
    sectionId === "terminal" ||
    sectionId === "appearance" ||
    sectionId === "shortcuts" ||
    sectionId === "monitoring"
  );
}

function isAboutSectionId(sectionId: string): sectionId is MoreAboutSectionId {
  return Object.hasOwn(ABOUT_VIEW_BY_SECTION, sectionId);
}

function renderMoreRouteContent(
  category: MoreCategoryDefinition,
  section: MoreSectionDefinition,
  activeWorkspaceId: string | null
): ReactNode {
  if (category.id === "settings") {
    if (!isEmbeddedSettingsSection(section.id)) {
      return null;
    }

    return <SettingsPage embeddedSection={section.id} />;
  }

  if (category.id === "analysis" && section.id === "monitoring") {
    return <SettingsPage embeddedSection="monitoring" />;
  }

  if (category.id === "about") {
    if (!isAboutSectionId(section.id)) {
      return null;
    }

    return <SettingsPage embeddedSection="about" aboutView={ABOUT_VIEW_BY_SECTION[section.id]} />;
  }

  switch (section.id) {
    case "analytics":
      return <WorkAnalyticsSettingsSection />;
    case "diagnostics":
      return (
        <div className="settings-section">
          <DiagnosticsPage
            embedded
            intent={{
              context: "manual_check",
              workspaceId: activeWorkspaceId ?? undefined,
            }}
          />
        </div>
      );
    default:
      return null;
  }
}

function MoreMobileCategoryList({
  title,
  backLabel,
  items,
  onBack,
  onSelect,
}: {
  title: string;
  backLabel: string;
  items: readonly { id: MoreCategoryId; label: string; hint: string }[];
  onBack: () => void;
  onSelect: (id: MoreCategoryId) => void;
}) {
  return (
    <div className="more-features-page more-features-page--mobile" data-testid="more-features-page">
      <header className="more-features-mobile-detail__header">
        <MobilePageHeader title={title} titleAs="h3" onBack={onBack} backLabel={backLabel} />
      </header>
      <main className="more-features-mobile-list" role="list">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className="more-features-mobile-item"
            onClick={() => onSelect(item.id)}
          >
            <span className="more-features-mobile-item__label">{item.label}</span>
            <span className="more-features-mobile-item__hint">{item.hint}</span>
          </button>
        ))}
      </main>
    </div>
  );
}

export function MoreFeaturesPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const t = useTranslation();
  const viewport = useViewport();
  const activeWorkspaceId = useAtomValue(resolvedActiveWorkspaceIdAtom);
  const { activeCategory, activeSection, canonicalPath } = resolveDesktopMoreState(
    location.pathname
  );
  const mobileState = resolveMobileMoreState(location.pathname);

  const desktopContent = renderMoreRouteContent(activeCategory, activeSection, activeWorkspaceId);

  useEffect(() => {
    if (viewport !== "mobile" && location.pathname !== canonicalPath) {
      navigate(canonicalPath, { replace: true });
    }
  }, [canonicalPath, location.pathname, navigate, viewport]);

  useEffect(() => {
    if (viewport === "mobile" && location.pathname !== mobileState.canonicalPath) {
      navigate(mobileState.canonicalPath, { replace: true });
    }
  }, [location.pathname, mobileState.canonicalPath, navigate, viewport]);

  const handleBack = () => {
    navigate(activeWorkspaceId ? "/workspace" : "/");
  };

  const handleCategoryTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    categoryIndex: number
  ) => {
    const moveToIndex = (nextIndex: number) => {
      const nextCategory = MORE_CATEGORY_LIST[nextIndex];
      if (!nextCategory) {
        return;
      }

      const nextSection = resolveDefaultSection(nextCategory);
      const tablist = event.currentTarget.closest('[role="tablist"]');
      const tabs = tablist
        ? Array.from(
            tablist.querySelectorAll<HTMLButtonElement>('button[role="tab"]:not(:disabled)')
          )
        : [];

      tabs[nextIndex]?.focus();
      navigate(buildMorePath(nextCategory.id, nextSection.id));
      event.preventDefault();
    };

    if (event.key === "ArrowRight") {
      moveToIndex((categoryIndex + 1) % MORE_CATEGORY_LIST.length);
    } else if (event.key === "ArrowLeft") {
      moveToIndex((categoryIndex - 1 + MORE_CATEGORY_LIST.length) % MORE_CATEGORY_LIST.length);
    } else if (event.key === "Home") {
      moveToIndex(0);
    } else if (event.key === "End") {
      moveToIndex(MORE_CATEGORY_LIST.length - 1);
    }
  };

  if (viewport === "mobile") {
    if (!mobileState.activeCategory) {
      return (
        <MoreMobileCategoryList
          title={t("more.title")}
          backLabel={t("action.back")}
          items={MORE_CATEGORY_LIST.map((category) => ({
            id: category.id,
            label: t(category.labelKey),
            hint: t(category.descriptionKey),
          }))}
          onBack={handleBack}
          onSelect={(categoryId) => navigate(buildMorePath(categoryId))}
        />
      );
    }

    if (!mobileState.activeSection) {
      const mobileCategory = mobileState.activeCategory;

      return (
        <div
          className="more-features-page more-features-page--mobile"
          data-testid="more-features-page"
        >
          <header className="more-features-mobile-detail__header">
            <MobilePageHeader
              title={t(mobileCategory.labelKey)}
              titleAs="div"
              onBack={() => navigate("/more")}
              backLabel={t("action.back")}
            />
          </header>
          <main className="more-features-mobile-list" role="list">
            {mobileCategory.sections.map((section) => (
              <button
                key={section.id}
                type="button"
                className="more-features-mobile-item"
                onClick={() => navigate(buildMorePath(mobileCategory.id, section.id))}
              >
                <span className="more-features-mobile-item__label">{t(section.labelKey)}</span>
                <span className="more-features-mobile-item__hint">{t(section.hintKey)}</span>
              </button>
            ))}
          </main>
        </div>
      );
    }

    const mobileDesktopState = resolveDesktopMoreState(location.pathname);
    const mobileContent = renderMoreRouteContent(
      mobileDesktopState.activeCategory,
      mobileDesktopState.activeSection,
      activeWorkspaceId
    );

    return (
      <div
        className="more-features-page more-features-mobile-detail"
        data-testid="more-features-page"
      >
        <header className="more-features-mobile-detail__header">
          <MobilePageHeader
            title={t(mobileState.activeSection.labelKey)}
            titleAs="div"
            onBack={() => navigate(buildMorePath(mobileState.activeCategory.id))}
            backLabel={t("action.back")}
          />
        </header>
        <main className="more-features-mobile-detail__content">
          <div className="more-features-mobile-detail__surface">{mobileContent}</div>
        </main>
      </div>
    );
  }

  return (
    <div
      className="more-features-page more-features-page--desktop more-features-page--desktop-flush"
      data-testid="more-features-page"
    >
      <div className="more-features-page__frame more-features-page__frame--compact-top more-features-page__frame--tight-bottom">
        <header className="more-features-page__header">
          <PageHeader
            title={t("more.title")}
            titleAs="h3"
            level="secondary"
            onBack={handleBack}
            backLabel={t("action.back")}
            className="more-features-page__page-header"
          />
        </header>
      </div>

      <div className="more-features-page__divider" aria-hidden="true" />

      <div className="more-features-page__frame more-features-page__frame--tight-top more-features-page__frame--tight-bottom">
        <div role="tablist" aria-label={t("more.category_tabs")} className="more-features-tabs">
          {MORE_CATEGORY_LIST.map((category, categoryIndex) => {
            const isActive = category.id === activeCategory.id;

            return (
              <button
                key={category.id}
                type="button"
                role="tab"
                aria-label={t(category.labelKey)}
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                className={isActive ? "more-features-tab is-active" : "more-features-tab"}
                onKeyDown={(event) => handleCategoryTabKeyDown(event, categoryIndex)}
                onClick={() =>
                  navigate(buildMorePath(category.id, resolveDefaultSection(category).id))
                }
              >
                <span className="more-features-tab__label">{t(category.labelKey)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="more-features-shell more-features-shell--top-flush">
        <aside className="more-features-shell__nav more-features-shell__nav--top-flush more-features-shell__nav--inner-padded">
          <nav className="more-features-nav" aria-label={t("more.section_navigation")}>
            {activeCategory.sections.map((section) => {
              const isActive = section.id === activeSection.id;

              return (
                <button
                  key={section.id}
                  type="button"
                  aria-label={t(section.labelKey)}
                  aria-current={isActive ? "page" : undefined}
                  className={
                    isActive
                      ? "more-features-nav-item settings-nav-item settings-nav-item-active"
                      : "more-features-nav-item settings-nav-item"
                  }
                  onClick={() => navigate(buildMorePath(activeCategory.id, section.id))}
                >
                  <span className="settings-nav-icon">
                    <ThemedIcon semantic={section.iconSemantic} size={16} />
                  </span>
                  <span className="more-features-nav-item__label settings-nav-label">
                    {t(section.labelKey)}
                  </span>
                  {isActive ? <ChevronRight size={14} className="settings-nav-arrow" /> : null}
                </button>
              );
            })}
          </nav>
        </aside>

        <main className="more-features-shell__content more-features-shell__content--gutter more-features-shell__content--inner-padded">
          <div className="more-features-content">
            <div className="more-features-content__panel more-features-content__panel--top-flush">
              {desktopContent}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
