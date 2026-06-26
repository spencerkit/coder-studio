import type { IconSemantic } from "../../theme";

export type MoreCategoryId = "settings" | "analysis" | "about";

export type MoreSectionDefinition = {
  id: string;
  labelKey: string;
  hintKey: string;
  iconSemantic: IconSemantic;
};

export type MoreCategoryDefinition = {
  id: MoreCategoryId;
  labelKey: string;
  descriptionKey: string;
  defaultSection: string;
  sections: readonly MoreSectionDefinition[];
};

export const MORE_CATEGORIES = {
  settings: {
    id: "settings",
    labelKey: "more.category.settings",
    descriptionKey: "more.category.settings_hint",
    defaultSection: "general",
    sections: [
      {
        id: "general",
        labelKey: "settings.general",
        hintKey: "more.section.settings.general_hint",
        iconSemantic: "nav.settings.general",
      },
      {
        id: "providers",
        labelKey: "more.section.settings.agents",
        hintKey: "more.section.settings.agents_hint",
        iconSemantic: "nav.settings.providers",
      },
      {
        id: "terminal",
        labelKey: "label.terminal",
        hintKey: "more.section.settings.terminal_hint",
        iconSemantic: "nav.settings.terminal",
      },
      {
        id: "appearance",
        labelKey: "settings.appearance",
        hintKey: "more.section.settings.appearance_hint",
        iconSemantic: "nav.settings.appearance",
      },
      {
        id: "shortcuts",
        labelKey: "settings.shortcuts.title",
        hintKey: "more.section.settings.shortcuts_hint",
        iconSemantic: "nav.settings.shortcuts",
      },
    ],
  },
  analysis: {
    id: "analysis",
    labelKey: "more.category.analysis",
    descriptionKey: "more.category.analysis_hint",
    defaultSection: "analytics",
    sections: [
      {
        id: "analytics",
        labelKey: "settings.analysis.title",
        hintKey: "more.section.analysis.analytics_hint",
        iconSemantic: "nav.settings.analysis",
      },
      {
        id: "monitoring",
        labelKey: "monitoring.title",
        hintKey: "more.section.analysis.monitoring_hint",
        iconSemantic: "nav.settings.monitoring",
      },
      {
        id: "diagnostics",
        labelKey: "settings.diagnostics.title",
        hintKey: "more.section.analysis.diagnostics_hint",
        iconSemantic: "nav.settings.diagnostics",
      },
    ],
  },
  about: {
    id: "about",
    labelKey: "more.category.about",
    descriptionKey: "more.category.about_hint",
    defaultSection: "product",
    sections: [
      {
        id: "product",
        labelKey: "more.section.about.product",
        hintKey: "more.section.about.product_hint",
        iconSemantic: "nav.settings.about",
      },
      {
        id: "update-status",
        labelKey: "more.section.about.update_status",
        hintKey: "more.section.about.update_status_hint",
        iconSemantic: "state.info",
      },
      {
        id: "auto-update",
        labelKey: "more.section.about.auto_update",
        hintKey: "more.section.about.auto_update_hint",
        iconSemantic: "nav.settings.about",
      },
    ],
  },
} as const satisfies Record<MoreCategoryId, MoreCategoryDefinition>;

export function buildMorePath(category?: MoreCategoryId, section?: string) {
  if (!category) {
    return "/more";
  }

  return section ? `/more/${category}/${section}` : `/more/${category}`;
}

type ValidMoreRoute = {
  isValid: true;
  category: MoreCategoryId | null;
  section: string | null;
};

type InvalidMoreRoute = {
  isValid: false;
  category: null;
  section: null;
};

export function parseMoreRoute(pathname: string):
  | {
      isValid: true;
      category: MoreCategoryId | null;
      section: string | null;
    }
  | InvalidMoreRoute {
  const match = pathname.match(/^\/more(?:\/(settings|analysis|about)(?:\/([^/]+))?)?$/);

  if (!match) {
    return {
      isValid: false,
      category: null,
      section: null,
    } satisfies InvalidMoreRoute;
  }

  return {
    isValid: true,
    category: (match[1] as MoreCategoryId | undefined) ?? null,
    section: match[2] ?? null,
  } satisfies ValidMoreRoute;
}
