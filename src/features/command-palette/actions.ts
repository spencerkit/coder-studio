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
  locale,
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
    label: locale === "zh" ? "新建工作区" : "New Workspace",
    description: locale === "zh" ? "创建并切换到新的工作区" : "Create and switch to a new workspace",
    shortcut: "⌘/Ctrl N",
    keywords: "new workspace tab add create",
    run: onAddTab,
  },
  {
    id: "toggle-focus",
    label: locale === "zh" ? (isFocusMode ? "退出专注模式" : "进入专注模式") : (isFocusMode ? "Exit Focus Mode" : "Enter Focus Mode"),
    description: locale === "zh" ? "隐藏左右面板，聚焦命令流" : "Hide side panels and focus the command stream",
    shortcut: "F",
    keywords: "focus mode zen panel hide",
    run: onToggleFocusMode,
  },
  {
    id: "toggle-code",
    label: showCodePanel
      ? (locale === "zh" ? "隐藏代码面板" : "Hide Code Panel")
      : (locale === "zh" ? "显示代码面板" : "Show Code Panel"),
    description: locale === "zh" ? "切换右侧代码预览区域" : "Toggle the right-side code preview area",
    keywords: "code panel preview right inspector",
    run: onToggleCodePanel,
  },
  {
    id: "toggle-terminal",
    label: showTerminalPanel
      ? (locale === "zh" ? "隐藏终端面板" : "Hide Terminal Panel")
      : (locale === "zh" ? "显示终端面板" : "Show Terminal Panel"),
    description: locale === "zh" ? "切换右侧终端区域" : "Toggle the right-side terminal area",
    keywords: "terminal panel shell dock right",
    run: onToggleTerminalPanel,
  },
  {
    id: "focus-input",
    label: locale === "zh" ? "聚焦当前 Agent" : "Focus Current Agent",
    description: locale === "zh" ? "将光标移动到当前 agent 终端" : "Move cursor to the active agent terminal",
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
    label: locale === "zh" ? "切换到上一个工作区" : "Switch To Previous Workspace",
    description: locale === "zh" ? "按时间序列回到上一个工作区" : "Jump to the previous workspace in the stack",
    shortcut: "⌘/Ctrl ⇧ [",
    keywords: "workspace previous back",
    run: () => onCycleWorkspace(-1),
  },
  {
    id: "switch-next-workspace",
    label: locale === "zh" ? "切换到下一个工作区" : "Switch To Next Workspace",
    description: locale === "zh" ? "按时间序列前往下一个工作区" : "Jump to the next workspace in the stack",
    shortcut: "⌘/Ctrl ⇧ ]",
    keywords: "workspace next forward",
    run: () => onCycleWorkspace(1),
  },
  {
    id: "open-settings",
    label: route === "settings"
      ? (locale === "zh" ? "返回工作区" : "Back To Workspace")
      : (locale === "zh" ? "打开设置" : "Open Settings"),
    description: route === "settings"
      ? (locale === "zh" ? "关闭设置并返回工作台" : "Close settings and return to the workbench")
      : (locale === "zh" ? "打开全局设置面板" : "Open global settings panel"),
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
    label: `${locale === "zh" ? "切换到" : "Switch To"} ${tab.label}`,
    description: locale === "zh" ? "直接跳转到该工作区" : "Jump directly to this workspace",
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
