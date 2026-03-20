import type { Locale, Translator } from "../../i18n";
import type {
  ClaudeSlashMenuItem,
  ClaudeSlashMenuSection,
  ClaudeSlashSkillEntry,
} from "../../types/app";
import {
  BUILTIN_SLASH_COMMANDS,
  BUNDLED_CLAUDE_SKILLS,
} from "../../shared/app/constants";

export const buildSlashMenuItems = (
  locale: Locale,
  slashSkillItems: ClaudeSlashSkillEntry[]
): ClaudeSlashMenuItem[] => [
  ...BUILTIN_SLASH_COMMANDS.map((item) => ({
    id: `builtin:${item.command}`,
    command: item.command,
    description: item.description[locale],
    section: "builtin" as const,
  })),
  ...BUNDLED_CLAUDE_SKILLS.map((item) => ({
    id: `bundled:${item.command}`,
    command: item.command,
    description: item.description[locale],
    section: "bundled" as const,
  })),
  ...slashSkillItems.map((item) => ({
    id: item.id,
    command: item.command,
    description: item.description,
    section: item.scope === "personal" ? ("personal" as const) : ("project" as const),
    sourcePath: item.source_path,
    sourceKind: item.source_kind,
  })),
];

export const buildSlashMenuSections = (
  items: ClaudeSlashMenuItem[],
  t: Translator
): ClaudeSlashMenuSection[] => {
  const sections: ClaudeSlashMenuSection[] = [
    {
      id: "builtin",
      label: t("slashBuiltins"),
      items: items.filter((item) => item.section === "builtin"),
    },
    {
      id: "bundled",
      label: t("slashBundledSkills"),
      items: items.filter((item) => item.section === "bundled"),
    },
    {
      id: "project",
      label: t("slashProjectSkills"),
      items: items.filter((item) => item.section === "project"),
    },
    {
      id: "personal",
      label: t("slashPersonalSkills"),
      items: items.filter((item) => item.section === "personal"),
    },
  ];

  return sections.filter((section) => section.items.length > 0);
};
