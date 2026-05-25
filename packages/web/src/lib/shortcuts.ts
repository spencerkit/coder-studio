/**
 * Keyboard Shortcuts Management (Phase 4)
 *
 * Centralized shortcut registry with customization support.
 */

import { atomWithStorage } from "jotai/utils";

export interface ShortcutDefinition {
  id: string;
  name: string;
  description: string;
  defaultBinding: string;
  category: "global" | "workspace" | "editor" | "terminal";
}

// Default shortcuts (PRD §5.2)
export const DEFAULT_SHORTCUTS: ShortcutDefinition[] = [
  // Global
  {
    id: "command-palette.toggle",
    name: "命令面板",
    description: "打开/关闭命令面板",
    defaultBinding: "Mod+K",
    category: "global",
  },
  {
    id: "workspace.new",
    name: "新建工作区",
    description: "打开新的工作区标签",
    defaultBinding: "Mod+N",
    category: "global",
  },
  {
    id: "workspace.previous",
    name: "上一个工作区",
    description: "切换到上一个工作区标签",
    defaultBinding: "Ctrl+Shift+ArrowLeft",
    category: "workspace",
  },
  {
    id: "workspace.next",
    name: "下一个工作区",
    description: "切换到下一个工作区标签",
    defaultBinding: "Ctrl+Shift+ArrowRight",
    category: "workspace",
  },
  {
    id: "focus-mode.toggle",
    name: "专注模式",
    description: "切换专注模式（隐藏非必要面板）",
    defaultBinding: "F",
    category: "global",
  },
  // Workspace
  {
    id: "agent.split-vertical",
    name: "垂直分屏",
    description: "垂直分割 Agent 面板",
    defaultBinding: "Mod+D",
    category: "workspace",
  },
  {
    id: "session.navigate.left",
    name: "切换到左侧会话",
    description: "将焦点切换到左侧会话",
    defaultBinding: "Ctrl+ArrowLeft",
    category: "workspace",
  },
  {
    id: "session.navigate.right",
    name: "切换到右侧会话",
    description: "将焦点切换到右侧会话",
    defaultBinding: "Ctrl+ArrowRight",
    category: "workspace",
  },
  {
    id: "session.navigate.up",
    name: "切换到上方会话",
    description: "将焦点切换到上方会话",
    defaultBinding: "Ctrl+ArrowUp",
    category: "workspace",
  },
  {
    id: "session.navigate.down",
    name: "切换到下方会话",
    description: "将焦点切换到下方会话",
    defaultBinding: "Ctrl+ArrowDown",
    category: "workspace",
  },
  {
    id: "agent.split-horizontal",
    name: "水平分屏",
    description: "水平分割 Agent 面板",
    defaultBinding: "Mod+Shift+D",
    category: "workspace",
  },
  // Editor
  {
    id: "editor.save",
    name: "保存",
    description: "保存当前编辑的文件",
    defaultBinding: "Mod+S",
    category: "editor",
  },
];

// Custom bindings stored in localStorage
export const customShortcutsAtom = atomWithStorage<Record<string, string>>(
  "ui.customShortcuts",
  {}
);

/**
 * Parse a shortcut binding string into modifiers and key
 */
export function parseShortcut(binding: string): {
  modifiers: string[];
  key: string;
} {
  const parts = binding.split("+");
  const key = parts.pop() || "";
  return {
    modifiers: parts,
    key,
  };
}

/**
 * Format a shortcut for display
 */
export function formatShortcut(binding: string): string {
  return binding
    .replace("Mod", navigator.platform.includes("Mac") ? "⌘" : "Ctrl")
    .replace("Ctrl", "Ctrl")
    .replace("Shift", "⇧")
    .replace("Alt", navigator.platform.includes("Mac") ? "⌥" : "Alt")
    .replace("ArrowLeft", "←")
    .replace("ArrowRight", "→")
    .replace("ArrowUp", "↑")
    .replace("ArrowDown", "↓");
}

/**
 * Check if a keyboard event matches a shortcut
 */
export function matchesShortcut(event: KeyboardEvent, binding: string): boolean {
  const { modifiers, key } = parseShortcut(binding);
  const isMac = navigator.platform.includes("Mac");
  const expectedCtrl = modifiers.includes("Ctrl") || (!isMac && modifiers.includes("Mod"));
  const expectedMeta = isMac && modifiers.includes("Mod");
  const expectedShift = modifiers.includes("Shift");
  const expectedAlt = modifiers.includes("Alt");

  if (event.ctrlKey !== expectedCtrl) return false;
  if (event.metaKey !== expectedMeta) return false;
  if (event.shiftKey !== expectedShift) return false;
  if (event.altKey !== expectedAlt) return false;

  // Check key
  const eventKey = event.key.toLowerCase();
  const bindingKey = key.toLowerCase();

  return eventKey === bindingKey;
}

/**
 * Get the effective binding for a shortcut (custom or default)
 */
export function getEffectiveBinding(
  shortcutId: string,
  customBindings: Record<string, string>
): string {
  return (
    customBindings[shortcutId] ||
    DEFAULT_SHORTCUTS.find((s) => s.id === shortcutId)?.defaultBinding ||
    ""
  );
}
