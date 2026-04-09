import type { Locale, Translator } from "../../i18n";
import type { AppRoute, CommandPaletteAction } from "../../types/app";

type WorkspacePaletteTarget = {
  id: string;
  label: string;
};

type BuildCommandPaletteActionsOptions = {
  locale: Locale;
  t: Translator;
  route: AppRoute;
  isFocusMode: boolean;
  showCodePanel: boolean;
  showTerminalPanel: boolean;
  workspaceTabs: WorkspacePaletteTarget[];
  onAddTab: () => void;
  onToggleFocusMode: () => void;
  onToggleCodePanel: () => void;
  onToggleTerminalPanel: () => void;
  onFocusAgent: () => void;
  onSplitVertical: () => void;
  onSplitHorizontal: () => void;
  onCycleWorkspace: (direction: number) => void;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  onSwitchWorkspace: (tabId: string) => void;
};

export const buildCommandPaletteActions = ({
  t,
  route,
  isFocusMode,
  showCodePanel,
  showTerminalPanel,
  workspaceTabs,
  onAddTab,
  onToggleFocusMode,
  onToggleCodePanel,
  onToggleTerminalPanel,
  onFocusAgent,
  onSplitVertical,
  onSplitHorizontal,
  onCycleWorkspace,
  onOpenSettings,
  onCloseSettings,
  onSwitchWorkspace,
}: BuildCommandPaletteActionsOptions): CommandPaletteAction[] => [
  {
    id: "new-workspace",
    label: t("commandPaletteNewWorkspace"),
    description: t("commandPaletteNewWorkspaceDesc"),
    shortcut: "⌘/Ctrl N",
    keywords: "new workspace tab add create",
    run: onAddTab,
  },
  {
    id: "toggle-focus",
    label: isFocusMode ? t("commandPaletteExitFocusMode") : t("commandPaletteEnterFocusMode"),
    description: t("commandPaletteToggleFocusModeDesc"),
    shortcut: "F",
    keywords: "focus mode zen panel hide",
    run: onToggleFocusMode,
  },
  {
    id: "toggle-code",
    label: showCodePanel
      ? t("commandPaletteHideCodePanel")
      : t("commandPaletteShowCodePanel"),
    description: t("commandPaletteToggleCodeDesc"),
    keywords: "code panel preview right inspector",
    run: onToggleCodePanel,
  },
  {
    id: "toggle-terminal",
    label: showTerminalPanel
      ? t("commandPaletteHideTerminalPanel")
      : t("commandPaletteShowTerminalPanel"),
    description: t("commandPaletteToggleTerminalDesc"),
    keywords: "terminal panel shell dock right",
    run: onToggleTerminalPanel,
  },
  {
    id: "focus-input",
    label: t("commandPaletteFocusAgent"),
    description: t("commandPaletteFocusAgentDesc"),
    keywords: "agent terminal focus",
    run: onFocusAgent,
  },
  {
    id: "split-pane-vertical",
    label: t("splitVertical"),
    description: t("splitVerticalDescription"),
    shortcut: "Alt/⌘ D",
    keywords: "split pane vertical agent",
    run: onSplitVertical,
  },
  {
    id: "split-pane-horizontal",
    label: t("splitHorizontal"),
    description: t("splitHorizontalDescription"),
    shortcut: "Shift + Alt/⌘ D",
    keywords: "split pane horizontal agent",
    run: onSplitHorizontal,
  },
  {
    id: "switch-prev-workspace",
    label: t("commandPaletteSwitchPrevWorkspace"),
    description: t("commandPaletteSwitchPrevWorkspaceDesc"),
    shortcut: "⌘/Ctrl ⇧ [",
    keywords: "workspace previous back",
    run: () => onCycleWorkspace(-1),
  },
  {
    id: "switch-next-workspace",
    label: t("commandPaletteSwitchNextWorkspace"),
    description: t("commandPaletteSwitchNextWorkspaceDesc"),
    shortcut: "⌘/Ctrl ⇧ ]",
    keywords: "workspace next forward",
    run: () => onCycleWorkspace(1),
  },
  {
    id: "open-settings",
    label: route === "settings"
      ? t("commandPaletteBackToWorkspace")
      : t("commandPaletteOpenSettings"),
    description: route === "settings"
      ? t("commandPaletteBackToWorkspaceDesc")
      : t("commandPaletteOpenSettingsDesc"),
    keywords: "settings preferences",
    run: () => {
      if (route === "settings") {
        onCloseSettings();
        return;
      }
      onOpenSettings();
    },
  },
  ...workspaceTabs.map((tab) => ({
    id: `workspace:${tab.id}`,
    label: t("commandPaletteSwitchTo", { label: tab.label }),
    description: t("commandPaletteSwitchToDesc"),
    keywords: `workspace ${tab.label.toLowerCase()}`,
    run: () => onSwitchWorkspace(tab.id),
  })),
];

export const filterCommandPaletteActions = (actions: CommandPaletteAction[], query: string) => {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return actions;
  return actions.filter((action) => {
    const haystack = `${action.label} ${action.description} ${action.keywords}`.toLowerCase();
    return haystack.includes(normalizedQuery);
  });
};
